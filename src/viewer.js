/* Visor: carga de documentos, renderizado, zoom, navegación, miniaturas y búsqueda. */
const viewer = () => $('#viewer');
const pagesEl = () => $('#pages');
let renderObserver = null;
const renderQueue = new Set();
let rendering = 0;
S.textCache = [];
S.thumbCache = new Map();

/* ---------- apertura ---------- */
async function openFile(file) {
  if (isImageFile(file)) return createFromImages([file]);
  if (!isPdfFile(file)) { toast('Formato no compatible: ' + file.name, 'err'); return; }
  if (S.dirty && S.bytes && !(await confirmBox('Abrir otro documento', 'Hay cambios sin guardar en el documento actual. ¿Descartarlos y abrir "' + file.name + '"?', 'Abrir'))) return;
  const bytes = await readBytes(file);
  await openBytes(bytes, file.name);
}

async function askPassword(msg) {
  const v = await formDialog('Documento protegido', [
    { name: 'pw', label: msg, type: 'password' },
  ], { ok: 'Abrir' });
  return v ? v.pw : null;
}

// Descifra (si hace falta) y abre un PDF como documento de trabajo.
async function openBytes(bytes, name = 'documento.pdf', { resetHistory = true } = {}) {
  let work = bytes;
  let wasEncrypted = false;
  try {
    const probe = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (probe.isEncrypted) {
      wasEncrypted = true;
      let pw = '';
      let doc = null;
      for (let attempt = 0; attempt < 5 && !doc; attempt++) {
        try { doc = await PDFLib.PDFDocument.load(bytes, { password: pw, updateMetadata: false }); }
        catch (e) {
          pw = await askPassword(attempt === 0 ? 'Este PDF está protegido. Ingresá la contraseña:' : 'Contraseña incorrecta. Probá de nuevo:');
          if (pw == null) return;
        }
      }
      if (!doc) { toast('No se pudo abrir el documento protegido', 'err'); return; }
      work = await doc.save({ useObjectStreams: false });
      toast('Documento desbloqueado para edición. Al guardar podés volver a protegerlo.', 'ok');
    }
  } catch (e) {
    console.warn('pdf-lib no pudo analizar el archivo; se abre solo con pdf.js', e);
  }
  await withBusy('Abriendo documento…', async () => {
    S.fileName = name;
    S.wasEncrypted = wasEncrypted;
    S.encryption = null;
    S.objects = [];
    S.outline = null;
    S.sel = null;
    S.selPages.clear();
    if (resetHistory) { S.undo = []; S.redo = []; S.dirty = false; }
    clearSearch();
    await loadPdfJs(work, { keepView: false });
    document.title = name + ' — Mini Acrobat';
    status(`${name} · ${S.pages.length} página(s) · ${fmtBytes(work.length)}`);
    updateHistoryButtons();
  });
}

// Carga los bytes en pdf.js y reconstruye la vista. keepView conserva zoom y posición.
async function loadPdfJs(bytes, { keepView = true } = {}) {
  const prevScroll = keepView ? { top: viewer().scrollTop, left: viewer().scrollLeft, page: S.current } : null;
  if (S.pdf) { try { await S.pdf.destroy(); } catch { /* ignorar */ } }
  S.bytes = bytes;
  const task = pdfjsLib.getDocument({
    data: bytes.slice(), isEvalSupported: false, enableXfa: false, fontExtraProperties: true,
    cMapUrl: PDFJS_CDN + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_CDN + 'standard_fonts/',
  });
  task.onPassword = async (cb, reason) => {
    const pw = await askPassword(reason === 2 ? 'Contraseña incorrecta:' : 'Contraseña del documento:');
    if (pw == null) task.destroy(); else cb(pw);
  };
  S.pdf = await task.promise;
  S.version++;
  S.textCache = [];
  S.lineModels = [];
  resetPdfFonts();
  S.thumbCache.clear();
  S.ocConfig = await S.pdf.getOptionalContentConfig().catch(() => null);
  const n = S.pdf.numPages;
  S.pages = [];
  for (let i = 0; i < n; i++) {
    const p = await S.pdf.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    S.pages.push({ proxy: p, w: vp.width, h: vp.height, rot: p.rotate, vt: vp.transform, view: p.view });
  }
  while (S.objects.length < n) S.objects.push([]);
  S.objects.length = n;
  S.current = clamp(S.current, 0, n - 1);
  buildPageDom();
  await preloadTextFonts();
  $('#welcome').hidden = true;
  $('#pageCount').textContent = '/ ' + n;
  if (!keepView) S.zoomMode = 'fitw';
  applyZoom(S.zoomMode === 'custom' ? S.scale : S.zoomMode, { keepAnchor: false });
  if (prevScroll) {
    viewer().scrollTop = prevScroll.top; viewer().scrollLeft = prevScroll.left;
    S.current = clamp(prevScroll.page, 0, n - 1);
  } else { viewer().scrollTop = 0; S.current = 0; }
  updatePageIndicator();
  refreshSidebar();
  renderProps();
  if (!$('#organizer').hidden) renderOrganizer();
  if (S.search?.query) runSearch(S.search.query, { keepIndex: true });
}

