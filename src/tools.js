/* Herramientas: creación de objetos con el mouse, marcado de texto, edición de texto, sellos y firmas. */
const TOOLS = {
  select: { label: 'Seleccionar', icon: 'select' },
  hand: { label: 'Mano', icon: 'hand' },
  edittext: { label: 'Editar texto', icon: 'edittext' },
  text: { label: 'Añadir texto', icon: 'textbox', create: true },
  note: { label: 'Nota', icon: 'note', create: true },
  highlight: { label: 'Resaltar texto', icon: 'highlight', sticky: true },
  underline: { label: 'Subrayar', icon: 'underline', sticky: true },
  strike: { label: 'Tachar', icon: 'strike', sticky: true },
  hlarea: { label: 'Resaltar área', icon: 'hlarea', create: true, sticky: true },
  ink: { label: 'Dibujo libre', icon: 'pen', create: true, sticky: true },
  rect: { label: 'Rectángulo', icon: 'rect', create: true },
  ellipse: { label: 'Elipse', icon: 'ellipse', create: true },
  line: { label: 'Línea', icon: 'line', create: true },
  arrow: { label: 'Flecha', icon: 'arrow', create: true },
  measure: { label: 'Medir', icon: 'ruler', create: true, sticky: true },
  stamp: { label: 'Sello', icon: 'stamp', create: true },
  image: { label: 'Imagen', icon: 'image', create: true },
  link: { label: 'Enlace', icon: 'link', create: true },
  whiteout: { label: 'Corrector (tapar)', icon: 'eraser', create: true },
  redact: { label: 'Marcar para redactar', icon: 'redact', create: true, sticky: true },
  crop: { label: 'Recortar página', icon: 'crop', create: true },
  signature: { label: 'Firma', icon: 'sign', create: true },
  initials: { label: 'Iniciales', icon: 'initials', create: true },
  date: { label: 'Fecha', icon: 'calendar', create: true },
  'mark-check': { label: 'Tilde', icon: 'check', create: true, sticky: true },
  'mark-cross': { label: 'Cruz', icon: 'cross', create: true, sticky: true },
  'mark-dot': { label: 'Punto', icon: 'dot', create: true, sticky: true },
  'field-text': { label: 'Campo de texto', icon: 'ftext', create: true },
  'field-check': { label: 'Casilla', icon: 'fcheck', create: true },
  'field-radio': { label: 'Botón de opción', icon: 'fradio', create: true },
  'field-dropdown': { label: 'Lista desplegable', icon: 'fdrop', create: true },
  'field-list': { label: 'Cuadro de lista', icon: 'flist', create: true },
};

async function setTool(t) {
  if (!TOOLS[t]) return;
  if (t === 'stamp' && !S.currentStamp) { const ok = await chooseStamp(); if (!ok) return; }
  if ((t === 'signature' || t === 'initials') && !S.currentSig?.[t]) { const ok = await signatureManager(t); if (!ok) return; }
  if (t === 'image' && !S.pendingImage) {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    S.pendingImage = await loadImageInfo(await readDataURL(f));
  }
  document.activeElement?.blur?.();
  S.tool = t;
  for (const k of Object.keys(TOOLS)) document.body.classList.remove('tool-' + k);
  document.body.classList.add('tool-' + t);
  document.body.classList.toggle('creating', !!TOOLS[t].create);
  viewer().classList.toggle('hand', t === 'hand');
  $$('.rb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $('#statusTool').textContent = 'Herramienta: ' + TOOLS[t].label;
  if (S.sel && t !== 'select') deselect();
  renderAllOverlays();
  renderProps();
}
function afterCreate() { if (!TOOLS[S.tool]?.sticky) setTool('select'); }

function loadImageInfo(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res({ src, w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => rej(new Error('No se pudo leer la imagen'));
    im.src = src;
  });
}
// Convierte cualquier imagen a PNG/JPEG (formatos que acepta el PDF)
async function normalizeImage(src, maxSide = 2400) {
  const info = await loadImageInfo(src);
  if (/^data:image\/(png|jpe?g)/.test(src) && Math.max(info.w, info.h) <= maxSide) return info;
  const k = Math.min(1, maxSide / Math.max(info.w, info.h));
  const c = document.createElement('canvas');
  c.width = Math.round(info.w * k); c.height = Math.round(info.h * k);
  c.getContext('2d').drawImage(getImg(src).complete ? getImg(src) : await loadImg(src), 0, 0, c.width, c.height);
  const out = c.toDataURL(/jpe?g/.test(src.slice(0, 30)) ? 'image/jpeg' : 'image/png', 0.92);
  return { src: out, w: c.width, h: c.height };
}
function loadImg(src) { return new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; }); }

