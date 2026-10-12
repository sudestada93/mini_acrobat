/* Organización de páginas: operaciones estructurales sobre el PDF y vista "Organizar". */
const { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef, PDFRawStream, StandardFonts, degrees } = PDFLib;

async function getBaseBytes() {
  // incorpora los valores de formularios completados en pantalla
  if (S.pdf && S.pdf.annotationStorage && S.pdf.annotationStorage.size > 0) {
    try { return await S.pdf.saveDocument(); } catch (e) { console.warn('saveDocument', e); }
  }
  return S.bytes;
}
async function loadLib(bytes) { return PDFDocument.load(bytes, { updateMetadata: false }); }
// Carga un PDF externo pidiendo contraseña si está cifrado
async function loadAnyPdf(bytes, name = 'archivo') {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (!probe.isEncrypted) throw e;
    for (let i = 0; i < 4; i++) {
      const pw = await askPassword(`"${name}" está protegido. Contraseña:`);
      if (pw == null) throw new Error('Cancelado');
      try { return await PDFDocument.load(bytes, { password: pw, updateMetadata: false }); } catch { /* reintentar */ }
    }
    throw new Error('Contraseña incorrecta');
  }
}

// Reconstruye el árbol de páginas con la lista dada (permite reordenar, borrar y duplicar)
function setPageOrder(doc, list) {
  const ctx = doc.context;
  const pagesRef = doc.catalog.get(PDFName.of('Pages'));
  const pagesDict = ctx.lookup(pagesRef);
  for (const p of list) {
    for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const key = PDFName.of(k);
      if (!p.node.get(key)) { const v = p.node.getInheritableAttribute(key); if (v) p.node.set(key, v); }
    }
  }
  pagesDict.set(PDFName.of('Kids'), ctx.obj(list.map((p) => p.ref)));
  pagesDict.set(PDFName.of('Count'), PDFNumber.of(list.length));
  for (const p of list) p.node.set(PDFName.of('Parent'), pagesRef);
  doc.pageCache.invalidate();
}
// Elimina objetos que ya no se usan (por ejemplo, páginas borradas)
function gcDoc(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt, ctx.trailerInfo.ID].filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) stack.push(o.get(i)); }
    else if (o && o.dict instanceof PDFDict) stack.push(o.dict);
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); removed++; }
  return removed;
}

/* Ejecuta una operación sobre el documento y recarga la vista.
   fn(doc) puede devolver un mapa nuevoÍndice -> índiceAnterior (-1 = página nueva). */
async function docOp(label, fn, { gc = false } = {}) {
  if (!S.bytes) { toast('Abrí un documento primero', 'err'); return false; }
  return withBusy(label, async () => {
    commitTextEditing();
    const base = await getBaseBytes();
    const doc = await loadLib(base);
    const n0 = doc.getPageCount();
    let map = await fn(doc);
    if (map === false) return false;
    let sameDisplay = new Set();
    if (map && !Array.isArray(map)) { sameDisplay = map.sameDisplay || sameDisplay; map = map.map || null; }
    if (!map) map = n0 === doc.getPageCount() ? [...Array(n0).keys()] : null;
    if (gc) gcDoc(doc);
    const out = await doc.save();
    pushUndo();
    const old = { vts: S.pages.map((p) => p.vt), objs: S.objects };
    S.objects = [];
    const nNew = doc.getPageCount();
    // carga con la página actual reubicada
    if (map) { const k = map.indexOf(S.current); if (k >= 0) S.current = k; }
    S.sel = null;
    await loadPdfJs(out, { keepView: true });
    S.objects = Array.from({ length: nNew }, () => []);
    if (map) {
      map.forEach((oi, ni) => {
        if (oi < 0 || !old.objs[oi]) return;
        // sameDisplay: la página se reconstruyó con la misma geometría visible (p. ej., redacción)
        const fwd = sameDisplay.has(ni) ? [1, 0, 0, 1, 0, 0] : M.then(M.inv(old.vts[oi]), S.pages[ni].vt);
        S.objects[ni] = old.objs[oi].map((o) => { const c = clone(o); c.page = ni; if (map.indexOf(oi) !== ni) c.id = uid(); transformObj(c, ([x, y]) => M.apply(fwd, x, y)); return c; });
      });
      if (S.outline) remapOutline(S.outline, map);
    }
    await preloadTextFonts();
    renderAllOverlays();
    refreshSidebar();
    return true;
  });
}
function remapOutline(tree, map) {
  const walk = (items) => items.filter((it) => {
    if (it.page != null) {
      const ni = map.indexOf(it.page);
      if (ni < 0) { if (!it.children?.length) return false; it.page = null; } else it.page = ni;
    }
    if (it.children) it.children = walk(it.children);
    return true;
  });
  const res = walk(tree);
  tree.length = 0; tree.push(...res);
}
function targetPages() { return S.selPages.size ? [...S.selPages].sort((a, b) => a - b) : [S.current]; }
const pagesLabel = (idx) => idx.length === 1 ? 'la página ' + (idx[0] + 1) : idx.length + ' páginas';