/* ---------- DOM de páginas ---------- */
function buildPageDom() {
  const root = pagesEl();
  root.innerHTML = '';
  renderObserver?.disconnect();
  renderObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const i = +en.target.dataset.i;
      const pg = S.pages[i];
      if (!pg) continue;
      pg.visible = en.isIntersecting;
      if (en.isIntersecting) queueRender(i);
      else if (S.pages.length > 24 && pg.rendered) releasePage(i);
    }
  }, { root: viewer(), rootMargin: '800px 0px' });
  S.pages.forEach((pg, i) => {
    const el = h('div', { class: 'page', 'data-i': i },
      h('canvas'),
      h('div', { class: 'textLayer' }),
      h('div', { class: 'annotationLayer' }),
      h('div', { class: 'searchLayer' }),
      h('div', { class: 'ov' }),
      h('span', { class: 'pnum' }, String(i + 1)));
    pg.el = el;
    pg.rendered = false;
    root.append(el);
    renderObserver.observe(el);
    attachPageEvents(el, i);
  });
  root.classList.toggle('two', S.layout === 'two');
}

function releasePage(i) {
  const pg = S.pages[i];
  const c = pg.el.querySelector('canvas');
  c.width = 0; c.height = 0;
  pg.el.querySelector('.textLayer').innerHTML = '';
  pg.el.querySelector('.annotationLayer').innerHTML = '';
  pg.rendered = false;
}

function queueRender(i) {
  renderQueue.add(i);
  pumpRender();
}
async function pumpRender() {
  while (rendering < 2 && renderQueue.size) {
    // prioriza la página más cercana a la actual
    const arr = [...renderQueue].sort((a, b) => Math.abs(a - S.current) - Math.abs(b - S.current));
    const i = arr[0];
    renderQueue.delete(i);
    const pg = S.pages[i];
    if (!pg || !pg.visible || (pg.rendered && pg.renderedScale === S.scale)) continue;
    rendering++;
    renderPage(i).catch((e) => { if (e?.name !== 'RenderingCancelledException') console.warn(e); }).finally(() => { rendering--; pumpRender(); });
  }
}

const linkService = {
  externalLinkEnabled: true, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer nofollow',
  get pagesCount() { return S.pages.length; },
  get page() { return S.current + 1; }, set page(v) { goToPage(v - 1); },
  rotation: 0, isInPresentationMode: false,
  addLinkAttributes(link, url, newWindow) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow'; link.title = url; },
  getDestinationHash() { return '#'; }, getAnchorUrl() { return '#'; },
  async goToDestination(dest) { const i = await resolveDest(dest); if (i != null) goToPage(i); },
  goToPage(n) { goToPage(n - 1); },
  executeNamedAction(a) {
    if (a === 'NextPage') goToPage(S.current + 1); else if (a === 'PrevPage') goToPage(S.current - 1);
    else if (a === 'FirstPage') goToPage(0); else if (a === 'LastPage') goToPage(S.pages.length - 1);
    else if (a === 'Print') printDoc();
  },
  executeSetOCGState() {}, setHash() {}, cachePageRef() {}, isPageVisible() { return true; }, isPageCached() { return true; },
};
async function resolveDest(dest) {
  try {
    const d = typeof dest === 'string' ? await S.pdf.getDestination(dest) : dest;
    if (!Array.isArray(d)) return null;
    const ref = d[0];
    if (typeof ref === 'object' && ref) return await S.pdf.getPageIndex(ref);
    if (Number.isInteger(ref)) return ref;
  } catch (e) { console.warn(e); }
  return null;
}