/* ---------- eventos sobre la página ---------- */
function attachPageEvents(el, pi) {
  const ov = el.querySelector('.ov');
  ov.addEventListener('pointerdown', (e) => onCreatePointerDown(e, pi));
  el.addEventListener('pointerdown', (e) => {
    if (S.tool === 'select' && !e.target.closest('.obj, .handle, .note-pop')) deselect();
    S.current = pi; updatePageIndicator();
  });
  el.addEventListener('pointerup', (e) => {
    if (['highlight', 'underline', 'strike'].includes(S.tool)) setTimeout(() => markupFromSelection(S.tool), 0);
  });
  el.addEventListener('click', (e) => {
    if (S.tool !== 'edittext') return;
    const span = e.target.closest('.textLayer span');
    if (span && !span.classList.contains('markedContent')) { e.preventDefault(); editSpan(pi, span); }
  });
}

function onCreatePointerDown(e, pi) {
  const t = S.tool;
  if (!TOOLS[t]?.create || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const [x, y] = pagePoint(pi, e);
  const st = S.style;
  const clickTools = {
    text: () => { const o = addObject(pi, { type: 'text', x, y: y - st.size * 0.7, w: 10, h: st.size * 1.2, nowrap: true, text: '', size: st.size, font: st.font, color: st.color, bold: st.bold, italic: st.italic, align: st.align, bg: st.bg }); setTool('select'); setTimeout(() => startTextEdit(o), 0); },
    date: () => { addObject(pi, { type: 'text', x, y: y - st.size * 0.7, w: 10, h: st.size * 1.2, nowrap: true, text: today(), size: st.size, font: st.font, color: st.color }); setTimeout(() => S.sel && measureTextObj(S.sel), 0); afterCreate(); },
    note: () => { const o = addObject(pi, { type: 'note', x: x - 10, y: y - 10, w: 20, h: 20, text: '', color: st.note, author: S.author, date: new Date().toISOString() }); afterCreate(); setTimeout(() => openNotePopup(o), 0); },
    stamp: () => {
      const sp = S.currentStamp;
      if (sp.src) { const w = 150, hh = (w * sp.h) / sp.w; addObject(pi, { type: 'image', x: x - w / 2, y: y - hh / 2, w, h: hh, src: sp.src }); }
      else {
        const hh = sp.sub ? 46 : 36, fs = sp.sub ? hh * 0.38 : hh * 0.5;
        const w = Math.max(90, sp.text.length * fs * 0.72 + 26, (sp.sub || '').length * fs * 0.45 * 0.6 + 26);
        addObject(pi, { type: 'stamp', x: x - w / 2, y: y - hh / 2, w, h: hh, text: sp.text, sub: sp.sub || '', color: sp.color, opacity: 0.9 });
      }
      afterCreate();
    },
    image: () => {
      const im = S.pendingImage; S.pendingImage = null;
      const w = clamp(im.w * 0.75, 40, 280), hh = (w * im.h) / im.w;
      addObject(pi, { type: 'image', x: x - w / 2, y: y - hh / 2, w, h: hh, src: im.src });
      afterCreate();
    },
    signature: () => placeSig(pi, x, y, 'signature'), initials: () => placeSig(pi, x, y, 'initials'),
    'mark-check': () => { addObject(pi, { type: 'mark', kind: 'check', x: x - 8, y: y - 8, w: 16, h: 16, stroke: st.stroke === '#e5162d' ? '#111111' : st.stroke }); afterCreate(); },
    'mark-cross': () => { addObject(pi, { type: 'mark', kind: 'cross', x: x - 8, y: y - 8, w: 16, h: 16, stroke: st.stroke === '#e5162d' ? '#111111' : st.stroke }); afterCreate(); },
    'mark-dot': () => { addObject(pi, { type: 'mark', kind: 'dot', x: x - 5, y: y - 5, w: 10, h: 10, stroke: st.stroke === '#e5162d' ? '#111111' : st.stroke }); afterCreate(); },
  };
  if (clickTools[t]) { clickTools[t](); return; }

  const ov = S.pages[pi].el.querySelector('.ov');
  if (t === 'ink') {
    const pts = [[x, y]];
    const svg = h('div', { html: `<svg class="draft-svg" viewBox="0 0 ${S.pages[pi].w} ${S.pages[pi].h}" preserveAspectRatio="none"><path fill="none" stroke="${st.stroke}" stroke-width="${st.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${st.opacity}"/></svg>` }).firstChild;
    ov.append(svg);
    const path = svg.querySelector('path');
    dragLoop(e, (ev) => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of evs) {
        let [nx, ny] = pagePoint(pi, ce);
        if (ev.shiftKey) { pts.length = 1; }
        pts.push([nx, ny]);
      }
      path.setAttribute('d', inkPath(pts));
    }, () => {
      svg.remove();
      if (pts.length < 2) return;
      addObject(pi, { type: 'ink', strokes: [simplify(pts, 0.4)], stroke: st.stroke, width: st.width, opacity: st.opacity }, { select: false });
    });
    return;
  }
  if (LINE_TYPES.has(t)) {
    const svg = h('div', { html: `<svg class="draft-svg" viewBox="0 0 ${S.pages[pi].w} ${S.pages[pi].h}" preserveAspectRatio="none"><line stroke="${st.stroke}" stroke-width="${st.width}" stroke-linecap="round"/></svg>` }).firstChild;
    ov.append(svg);
    const ln = svg.querySelector('line');
    let x2 = x, y2 = y;
    dragLoop(e, (ev) => {
      [x2, y2] = pagePoint(pi, ev);
      if (ev.shiftKey) { const ang = Math.round(Math.atan2(y2 - y, x2 - x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x2 - x, y2 - y); x2 = x + Math.cos(ang) * len; y2 = y + Math.sin(ang) * len; }
      ln.setAttribute('x1', x); ln.setAttribute('y1', y); ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
    }, () => {
      svg.remove();
      if (Math.hypot(x2 - x, y2 - y) < 3) return;
      const o = { type: t, x1: x, y1: y, x2, y2, stroke: st.stroke, width: st.width, opacity: st.opacity, dash: st.dash };
      if (t === 'measure') { o.unit = st.unit || 'mm'; o.ratio = st.ratio || 1; o.width = Math.min(st.width, 1.5); }
      addObject(pi, o, { select: !TOOLS[t].sticky });
      afterCreate();
    });
    return;
  }
  // herramientas de recuadro
  const draft = h('div', { class: 'draft' });
  ov.append(draft);
  let box = { x, y, w: 0, h: 0 };
  dragLoop(e, (ev) => {
    let [x2, y2] = pagePoint(pi, ev);
    x2 = clamp(x2, 0, S.pages[pi].w); y2 = clamp(y2, 0, S.pages[pi].h);
    let w = x2 - x, hh = y2 - y;
    if (ev.shiftKey || t === 'field-check' || t === 'field-radio') { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
    box = { x: w < 0 ? x + w : x, y: hh < 0 ? y + hh : y, w: Math.abs(w), h: Math.abs(hh) };
    Object.assign(draft.style, { left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h) });
  }, () => {
    draft.remove();
    const small = box.w < 4 || box.h < 4;
    const defaults = { 'field-text': [150, 22], 'field-check': [14, 14], 'field-radio': [14, 14], 'field-dropdown': [150, 22], 'field-list': [150, 60], link: [120, 20], rect: [100, 70], ellipse: [100, 70] };
    if (small) {
      if (!defaults[t]) return;
      box = { x, y, w: defaults[t][0], h: defaults[t][1] };
    }
    createBoxObject(t, pi, box);
  });
}