/* ---------- operaciones ---------- */
async function rotatePages(idx, delta) {
  await docOp('Girando páginas…', (doc) => {
    for (const i of idx) { const p = doc.getPage(i); p.setRotation(degrees(((p.getRotation().angle + delta) % 360 + 360) % 360)); }
  });
}
async function deletePages(idx) {
  if (idx.length >= S.pages.length) { toast('No se pueden eliminar todas las páginas', 'err'); return; }
  if (!(await confirmBox('Eliminar páginas', `¿Eliminar ${pagesLabel(idx)}?`, 'Eliminar'))) return;
  const del = new Set(idx);
  await docOp('Eliminando páginas…', (doc) => {
    const pages = doc.getPages();
    const keep = pages.map((p, i) => i).filter((i) => !del.has(i));
    setPageOrder(doc, keep.map((i) => pages[i]));
    return keep;
  }, { gc: true });
  S.selPages.clear();
}
async function duplicatePages(idx) {
  await docOp('Duplicando páginas…', async (doc) => {
    const pages = doc.getPages();
    const copies = await doc.copyPages(doc, idx);
    const list = [], map = [];
    const set = new Set(idx);
    pages.forEach((p, i) => {
      list.push(p); map.push(i);
      if (set.has(i)) { list.push(copies[idx.indexOf(i)]); map.push(i); }
    });
    copies.forEach((c) => doc.addPage(c));
    setPageOrder(doc, list);
    return map;
  });
}
// mueve las páginas idx para que queden antes de la posición "before" (índice en el orden actual)
async function movePages(idx, before) {
  const n = S.pages.length;
  const set = new Set(idx);
  const rest = [...Array(n).keys()].filter((i) => !set.has(i));
  const insertAt = rest.filter((i) => i < before).length;
  const order = [...rest.slice(0, insertAt), ...idx, ...rest.slice(insertAt)];
  if (order.every((v, i) => v === i)) return;
  await docOp('Reordenando páginas…', (doc) => {
    const pages = doc.getPages();
    setPageOrder(doc, order.map((i) => pages[i]));
    return order;
  });
  S.selPages = new Set(idx.map((i) => order.indexOf(i)));
  refreshSidebar();
}
async function reversePages() {
  const n = S.pages.length;
  const order = [...Array(n).keys()].reverse();
  await docOp('Invirtiendo orden…', (doc) => { const pages = doc.getPages(); setPageOrder(doc, order.map((i) => pages[i])); return order; });
}
const PAGE_SIZES = { A4: [595.28, 841.89], Carta: [612, 792], Oficio: [612, 1008], Legal: [612, 1008], A3: [841.89, 1190.55], A5: [419.53, 595.28] };
async function insertBlankDialog() {
  const cur = S.pages[S.current];
  const v = await formDialog('Insertar página en blanco', [
    { name: 'size', label: 'Tamaño', type: 'select', value: 'same', options: [['same', 'Igual a la página actual'], ...Object.keys(PAGE_SIZES).filter((k) => k !== 'Legal').map((k) => [k, k])] },
    { name: 'orient', label: 'Orientación', type: 'select', value: 'portrait', options: [['portrait', 'Vertical'], ['landscape', 'Horizontal']], show: (x) => x.size !== 'same' },
    { name: 'where', label: 'Posición', type: 'select', value: 'after', options: [['after', 'Después de la página actual'], ['before', 'Antes de la página actual'], ['end', 'Al final'], ['start', 'Al principio']] },
    { name: 'count', label: 'Cantidad', type: 'number', value: 1, min: 1, max: 100 },
  ], { ok: 'Insertar' });
  if (!v) return;
  let size = v.size === 'same' && cur ? [cur.w, cur.h] : PAGE_SIZES[v.size] || PAGE_SIZES.A4;
  if (v.size !== 'same' && v.orient === 'landscape') size = [size[1], size[0]];
  const at = insertPos(v.where);
  await docOp('Insertando páginas…', (doc) => {
    const pages = doc.getPages();
    const blanks = Array.from({ length: v.count || 1 }, () => doc.addPage(size));
    setPageOrder(doc, [...pages.slice(0, at), ...blanks, ...pages.slice(at)]);
    return [...[...Array(at).keys()], ...blanks.map(() => -1), ...[...Array(pages.length - at).keys()].map((i) => i + at)];
  });
}
function insertPos(where) {
  return where === 'start' ? 0 : where === 'end' ? S.pages.length : where === 'before' ? S.current : S.current + 1;
}
// Agrega páginas (de PDFs o imágenes) a un documento pdf-lib; devuelve las páginas nuevas
async function pagesFromFiles(doc, files, { imageFit = 'image' } = {}) {
  const out = [];
  for (const f of files) {
    if (isPdfFile(f)) {
      const src = await loadAnyPdf(await readBytes(f), f.name);
      const copied = await doc.copyPages(src, src.getPageIndices());
      for (const c of copied) out.push(doc.addPage(c));
    } else if (isImageFile(f)) {
      out.push(await addImagePage(doc, await readDataURL(f), imageFit));
    }
  }
  return out;
}
async function addImagePage(doc, dataUrl, fit = 'image', margin = 0) {
  const im = await normalizeImage(dataUrl, 4000);
  const bytes = dataURLtoBytes(im.src);
  const img = /^data:image\/png/.test(im.src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  let pw, ph;
  if (fit === 'image') { pw = im.w * 0.75; ph = im.h * 0.75; }
  else { [pw, ph] = PAGE_SIZES[fit] || PAGE_SIZES.A4; if (im.w > im.h) [pw, ph] = [ph, pw]; }
  const page = doc.addPage([pw, ph]);
  const k = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
  const w = img.width * k, hh = img.height * k;
  page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
  return page;
}
async function insertFromFileDialog() {
  const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true });
  if (!files.length) return;
  const v = await formDialog('Insertar desde archivo', [
    { name: 'where', label: 'Posición', type: 'select', value: 'after', options: [['after', 'Después de la página actual'], ['before', 'Antes de la página actual'], ['end', 'Al final'], ['start', 'Al principio']] },
    { name: 'fit', label: 'Tamaño de página para imágenes', type: 'select', value: 'image', options: [['image', 'Igual a la imagen'], ['A4', 'A4'], ['Carta', 'Carta']], show: () => files.some(isImageFile) },
  ], { ok: 'Insertar' });
  if (!v) return;
  const at = insertPos(v.where);
  await docOp('Insertando páginas…', async (doc) => {
    const pages = doc.getPages();
    const added = await pagesFromFiles(doc, files, { imageFit: v.fit });
    setPageOrder(doc, [...pages.slice(0, at), ...added, ...pages.slice(at)]);
    return [...[...Array(at).keys()], ...added.map(() => -1), ...[...Array(pages.length - at).keys()].map((i) => i + at)];
  });
}
async function replacePagesDialog() {
  const [file] = await pickFiles();
  if (!file) return;
  const src = await loadAnyPdf(await readBytes(file), file.name).catch((e) => { toast(e.message, 'err'); return null; });
  if (!src) return;
  const v = await formDialog('Reemplazar páginas', [
    { name: 'target', label: 'Páginas a reemplazar en este documento', value: String(S.current + 1), help: rangeHelp },
    { name: 'source', label: `Páginas de "${file.name}" (${src.getPageCount()} pág.)`, value: '1', help: 'Se usan en orden; debe haber la misma cantidad' },
  ], { ok: 'Reemplazar' });
  if (!v) return;
  let t, s;
  try { t = parseRange(v.target, S.pages.length); s = parseRange(v.source, src.getPageCount()); } catch (e) { toast(e.message, 'err'); return; }
  if (t.length !== s.length) { toast('La cantidad de páginas no coincide', 'err'); return; }
  await docOp('Reemplazando páginas…', async (doc) => {
    const pages = doc.getPages();
    const copied = await doc.copyPages(src, s);
    copied.forEach((c) => doc.addPage(c));
    const list = pages.slice();
    t.forEach((ti, k) => { list[ti] = copied[k]; });
    setPageOrder(doc, list);
    return pages.map((_, i) => (t.includes(i) ? -1 : i));
  }, { gc: true });
}
// Construye un PDF nuevo con ciertas páginas del documento (con las ediciones aplicadas)
async function buildSubset(fullBytes, idx) {
  const src = await loadLib(fullBytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  const info = ['Title', 'Author', 'Subject'];
  try { out.setTitle(src.getTitle() || ''); out.setAuthor(src.getAuthor() || ''); } catch { /* sin metadatos */ }
  void info;
  return out.save();
}
async function extractDialog() {
  const idx = targetPages();
  const v = await formDialog('Extraer páginas', [
    { name: 'range', label: 'Páginas a extraer', value: idx.map((i) => i + 1).join(','), help: rangeHelp },
    { name: 'separate', label: 'Extraer cada página como un archivo separado', type: 'checkbox' },
    { name: 'remove', label: 'Eliminar las páginas extraídas de este documento', type: 'checkbox' },
  ], { ok: 'Extraer' });
  if (!v) return;
  let sel;
  try { sel = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  if (!sel.length) return;
  await withBusy('Extrayendo…', async () => {
    const full = await buildOutput({ encrypt: false });
    const name = baseName(S.fileName);
    if (v.separate) {
      const files = [];
      for (const i of sel) files.push({ name: `${name}_pag${i + 1}.pdf`, data: await buildSubset(full, [i]) });
      downloadMany(files, name + '_paginas.zip');
    } else download(await buildSubset(full, sel), `${name}_extracto.pdf`);
  });
  if (v.remove) { S.selPages = new Set(sel); await deletePages(sel); }
}
async function splitDialog() {
  const n = S.pages.length;
  const hasOutline = !!(S.outline || (await S.pdf.getOutline())?.length);
  const v = await formDialog('Dividir documento', [
    { name: 'mode', label: 'Dividir', type: 'select', value: 'every', options: [['every', 'Cada N páginas'], ['ranges', 'Por rangos'], ['size', 'Por tamaño máximo de archivo'], ...(hasOutline ? [['bookmarks', 'Por marcadores de primer nivel']] : [])] },
    { name: 'every', label: 'Páginas por archivo', type: 'number', value: 1, min: 1, max: n, show: (x) => x.mode === 'every' },
    { name: 'ranges', label: 'Rangos (separados por ;)', value: `1-${Math.ceil(n / 2)}; ${Math.ceil(n / 2) + 1}-${n}`, help: 'Ej.: 1-3; 4-10; 11-', show: (x) => x.mode === 'ranges' },
    { name: 'size', label: 'Tamaño máximo por archivo (MB)', type: 'number', value: 5, min: 0.1, step: 0.1, show: (x) => x.mode === 'size' },
  ], { ok: 'Dividir' });
  if (!v) return;
  await withBusy('Dividiendo documento…', async () => {
    const full = await buildOutput({ encrypt: false });
    const name = baseName(S.fileName);
    let groups = [];
    if (v.mode === 'every') { const k = Math.max(1, v.every || 1); for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map((j) => i + j)); }
    else if (v.mode === 'ranges') groups = v.ranges.split(';').map((r) => parseRange(r, n)).filter((g) => g.length);
    else if (v.mode === 'bookmarks') {
      const tree = S.outline || (await readOutline());
      const starts = [...new Set(tree.map((t) => t.page).filter((p) => p != null))].sort((a, b) => a - b);
      if (starts[0] !== 0) starts.unshift(0);
      groups = starts.map((s, k) => [...Array((starts[k + 1] ?? n) - s).keys()].map((j) => s + j));
    } else {
      const limit = v.size * 1048576;
      let cur = [];
      for (let i = 0; i < n; i++) {
        const trial = [...cur, i];
        const sz = (await buildSubset(full, trial)).length;
        if (sz > limit && cur.length) { groups.push(cur); cur = [i]; } else cur = trial;
        progress(i / n, `Calculando tamaños… ${i + 1}/${n}`);
      }
      if (cur.length) groups.push(cur);
    }
    const files = [];
    for (const [k, g] of groups.entries()) {
      progress(k / groups.length, `Generando parte ${k + 1} de ${groups.length}…`);
      files.push({ name: `${name}_parte${String(k + 1).padStart(2, '0')}.pdf`, data: await buildSubset(full, g) });
    }
    downloadMany(files, name + '_dividido.zip');
    toast(`Documento dividido en ${files.length} archivo(s)`, 'ok');
  });
}

/* ---------- recortar y redimensionar ---------- */
async function cropDialog(pi, box) {
  const pg = S.pages[pi];
  const mm = (v) => (v * 25.4 / 72).toFixed(1);
  const m = { l: box.x, t: box.y, r: pg.w - box.x - box.w, b: pg.h - box.y - box.h };
  const v = await formDialog('Recortar páginas', [
    { name: 'info', type: 'html', html: `<p class="props-help">Márgenes a quitar: izq. ${mm(m.l)} mm · sup. ${mm(m.t)} mm · der. ${mm(m.r)} mm · inf. ${mm(m.b)} mm</p>` },
    { name: 'apply', label: 'Aplicar a', type: 'select', value: 'this', options: [['this', 'Solo esta página'], ['all', 'Todas las páginas'], ['range', 'Rango de páginas']] },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp, show: (x) => x.apply === 'range' },
  ], { ok: 'Recortar' });
  if (!v) return;
  let idx = v.apply === 'this' ? [pi] : v.apply === 'all' ? [...Array(S.pages.length).keys()] : parseRange(v.range, S.pages.length);
  await applyCrop(idx, m);
}
async function applyCrop(idx, m) {
  await docOp('Recortando…', (doc) => {
    for (const j of idx) {
      const pj = S.pages[j];
      const b = { x: m.l, y: m.t, w: pj.w - m.l - m.r, h: pj.h - m.t - m.b };
      if (b.w < 10 || b.h < 10) continue;
      const [x, y, w, hh] = boxToUser(j, b);
      doc.getPage(j).setCropBox(x, y, w, hh);
    }
  });
}
async function cropMarginsDialog() {
  const v = await formDialog('Recortar márgenes', [
    { name: 'l', label: 'Izquierda (mm)', type: 'number', value: 10, min: 0, step: 0.5 },
    { name: 'r', label: 'Derecha (mm)', type: 'number', value: 10, min: 0, step: 0.5 },
    { name: 't', label: 'Superior (mm)', type: 'number', value: 10, min: 0, step: 0.5 },
    { name: 'b', label: 'Inferior (mm)', type: 'number', value: 10, min: 0, step: 0.5 },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
    { name: 'reset', label: 'Restablecer recorte (mostrar la página completa)', type: 'checkbox' },
  ], { ok: 'Aplicar', layout: (b, els) => { b.append(h('div', { class: 'grid2' }, ...els.slice(0, 4)), ...els.slice(4)); } });
  if (!v) return;
  let idx;
  try { idx = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  if (v.reset) {
    await docOp('Restableciendo…', (doc) => { for (const j of idx) { const p = doc.getPage(j); const mb = p.getMediaBox(); p.setCropBox(mb.x, mb.y, mb.width, mb.height); } });
    return;
  }
  const k = 72 / 25.4;
  await applyCrop(idx, { l: v.l * k, r: v.r * k, t: v.t * k, b: v.b * k });
}
async function resizeDialog() {
  const v = await formDialog('Cambiar tamaño de páginas', [
    { name: 'size', label: 'Nuevo tamaño', type: 'select', value: 'A4', options: [...Object.keys(PAGE_SIZES).filter((k) => k !== 'Legal'), ['custom', 'Personalizado']] },
    { name: 'w', label: 'Ancho (mm)', type: 'number', value: 210, show: (x) => x.size === 'custom' },
    { name: 'h', label: 'Alto (mm)', type: 'number', value: 297, show: (x) => x.size === 'custom' },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
  ], { ok: 'Aplicar' });
  if (!v) return;
  const idx = parseRange(v.range, S.pages.length);
  const target = v.size === 'custom' ? [v.w * 72 / 25.4, v.h * 72 / 25.4] : PAGE_SIZES[v.size];
  await docOp('Cambiando tamaño…', (doc) => {
    for (const j of idx) {
      const p = doc.getPage(j);
      const rot = ((p.getRotation().angle % 360) + 360) % 360;
      const [x0, y0, x1, y1] = S.pages[j].view;
      const W0 = x1 - x0, H0 = y1 - y0;
      // tamaño objetivo en la orientación de la página (respetando la rotación)
      let [tw, th] = target;
      const landscape = (rot % 180 === 0 ? W0 > H0 : H0 > W0);
      if (landscape !== tw > th) [tw, th] = [th, tw];
      if (rot % 180 === 90) [tw, th] = [th, tw];
      const f = Math.min(tw / W0, th / H0);
      p.scaleContent(f, f);
      p.translateContent((tw - W0 * f) / 2 - x0 * f, (th - H0 * f) / 2 - y0 * f);
      p.setMediaBox(0, 0, tw, th); p.setCropBox(0, 0, tw, th);
      try { p.node.delete(PDFName.of('TrimBox')); p.node.delete(PDFName.of('BleedBox')); p.node.delete(PDFName.of('ArtBox')); } catch { /* opcional */ }
    }
  });
}

/* ---------- combinar ---------- */
async function mergeDialog() {
  const items = [];
  if (S.bytes) items.push({ name: S.fileName + ' (documento actual)', current: true, size: S.bytes.length });
  const list = h('div', { class: 'file-list' });
  const render = () => {
    list.innerHTML = '';
    if (!items.length) list.append(h('div', { class: 'empty', style: { padding: '12px' } }, 'Agregá archivos PDF o imágenes.'));
    items.forEach((it, k) => list.append(h('div', { class: 'file-row' },
      icon(it.file && isImageFile(it.file) ? 'image' : 'totext'), h('span', { class: 'n' }, it.name), h('span', { class: 'm' }, fmtBytes(it.size)),
      h('button', { class: 'ib', title: 'Subir', disabled: k === 0, onclick: () => { [items[k - 1], items[k]] = [items[k], items[k - 1]]; render(); } }, icon('up')),
      h('button', { class: 'ib', title: 'Bajar', disabled: k === items.length - 1, onclick: () => { [items[k + 1], items[k]] = [items[k], items[k + 1]]; render(); } }, icon('down')),
      h('button', { class: 'ib', title: 'Quitar', onclick: () => { items.splice(k, 1); render(); } }, icon('x')))));
  };
  render();
  const add = async () => { const fs = await pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true }); fs.forEach((f) => items.push({ name: f.name, file: f, size: f.size })); render(); };
  const body = h('div', {}, h('p', { class: 'props-help' }, 'Ordená los archivos con las flechas. El resultado se abre como documento de trabajo.'), list,
    h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: add }, icon('plus'), 'Agregar archivos…')));
  const ok = await modal({ title: 'Combinar archivos', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Combinar', primary: true, value: true }], onOpen: () => { if (!items.length) add(); } });
  if (!ok || !items.length) return;
  const res = await withBusy('Combinando…', async () => {
    const out = await PDFDocument.create();
    for (const [k, it] of items.entries()) {
      progress(k / items.length, `Agregando ${it.name}…`);
      if (it.current) {
        const src = await loadLib(await buildOutput({ encrypt: false }));
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      } else await pagesFromFiles(out, [it.file]);
    }
    return out.save();
  });
  if (!res) return;
  await openBytes(res, items[0].current ? baseName(S.fileName) + '_combinado.pdf' : 'combinado.pdf');
  S.dirty = true;
  toast('Archivos combinados. Guardá el resultado con Ctrl+S.', 'ok');
}

/* ---------- vista Organizar ---------- */
let orgWidth = lsGet('ma.orgw', 160);
function toggleOrganizer(force) {
  const org = $('#organizer');
  const show = force ?? org.hidden;
  if (show && !S.pdf) { toast('Abrí un documento primero', 'err'); return; }
  org.hidden = !show;
  $$('.rb[data-cmd="organize"]').forEach((b) => b.classList.toggle('active', show));
  if (show) renderOrganizer();
}
function renderOrganizer() {
  const org = $('#organizer');
  org.innerHTML = '';
  const sel = () => targetPages();
  const bar = h('div', { class: 'org-bar' },
    h('button', { class: 'btn small', onclick: () => toggleOrganizer(false) }, icon('x'), 'Cerrar'),
    h('span', { class: 'tb-sep', style: { background: 'var(--border)' } }),
    h('button', { class: 'btn small', onclick: () => { S.selPages = new Set(S.pages.map((_, i) => i)); renderOrganizer(); } }, 'Seleccionar todo'),
    h('button', { class: 'btn small', onclick: () => { S.selPages.clear(); renderOrganizer(); } }, 'Ninguna'),
    h('span', { class: 'tb-sep', style: { background: 'var(--border)' } }),
    h('button', { class: 'btn small', onclick: () => rotatePages(sel(), -90) }, icon('rotl'), 'Girar'),
    h('button', { class: 'btn small', onclick: () => rotatePages(sel(), 90) }, icon('rotr'), 'Girar'),
    h('button', { class: 'btn small', onclick: () => duplicatePages(sel()) }, icon('copy'), 'Duplicar'),
    h('button', { class: 'btn small danger', onclick: () => deletePages(sel()) }, icon('trash'), 'Eliminar'),
    h('button', { class: 'btn small', onclick: () => extractDialog() }, icon('extract'), 'Extraer'),
    h('button', { class: 'btn small', onclick: () => insertBlankDialog() }, icon('blank'), 'En blanco'),
    h('button', { class: 'btn small', onclick: () => insertFromFileDialog() }, icon('insert'), 'Insertar archivo'),
    h('button', { class: 'btn small', onclick: () => splitDialog() }, icon('split'), 'Dividir'),
    h('button', { class: 'btn small', onclick: () => reversePages() }, icon('reverse'), 'Invertir'),
    h('span', { class: 'tb-spacer' }),
    h('label', { class: 'props-help', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Tamaño',
      (() => { const r = h('input', { type: 'range', min: 90, max: 320, value: orgWidth }); r.addEventListener('change', () => { orgWidth = +r.value; lsSet('ma.orgw', orgWidth); renderOrganizer(); }); return r; })()),
    h('span', { class: 'props-help' }, `${S.selPages.size} de ${S.pages.length} seleccionada(s)`));
  const grid = h('div', { class: 'org-grid', style: { '--org-w': orgWidth + 20 + 'px' } });
  grid.style.setProperty('--org-w', orgWidth + 24 + 'px');
  S.pages.forEach((pg, i) => grid.append(thumbEl(i, orgWidth, { tools: true })));
  org.append(bar, grid);
  lazyThumbs(grid, orgWidth);
}
// Miniatura reutilizable con selección y arrastre para reordenar
function thumbEl(i, width, { tools = false } = {}) {
  const pg = S.pages[i];
  const hh = Math.round(width * pg.h / pg.w);
  const t = h('div', { class: 'thumb' + (S.selPages.has(i) ? ' selected' : '') + (i === S.current ? ' current' : ''), 'data-i': i, draggable: 'true', title: 'Página ' + (i + 1) },
    h('div', { class: 'ph', style: { width: width + 'px', height: hh + 'px' } }),
    h('div', { class: 'num' }, String(i + 1)));
  if (tools) {
    t.append(h('div', { class: 'tools' },
      h('button', { class: 'ib', title: 'Girar a la izquierda', onclick: (e) => { e.stopPropagation(); rotatePages([i], -90); } }, icon('rotl')),
      h('button', { class: 'ib', title: 'Girar a la derecha', onclick: (e) => { e.stopPropagation(); rotatePages([i], 90); } }, icon('rotr')),
      h('button', { class: 'ib', title: 'Duplicar', onclick: (e) => { e.stopPropagation(); duplicatePages([i]); } }, icon('copy')),
      h('button', { class: 'ib', title: 'Eliminar', onclick: (e) => { e.stopPropagation(); S.selPages = new Set([i]); deletePages([i]); } }, icon('trash'))));
  }
  t.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) { if (S.selPages.has(i)) S.selPages.delete(i); else S.selPages.add(i); }
    else if (e.shiftKey && S.selPages.size) { const last = [...S.selPages].pop(); for (let k = Math.min(last, i); k <= Math.max(last, i); k++) S.selPages.add(k); }
    else { S.selPages = new Set([i]); if (!tools) goToPage(i); }
    $$('.thumb', t.parentElement).forEach((x) => x.classList.toggle('selected', S.selPages.has(+x.dataset.i)));
    if (tools) $('.org-bar .props-help:last-child').textContent = `${S.selPages.size} de ${S.pages.length} seleccionada(s)`;
  });
  t.addEventListener('dblclick', () => { if (tools) toggleOrganizer(false); goToPage(i); });
  t.addEventListener('dragstart', (e) => {
    if (!S.selPages.has(i)) { S.selPages = new Set([i]); $$('.thumb', t.parentElement).forEach((x) => x.classList.toggle('selected', +x.dataset.i === i)); }
    e.dataTransfer.setData('text/x-pages', JSON.stringify(targetPages()));
    e.dataTransfer.effectAllowed = 'move';
  });
  t.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-pages')) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    const after = tools ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    t.classList.toggle('drop-after', after); t.classList.toggle('drop-before', !after);
  });
  t.addEventListener('dragleave', () => t.classList.remove('drop-after', 'drop-before'));
  t.addEventListener('drop', (e) => {
    const data = e.dataTransfer.getData('text/x-pages');
    if (!data) return;
    e.preventDefault(); e.stopPropagation();
    const after = t.classList.contains('drop-after');
    t.classList.remove('drop-after', 'drop-before');
    movePages(JSON.parse(data), after ? i + 1 : i);
  });
  return t;
}