async function renderPage(i) {
  const pg = S.pages[i];
  const scale = S.scale;
  const ver = S.version;
  const page = pg.proxy;
  const el = pg.el;
  pg.task?.cancel();
  const dpr = window.devicePixelRatio || 1;
  let rs = scale * dpr;
  const maxPx = 16e6;
  if (pg.w * pg.h * rs * rs > maxPx) rs = Math.sqrt(maxPx / (pg.w * pg.h));
  const vp = page.getViewport({ scale: rs });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
  const task = page.render({
    canvasContext: canvas.getContext('2d'), viewport: vp,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    optionalContentConfigPromise: S.ocConfig ? Promise.resolve(S.ocConfig) : undefined,
  });
  pg.task = task;
  await task.promise;
  if (ver !== S.version || scale !== S.scale) return;
  el.querySelector('canvas').replaceWith(canvas);
  pg.rendered = true;
  pg.renderedScale = scale;

  const cssVp = page.getViewport({ scale });
  // capa de texto
  const tl = el.querySelector('.textLayer');
  tl.innerHTML = '';
  try {
    const tc = await getText(i);
    if (ver !== S.version || scale !== S.scale) return;
    await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: cssVp, textDivs: [] }).promise;
  } catch (e) { console.warn('capa de texto', e); }
  // capa de anotaciones / formularios
  const al = el.querySelector('.annotationLayer');
  al.innerHTML = '';
  try {
    const annots = await page.getAnnotations({ intent: 'display' });
    if (annots.length && ver === S.version && scale === S.scale) {
      const avp = cssVp.clone({ dontFlip: true });
      const layer = new pdfjsLib.AnnotationLayer({ div: al, page, viewport: avp });
      await layer.render({ viewport: avp, div: al, annotations: annots, page, linkService, annotationStorage: S.pdf.annotationStorage, renderForms: true, enableScripting: false,
        imageResourcesPath: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#' });
    }
  } catch (e) { console.warn('capa de anotaciones', e); }
}

async function getText(i) {
  if (!S.textCache[i]) S.textCache[i] = S.pages[i].proxy.getTextContent();
  return S.textCache[i];
}

/* ---------- zoom ---------- */
function computeScale(mode) {
  const vw = viewer().clientWidth - 48;
  const vh = viewer().clientHeight - 36;
  if (!S.pages.length) return 1;
  const maxW = Math.max(...S.pages.map((p) => p.w)) * (S.layout === 'two' ? 2 : 1) + (S.layout === 'two' ? 14 : 0);
  if (mode === 'fitw') return clamp(vw / maxW, 0.1, 6);
  if (mode === 'fitp') { const p = S.pages[S.current] || S.pages[0]; return clamp(Math.min(vw / (p.w * (S.layout === 'two' ? 2 : 1)), vh / p.h), 0.1, 6); }
  return clamp(+mode, 0.1, 8);
}
function applyZoom(mode, { keepAnchor = true } = {}) {
  if (!S.pages.length) return;
  if (editing) finishTextEdit();
  const v = viewer();
  let anchor = null;
  if (keepAnchor && S.pages[S.current]?.el) {
    const el = S.pages[S.current].el;
    anchor = { i: S.current, frac: (v.scrollTop - el.offsetTop) / el.offsetHeight };
  }
  S.zoomMode = (mode === 'fitw' || mode === 'fitp') ? mode : 'custom';
  S.scale = computeScale(mode);
  for (const pg of S.pages) {
    pg.el.style.width = pg.w * S.scale + 'px';
    pg.el.style.height = pg.h * S.scale + 'px';
    pg.el.style.setProperty('--scale-factor', S.scale);
    if (pg.rendered && pg.renderedScale !== S.scale) {
      // conserva el lienzo viejo estirado hasta que se vuelva a dibujar
      pg.el.querySelector('.textLayer').innerHTML = '';
      pg.el.querySelector('.annotationLayer').innerHTML = '';
    }
  }
  renderAllOverlays();
  renderSearchHits();
  if (anchor) {
    const el = S.pages[anchor.i].el;
    v.scrollTop = el.offsetTop + anchor.frac * el.offsetHeight;
  }
  for (const [i, pg] of S.pages.entries()) if (pg.visible) queueRender(i);
  const sel = $('#zoomSelect');
  const opt = [...sel.options].find((o) => o.value === mode || (S.zoomMode === 'custom' && Math.abs(+o.value - S.scale) < 0.001));
  if (opt) sel.value = opt.value;
  else { sel.querySelector('[value=custom]').textContent = Math.round(S.scale * 100) + '%'; sel.value = 'custom'; }
  $('#statusZoom').textContent = Math.round(S.scale * 100) + '%';
}
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
function zoomStep(dir) {
  const cur = S.scale;
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001);
  if (next) applyZoom(next);
}