let fieldCounter = 1;
function createBoxObject(t, pi, box) {
  const st = S.style;
  if (t === 'crop') { cropDialog(pi, box); return; }
  let o;
  if (t === 'rect' || t === 'ellipse') o = { type: t, ...box, stroke: st.stroke, fill: st.fill, width: st.width, opacity: st.opacity, dash: st.dash };
  else if (t === 'hlarea') o = { type: 'rect', ...box, stroke: null, fill: st.hl, width: 0, opacity: 0.4, blend: true };
  else if (t === 'whiteout') o = { type: 'rect', ...box, stroke: null, fill: '#ffffff', width: 0, opacity: 1 };
  else if (t === 'link') o = { type: 'link', ...box, url: '', dest: S.current };
  else if (t === 'redact') o = { type: 'redact', ...box };
  else if (t.startsWith('field-')) {
    const ftype = t.slice(6);
    const base = { text: 'Texto', check: 'Casilla', radio: 'Opcion', dropdown: 'Lista', list: 'Cuadro' }[ftype];
    const existing = new Set(S.objects.flat().filter((x) => x.type === 'field').map((x) => x.name));
    let name; do { name = base + (fieldCounter++); } while (existing.has(name));
    o = { type: 'field', ftype, ...box, name, options: ftype === 'dropdown' || ftype === 'list' ? ['Opción 1', 'Opción 2', 'Opción 3'] : undefined, value: ftype === 'radio' ? 'Valor' + fieldCounter : '' };
    if (ftype === 'radio') {
      const prev = S.objects.flat().filter((x) => x.type === 'field' && x.ftype === 'radio').pop();
      if (prev) { o.name = prev.name; o.value = 'Valor' + (S.objects.flat().filter((x) => x.ftype === 'radio' && x.name === prev.name).length + 1); }
    }
  }
  if (!o) return;
  addObject(pi, o, { select: !TOOLS[t].sticky });
  if (t === 'link') toast('Definí el destino del enlace en el panel de propiedades');
  afterCreate();
}

// Simplificación de trazos (Ramer-Douglas-Peucker)
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const d = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / l; };
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const v = d(pts[i], pts[0], pts[pts.length - 1]); if (v > max) { max = v; idx = i; } }
  if (max > eps) return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
  return [pts[0], pts[pts.length - 1]];
}

/* ---------- marcado sobre texto seleccionado ---------- */
function markupFromSelection(kind) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const byPage = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const cr of sel.getRangeAt(r).getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const pi = S.pages.findIndex((pg) => { const b = pg.el.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
      if (pi < 0) continue;
      const b = S.pages[pi].el.getBoundingClientRect();
      if (cr.height > b.height * 0.5) continue;
      const rect = { x: (cr.left - b.left) / S.scale, y: (cr.top - b.top) / S.scale, w: cr.width / S.scale, h: cr.height / S.scale };
      if (!byPage.has(pi)) byPage.set(pi, []);
      byPage.get(pi).push(rect);
    }
  }
  sel.removeAllRanges();
  if (!byPage.size) return;
  pushUndo();
  for (const [pi, rects] of byPage) {
    const merged = mergeLineRects(rects);
    const color = kind === 'highlight' ? S.style.hl : (S.style.stroke || '#e5162d');
    addObject(pi, { type: 'markup', kind, rects: merged, color, opacity: kind === 'highlight' ? 0.45 : 1, comment: '', author: S.author, date: new Date().toISOString() }, { select: false, undoable: false });
  }
}
function mergeLineRects(rects) {
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + r.h * 0.6) {
      const x0 = Math.min(last.x, r.x), y0 = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x0; last.h = Math.max(last.y + last.h, r.y + r.h) - y0; last.x = x0; last.y = y0;
    } else out.push({ ...r });
  }
  return out;
}

/* ---------- editar texto existente ---------- */
function sampleColors(pi, box) {
  const c = S.pages[pi].el.querySelector('canvas');
  const out = { bg: '#ffffff', fg: '#000000' };
  try {
    const k = c.width / (S.pages[pi].w);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const x = Math.max(0, Math.floor(box.x * k)), y = Math.max(0, Math.floor(box.y * k));
    const w = Math.max(1, Math.min(c.width - x, Math.ceil(box.w * k))), hh = Math.max(1, Math.min(c.height - y, Math.ceil(box.h * k)));
    const data = ctx.getImageData(x, y, w, hh).data;
    const counts = new Map();
    let darkest = null, dl = 999;
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] >> 3) + ',' + (data[i + 1] >> 3) + ',' + (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => (+v << 3) + 4);
    const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
    const bgL = lum(...bgKey);
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(lum(data[i], data[i + 1], data[i + 2]) - bgL);
      if (-d < dl) { dl = -d; darkest = [data[i], data[i + 1], data[i + 2]]; }
    }
    const hex = (a) => '#' + a.map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
    out.bg = hex(bgKey);
    if (darkest && -dl > 60) out.fg = hex(darkest);
  } catch (e) { /* lienzo no disponible */ }
  return out;
}
function editSpan(pi, span) {
  const pb = S.pages[pi].el.getBoundingClientRect();
  const r = span.getBoundingClientRect();
  const box = { x: (r.left - pb.left) / S.scale, y: (r.top - pb.top) / S.scale, w: r.width / S.scale, h: r.height / S.scale };
  if (box.w < 1 || box.h < 1) return;
  const fs = Math.max(4, Math.round(box.h * 10) / 10);
  const ff = getComputedStyle(span).fontFamily.toLowerCase();
  const font = /mono|courier/.test(ff) ? 'cour' : /sans/.test(ff) ? 'helv' : /serif|times/.test(ff) ? 'times' : 'helv';
  const col = sampleColors(pi, box);
  const o = addObject(pi, {
    type: 'text', x: box.x, y: box.y - fs * 0.12, w: box.w, h: fs * 1.2, nowrap: true, text: span.textContent, size: fs, font, color: col.fg,
    bold: false, italic: false, cover: { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }, coverColor: col.bg,
  });
  setTimeout(() => startTextEdit(o), 0);
}