/* ---------- navegación ---------- */
function goToPage(i, { smooth = false } = {}) {
  if (!S.pages.length) return;
  i = clamp(i, 0, S.pages.length - 1);
  const el = S.pages[i].el;
  viewer().scrollTo({ top: el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  S.current = i;
  updatePageIndicator();
}
function updateCurrentFromScroll() {
  if (!S.pages.length) return;
  const v = viewer();
  const probe = v.scrollTop + v.clientHeight * 0.35;
  let best = 0;
  for (let i = 0; i < S.pages.length; i++) {
    const el = S.pages[i].el;
    if (el.offsetTop <= probe) best = i; else break;
  }
  if (best !== S.current) { S.current = best; updatePageIndicator(); }
}
function updatePageIndicator() {
  $('#pageInput').value = S.pages.length ? S.current + 1 : 0;
  const pg = S.pages[S.current];
  $('#statusPage').textContent = pg ? `Página ${S.current + 1} de ${S.pages.length} · ${(pg.w / 72 * 25.4).toFixed(0)} × ${(pg.h / 72 * 25.4).toFixed(0)} mm` : '';
  $$('#sideBody .thumb').forEach((t) => t.classList.toggle('current', +t.dataset.i === S.current));
}

/* ---------- miniaturas ---------- */
async function thumbURL(i, width = 140) {
  const key = S.version + ':' + i + ':' + width;
  if (S.thumbCache.has(key)) return S.thumbCache.get(key);
  const p = (async () => {
    const pg = S.pages[i];
    const sc = (width * (window.devicePixelRatio || 1)) / pg.w;
    const vp = pg.proxy.getViewport({ scale: sc });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await pg.proxy.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
    drawObjectsOnCanvas(c.getContext('2d'), i, sc);
    return c.toDataURL('image/jpeg', 0.8);
  })();
  S.thumbCache.set(key, p);
  return p;
}
const thumbTimers = new Map();
function invalidateThumb(i) {
  for (const k of [...S.thumbCache.keys()]) if (k.startsWith(S.version + ':' + i + ':')) S.thumbCache.delete(k);
  // vuelve a dibujar la miniatura visible (con demora para no hacerlo en cada movimiento)
  clearTimeout(thumbTimers.get(i));
  thumbTimers.set(i, setTimeout(() => {
    $$(`.thumb[data-i="${i}"] img`).forEach((img) => {
      const w = parseInt(img.style.width, 10) || 140;
      thumbURL(i, w).then((url) => { img.src = url; }).catch(() => {});
    });
  }, 600));
}
// Lazy loading de miniaturas dentro de un contenedor
function lazyThumbs(container, width) {
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const i = +en.target.dataset.i;
      thumbURL(i, width).then((url) => {
        const img = h('img', { src: url, alt: 'Página ' + (i + 1), width, draggable: 'false' });
        img.style.width = width + 'px';
        en.target.querySelector('.ph')?.replaceWith(img);
      }).catch(() => {});
    }
  }, { root: container.closest('#sideBody, #organizer') || null, rootMargin: '300px' });
  $$('.thumb', container).forEach((t) => io.observe(t));
}