/* ---------- nota emergente ---------- */
function openNotePopup(o) {
  $$('.note-pop').forEach((n) => n.remove());
  const pg = S.pages[o.page];
  const b = objBox(o);
  const ta = h('textarea', { placeholder: 'Escribí tu comentario…' });
  ta.value = (o.type === 'note' ? o.text : o.comment) || '';
  const pop = h('div', { class: 'note-pop', style: { left: px(Math.min(b.x + b.w + 6, pg.w - 230 / S.scale)), top: px(b.y) } },
    h('div', { class: 'hdr' }, h('b', {}, o.author || S.author), h('span', {}, o.date ? new Date(o.date).toLocaleString('es-AR') : '')), ta,
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' } },
      h('button', { class: 'btn small', onclick: () => close() }, 'Listo')));
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  pop.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  const before = ta.value;
  const close = () => {
    if (ta.value !== before) {
      pushUndo();
      if (o.type === 'note') o.text = ta.value; else o.comment = ta.value;
      changed(o);
      refreshCommentsIfOpen();
    }
    pop.remove();
    renderProps();
  };
  pg.el.append(pop);
  pop.style.zIndex = 20;
  setTimeout(() => ta.focus(), 0);
}

/* ---------- sellos ---------- */
const STAMPS = [
  { text: 'APROBADO', color: '#1e8e3e' }, { text: 'RECHAZADO', color: '#d0021b' }, { text: 'BORRADOR', color: '#1473e6' },
  { text: 'CONFIDENCIAL', color: '#d0021b' }, { text: 'REVISADO', color: '#1473e6' }, { text: 'FINAL', color: '#1e8e3e' },
  { text: 'URGENTE', color: '#d0021b' }, { text: 'COPIA', color: '#555555' }, { text: 'PAGADO', color: '#1e8e3e' },
  { text: 'RECIBIDO', color: '#7b3fe4', dyn: true }, { text: 'NO APROBADO', color: '#d0021b' }, { text: 'PARA COMENTARIOS', color: '#ff7a00' },
  { text: 'ANULADO', color: '#d0021b' }, { text: 'ORIGINAL', color: '#1473e6' }, { text: 'VENCIDO', color: '#8a8a8a' }, { text: 'FIRMADO', color: '#1e8e3e', dyn: true },
];
async function chooseStamp() {
  let chosen = null;
  const grid = h('div', { class: 'stamp-grid' });
  const withDate = h('input', { type: 'checkbox', checked: true });
  const body = h('div', {},
    h('div', { class: 'field check' }, h('label', {}, withDate, 'Agregar nombre y fecha (sello dinámico)')),
    grid,
    h('h4', {}, 'Sello personalizado'),
    h('div', { class: 'grid3' },
      fieldEl({ name: 'ctext', label: 'Texto', value: '' }),
      fieldEl({ name: 'ccolor', label: 'Color', type: 'color', value: '#1473e6' }),
      h('div', { class: 'field' }, h('label', {}, ' '), h('button', { class: 'btn', onclick: () => { const v = readForm(body); if (!v.ctext.trim()) { toast('Escribí el texto del sello', 'err'); return; } chosen = { text: v.ctext.trim().toUpperCase(), color: v.ccolor, dyn: true }; done(); } }, 'Usar'))),
    h('button', { class: 'btn', onclick: async () => {
      const [f] = await pickFiles({ accept: 'image/*' });
      if (!f) return;
      const im = await normalizeImage(await readDataURL(f));
      chosen = { ...im, image: true }; done();
    } }, icon('image'), 'Sello desde imagen…'));
  let done;
  for (const st of STAMPS) {
    grid.append(h('button', { onclick: () => { chosen = st; done(); } }, h('div', { class: 'stamp-prev', style: { color: st.color, borderColor: st.color } }, st.text, st.dyn ? h('small', {}, S.author + ' · ' + today()) : null)));
  }
  const res = await modal({ title: 'Elegir sello', body, wide: true, buttons: [{ label: 'Cancelar', value: null }], onOpen: (_, close) => { done = () => close(true); } });
  if (!res || !chosen) return false;
  if (chosen.image) S.currentStamp = { src: chosen.src, w: chosen.w, h: chosen.h };
  else S.currentStamp = { text: chosen.text, color: chosen.color, sub: (chosen.dyn || withDate.checked) && withDate.checked ? `${S.author} · ${today()}` : '' };
  if (S.tool !== 'stamp') { S.tool = 'select'; await setTool('stamp'); }
  return true;
}

/* ---------- firmas ---------- */
function getSigs() { return lsGet('ma.sigs', []); }
function saveSigs(list) { lsSet('ma.sigs', list); }
S.currentSig = {};
function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
const SIG_FONTS = [
  ['"Segoe Script","Brush Script MT","Lucida Handwriting","Apple Chancery",cursive', 'Manuscrita'],
  ['"Brush Script MT","Snell Roundhand","Segoe Script",cursive', 'Pincel'],
  ['"Lucida Handwriting","Bradley Hand","Comic Sans MS",cursive', 'Caligráfica'],
  ['Georgia,"Times New Roman",serif', 'Formal (itálica)'],
];
async function signatureManager(kind = 'signature') {
  let mode = 'draw';
  let result = null;
  const pad = h('canvas', { class: 'sigpad', width: 1000, height: 300 });
  const ctx = pad.getContext('2d');
  let penColor = '#0b1f66';
  let drawn = false;
  pad.addEventListener('pointerdown', (e) => {
    const r = pad.getBoundingClientRect();
    const P = (ev) => [(ev.clientX - r.left) * (pad.width / r.width), (ev.clientY - r.top) * (pad.height / r.height)];
    let last = P(e);
    ctx.strokeStyle = penColor; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    dragLoop(e, (ev) => {
      for (const ce of ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]) {
        const p = P(ce);
        ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
        last = p; drawn = true;
      }
    });
  });
  const typed = h('input', { type: 'text', value: kind === 'initials' ? initialsOf(S.author) : S.author, placeholder: 'Tu nombre' });
  const fontSel = h('select', {}, ...SIG_FONTS.map(([v, l]) => h('option', { value: v }, l)));
  const preview = h('canvas', { class: 'sigpad', width: 1000, height: 300, style: { cursor: 'default' } });
  const drawTyped = () => {
    const c = preview.getContext('2d');
    c.clearRect(0, 0, 1000, 300);
    c.fillStyle = penColor; c.textAlign = 'center'; c.textBaseline = 'middle';
    let fs = 140;
    c.font = `italic ${fs}px ${fontSel.value}`;
    while (c.measureText(typed.value).width > 940 && fs > 20) { fs -= 6; c.font = `italic ${fs}px ${fontSel.value}`; }
    c.fillText(typed.value, 500, 150);
  };
  typed.addEventListener('input', drawTyped); fontSel.addEventListener('change', drawTyped);
  const imgIn = h('input', { type: 'file', accept: 'image/*' });
  const rmBg = h('input', { type: 'checkbox', checked: true });
  const imgPrev = h('canvas', { class: 'sigpad', width: 1000, height: 300, style: { cursor: 'default' } });
  let imgCanvas = null;
  const loadImgSig = async () => {
    const f = imgIn.files[0]; if (!f) return;
    const im = await loadImg(await readDataURL(f));
    const k = Math.min(1, 1600 / Math.max(im.width, im.height));
    const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0, c.width, c.height);
    if (rmBg.checked) {
      const d = cx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; if (l > 200) d.data[i + 3] = 0; else if (l > 150) d.data[i + 3] = Math.round(255 * (200 - l) / 50); }
      cx.putImageData(d, 0, 0);
    }
    imgCanvas = c;
    const pc = imgPrev.getContext('2d'); pc.clearRect(0, 0, 1000, 300);
    const s2 = Math.min(1000 / c.width, 300 / c.height); pc.drawImage(c, (1000 - c.width * s2) / 2, (300 - c.height * s2) / 2, c.width * s2, c.height * s2);
  };
  imgIn.addEventListener('change', loadImgSig); rmBg.addEventListener('change', loadImgSig);
  const colorRow = h('div', { class: 'prop-row', style: { margin: '6px 0' } }, ...[['#0b1f66', 'Azul'], ['#111111', 'Negro'], ['#b3001b', 'Rojo']].map(([c, l]) => h('button', { class: 'btn small', onclick: () => { penColor = c; drawTyped(); } }, h('span', { class: 'swatch', style: { background: c } }), l)));
  const panes = {
    draw: h('div', {}, pad, h('div', { class: 'prop-row', style: { marginTop: '6px' } }, h('button', { class: 'btn small', onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; } }, 'Borrar'))),
    type: h('div', {}, h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', {}, 'Texto'), typed), h('div', { class: 'field' }, h('label', {}, 'Estilo'), fontSel)), preview),
    image: h('div', {}, h('div', { class: 'field' }, imgIn), h('div', { class: 'field check' }, h('label', {}, rmBg, 'Quitar fondo claro')), imgPrev),
  };
  const seg = h('div', { class: 'seg' });
  const show = (m) => { mode = m; for (const [k, p] of Object.entries(panes)) p.hidden = k !== m; $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.m === m)); if (m === 'type') drawTyped(); };
  for (const [m, l] of [['draw', 'Dibujar'], ['type', 'Escribir'], ['image', 'Imagen']]) seg.append(h('button', { 'data-m': m, onclick: () => show(m) }, l));
  const list = h('div', { class: 'sig-list' });
  const renderList = () => {
    list.innerHTML = '';
    const sigs = getSigs().filter((s) => s.kind === kind);
    if (!sigs.length) list.append(h('div', { class: 'empty' }, 'Todavía no guardaste ' + (kind === 'initials' ? 'iniciales.' : 'firmas.')));
    for (const s of sigs) {
      list.append(h('div', { class: 'sig-item', title: 'Usar', onclick: () => { result = s.src; closeFn(true); } }, h('img', { src: s.src, alt: 'Firma guardada' }),
        h('button', { class: 'x', title: 'Eliminar', onclick: (e) => { e.stopPropagation(); saveSigs(getSigs().filter((x) => x.id !== s.id)); renderList(); } }, '✕')));
    }
  };
  renderList();
  const body = h('div', {}, h('div', { class: 'side-title' }, 'Guardadas'), list, h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '12px 0' } }), h('div', { class: 'side-title' }, 'Crear nueva'), seg, colorRow, panes.draw, panes.type, panes.image);
  let closeFn;
  show('draw');
  const ok = await modal({
    title: kind === 'initials' ? 'Iniciales' : 'Firma', body, wide: true,
    onOpen: (_, close) => { closeFn = close; },
    buttons: [{ label: 'Cancelar', value: null }, {
      label: 'Guardar y usar', primary: true, onClick: () => {
        let c = null;
        if (mode === 'draw') { if (!drawn) { toast('Dibujá tu firma primero', 'err'); return false; } c = trimCanvas(pad); }
        else if (mode === 'type') { if (!typed.value.trim()) return false; drawTyped(); c = trimCanvas(preview); }
        else { if (!imgCanvas) { toast('Elegí una imagen', 'err'); return false; } c = trimCanvas(imgCanvas) || imgCanvas; }
        if (!c) return false;
        result = c.toDataURL('image/png');
        const sigs = getSigs(); sigs.push({ id: uid(), kind, src: result }); saveSigs(sigs.slice(-12));
        return true;
      },
    }],
  });
  if (!ok || !result) return false;
  S.currentSig[kind] = result;
  if (S.tool !== kind) { S.tool = 'select'; await setTool(kind); }
  return true;
}
function initialsOf(name) { return (name || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('') || 'AB'; }
async function placeSig(pi, x, y, kind) {
  const info = await loadImageInfo(S.currentSig[kind]);
  const w = kind === 'initials' ? 60 : 150, hh = (w * info.h) / info.w;
  addObject(pi, { type: 'image', x: x - w / 2, y: y - hh / 2, w, h: hh, src: info.src, sig: kind });
  afterCreate();
}