/* ---------- búsqueda ---------- */
S.search = { query: '', hits: [], index: -1, caseSensitive: false, wholeWord: false };
function normChar(c, cs) {
  let r = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!cs) r = r.toLowerCase();
  return r;
}
// Devuelve los rectángulos (espacio de pantalla, escala 1) de un fragmento de un elemento de texto.
function itemSubRect(pi, item, from, to) {
  const n = item.str.length || 1;
  const [a, b, c, d, e, f] = item.transform;
  const ul = Math.hypot(a, b) || 1;
  const ux = a / ul, uy = b / ul;
  const fs = Math.hypot(c, d) || ul;
  const vx = c / (Math.hypot(c, d) || 1), vy = d / (Math.hypot(c, d) || 1);
  const w = item.width || ul * n * 0.5;
  const s0 = (w * from) / n, s1 = (w * to) / n;
  const p = (s, t) => M.apply(S.pages[pi].vt, e + ux * s + vx * t, f + uy * s + vy * t);
  const pts = [p(s0, -0.22 * fs), p(s1, -0.22 * fs), p(s0, 0.9 * fs), p(s1, 0.9 * fs)];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
async function findInPage(pi, query, { caseSensitive = false, wholeWord = false } = {}) {
  const tc = await getText(pi);
  let text = ''; const map = [];
  tc.items.forEach((it, k) => {
    if (it.str == null) return;
    for (let ci = 0; ci < it.str.length; ci++) {
      const nc = normChar(it.str[ci], caseSensitive);
      for (const ch of nc) { text += ch; map.push([k, ci]); }
    }
    if (it.hasEOL || (it.str && !/\s$/.test(it.str))) { text += ' '; map.push([k, -1]); }
  });
  const spans = [];
  if (query instanceof RegExp) {
    const re = new RegExp(query.source, query.flags.includes('g') ? query.flags : query.flags + 'g');
    let m;
    while ((m = re.exec(text))) { if (!m[0].length) { re.lastIndex++; continue; } spans.push([m.index, m.index + m[0].length]); }
  } else {
    const q = [...query].map((c) => normChar(c, caseSensitive)).join('').replace(/\s+/g, ' ');
    if (!q.trim()) return [];
    let p = 0;
    while ((p = text.indexOf(q, p)) !== -1) { spans.push([p, p + q.length]); p += q.length; }
  }
  const hits = [];
  for (const [pos, end] of spans) {
    const okWord = !wholeWord || ((pos === 0 || !/[\p{L}\p{N}]/u.test(text[pos - 1])) && (end >= text.length || !/[\p{L}\p{N}]/u.test(text[end])));
    if (okWord) {
      const rects = [];
      const byItem = new Map();
      for (let t = pos; t < end; t++) {
        const [k, ci] = map[t];
        if (ci < 0) continue;
        const r = byItem.get(k) || [ci, ci];
        r[0] = Math.min(r[0], ci); r[1] = Math.max(r[1], ci);
        byItem.set(k, r);
      }
      for (const [k, [a, b]] of byItem) rects.push(itemSubRect(pi, tc.items[k], a, b + 1));
      if (rects.length) hits.push({ page: pi, rects, text: query });
    }
  }
  return hits;
}
async function findAll(query, opts) {
  const all = [];
  for (let i = 0; i < S.pages.length; i++) all.push(...(await findInPage(i, query, opts)));
  return all;
}
let searchToken = 0;
async function runSearch(query, { keepIndex = false } = {}) {
  const tok = ++searchToken;
  S.search.query = query;
  if (!query.trim() || !S.pdf) { clearSearch(); return; }
  $('#searchCount').textContent = '…';
  const hits = await findAll(query, S.search);
  if (tok !== searchToken) return;
  S.search.hits = hits;
  if (!keepIndex || S.search.index >= hits.length) {
    const firstAfter = hits.findIndex((x) => x.page >= S.current);
    S.search.index = hits.length ? (firstAfter >= 0 ? firstAfter : 0) : -1;
  }
  renderSearchHits();
  updateSearchCount();
  if (!keepIndex) focusHit();
}
function updateSearchCount() {
  const s = S.search;
  $('#searchCount').textContent = s.query ? (s.hits.length ? `${s.index + 1}/${s.hits.length}` : '0') : '';
}
function clearSearch() {
  S.search.hits = []; S.search.index = -1; S.search.query = '';
  $$('.searchLayer').forEach((l) => (l.innerHTML = ''));
  $('#searchCount').textContent = '';
}
function renderSearchHits() {
  const byPage = new Map();
  S.search.hits.forEach((hit, idx) => { if (!byPage.has(hit.page)) byPage.set(hit.page, []); byPage.get(hit.page).push([hit, idx]); });
  S.pages.forEach((pg, i) => {
    const layer = pg.el?.querySelector('.searchLayer');
    if (!layer) return;
    layer.innerHTML = '';
    for (const [hit, idx] of byPage.get(i) || []) {
      for (const r of hit.rects) {
        layer.append(h('div', { class: 'hit' + (idx === S.search.index ? ' cur' : ''), style: { left: r.x * S.scale + 'px', top: r.y * S.scale + 'px', width: r.w * S.scale + 'px', height: r.h * S.scale + 'px' } }));
      }
    }
  });
}
function focusHit() {
  const hit = S.search.hits[S.search.index];
  if (!hit) return;
  const el = S.pages[hit.page].el;
  const r = hit.rects[0];
  const v = viewer();
  v.scrollTop = el.offsetTop + r.y * S.scale - v.clientHeight / 3;
  const left = el.offsetLeft + r.x * S.scale;
  if (left < v.scrollLeft || left > v.scrollLeft + v.clientWidth - 40) v.scrollLeft = left - 60;
  S.current = hit.page;
  updatePageIndicator();
}
function searchMove(dir) {
  const s = S.search;
  if (!s.hits.length) { const q = $('#searchInput').value; if (q) runSearch(q); return; }
  s.index = (s.index + dir + s.hits.length) % s.hits.length;
  renderSearchHits(); updateSearchCount(); focusHit();
}

/* ---------- extracción de texto por líneas ---------- */
async function pageLines(pi) {
  const tc = await getText(pi);
  const items = tc.items.filter((it) => it.str && it.str.trim() !== '').map((it) => {
    const [x, y] = M.apply(S.pages[pi].vt, it.transform[4], it.transform[5]);
    const fs = Math.hypot(it.transform[2], it.transform[3]);
    return { x, y, fs, w: it.width, str: it.str };
  });
  items.sort((a, b) => (Math.abs(a.y - b.y) < Math.max(2, Math.min(a.fs, b.fs) * 0.45) ? a.x - b.x : a.y - b.y));
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, Math.min(last.fs, it.fs) * 0.45)) {
      const gap = it.x - last.xEnd;
      last.text += (gap > it.fs * 0.2 && !/\s$/.test(last.text) ? ' ' : '') + it.str;
      last.xEnd = it.x + it.w;
    } else lines.push({ y: it.y, x: it.x, fs: it.fs, text: it.str, xEnd: it.x + it.w });
  }
  return lines;
}
async function pageText(pi) {
  const lines = await pageLines(pi);
  let out = '';
  lines.forEach((l, k) => {
    if (k > 0 && l.y - lines[k - 1].y > lines[k - 1].fs * 1.9) out += '\n';
    out += l.text + '\n';
  });
  return out;
}
