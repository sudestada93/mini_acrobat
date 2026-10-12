/* Operaciones de documento: marca de agua, encabezado/pie, Bates, propiedades, adjuntos, marcadores,
   seguridad, redacción, OCR, optimización, formularios y PDF/A. */

// Dibuja en las páginas idx usando coordenadas de pantalla (y hacia arriba) a escala 1
async function drawOnPages(doc, idx, fn) {
  const pages = doc.getPages();
  for (const j of idx) {
    const pg = S.pages[j];
    const page = pages[j];
    const Mx = M.then([1, 0, 0, -1, 0, pg.h], M.inv(pg.vt));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...Mx));
    await fn(page, { W: pg.w, H: pg.h, j });
    page.pushOperators(popGraphicsState());
  }
}
const mm2pt = (v) => v * 72 / 25.4;
// punto de origen para que un texto rotado quede centrado en (cx, cy)
function rotatedOrigin(cx, cy, w, hh, deg) {
  const a = deg * Math.PI / 180;
  const dx = w / 2, dy = hh / 2;
  return { x: cx - (dx * Math.cos(a) - dy * Math.sin(a)), y: cy - (dx * Math.sin(a) + dy * Math.cos(a)) };
}

/* ---------- marca de agua ---------- */
async function watermarkDialog() {
  const v = await formDialog('Agregar marca de agua', [
    { name: 'kind', label: 'Tipo', type: 'select', value: 'text', options: [['text', 'Texto'], ['image', 'Imagen']] },
    { name: 'text', label: 'Texto', value: 'CONFIDENCIAL', show: (x) => x.kind === 'text' },
    { name: 'file', label: 'Imagen', type: 'file', accept: 'image/*', show: (x) => x.kind === 'image' },
    { name: 'font', label: 'Fuente', type: 'select', value: 'helv', options: FONT_NAMES, show: (x) => x.kind === 'text' },
    { name: 'size', label: 'Tamaño de letra', type: 'number', value: 64, min: 6, max: 400, show: (x) => x.kind === 'text' },
    { name: 'scale', label: 'Ancho de la imagen (% de la página)', type: 'number', value: 50, min: 5, max: 100, show: (x) => x.kind === 'image' },
    { name: 'color', label: 'Color', type: 'color', value: '#c8102e', show: (x) => x.kind === 'text' },
    { name: 'opacity', label: 'Opacidad (%)', type: 'number', value: 20, min: 1, max: 100 },
    { name: 'rot', label: 'Rotación (grados)', type: 'number', value: 45, min: -360, max: 360 },
    { name: 'pos', label: 'Posición', type: 'select', value: 'center', options: [['center', 'Centro'], ['tile', 'Mosaico (repetida)'], ['top', 'Arriba'], ['bottom', 'Abajo']] },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
  ], { ok: 'Aplicar', layout: (b, els) => b.append(els[0], els[1], els[2], h('div', { class: 'grid2' }, els[3], els[4], els[5], els[6], els[7], els[8]), els[9], els[10]) });
  if (!v) return;
  let idx;
  try { idx = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  const imgSrc = v.kind === 'image' && v.file?.[0] ? await readDataURL(v.file[0]) : null;
  if (v.kind === 'image' && !imgSrc) { toast('Elegí una imagen', 'err'); return; }
  await docOp('Agregando marca de agua…', async (doc) => {
    const f = await doc.embedFont(StandardFonts[STD_FONT[v.font || 'helv'][1]]);
    let img = null;
    if (imgSrc) { const im = await normalizeImage(imgSrc); const b = dataURLtoBytes(im.src); img = /png/.test(im.src.slice(0, 20)) ? await doc.embedPng(b) : await doc.embedJpg(b); }
    const op = (v.opacity || 20) / 100;
    const text = winAnsi(v.text || '');
    await drawOnPages(doc, idx, (page, { W, H }) => {
      let w, hh;
      if (img) { w = W * (v.scale || 50) / 100; hh = w * img.height / img.width; }
      else { w = f.widthOfTextAtSize(text, v.size); hh = v.size * 0.7; }
      const draw = (cx, cy) => {
        const o = rotatedOrigin(cx, cy, w, hh, v.rot);
        if (img) page.drawImage(img, { x: o.x, y: o.y, width: w, height: hh, rotate: degrees(v.rot), opacity: op });
        else page.drawText(text, { x: o.x, y: o.y, size: v.size, font: f, color: hexToRgb(v.color), opacity: op, rotate: degrees(v.rot) });
      };
      if (v.pos === 'tile') {
        const sx = Math.max(w, hh) * 1.25 + 40, sy = Math.max(hh, 60) * 3;
        for (let y = sy / 2; y < H + sy; y += sy) for (let x = (Math.round(y / sy) % 2) * sx / 2; x < W + sx; x += sx) draw(x, y);
      } else draw(W / 2, v.pos === 'top' ? H - hh - 30 : v.pos === 'bottom' ? hh + 30 : H / 2);
    });
  });
}

/* ---------- encabezado, pie, numeración y Bates ---------- */
async function headerFooterDialog(preset) {
  const isBates = preset === 'bates';
  const fields = [
    { name: 'hl', label: 'Encabezado izquierdo', value: '' }, { name: 'hc', label: 'Encabezado centro', value: '' }, { name: 'hr', label: 'Encabezado derecho', value: '' },
    { name: 'fl', label: 'Pie izquierdo', value: '' }, { name: 'fc', label: 'Pie centro', value: preset === 'numbers' ? 'Página {p} de {n}' : '' }, { name: 'fr', label: 'Pie derecho', value: isBates ? '{bates}' : '' },
    { name: 'font', label: 'Fuente', type: 'select', value: 'helv', options: FONT_NAMES }, { name: 'size', label: 'Tamaño', type: 'number', value: isBates ? 10 : 10, min: 5, max: 72 },
    { name: 'color', label: 'Color', type: 'color', value: isBates ? '#000000' : '#333333' },
    { name: 'mtop', label: 'Margen superior (mm)', type: 'number', value: 10, min: 0, step: 0.5 }, { name: 'mbot', label: 'Margen inferior (mm)', type: 'number', value: 10, min: 0, step: 0.5 },
    { name: 'mside', label: 'Margen lateral (mm)', type: 'number', value: 15, min: 0, step: 0.5 },
    { name: 'start', label: 'Primer número de página', type: 'number', value: 1, min: 0 },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
    { name: 'bprefix', label: 'Prefijo Bates', value: isBates ? 'DOC' : '' }, { name: 'bstart', label: 'Número inicial Bates', type: 'number', value: 1, min: 0 },
    { name: 'bdigits', label: 'Dígitos', type: 'number', value: 6, min: 1, max: 12 }, { name: 'bsuffix', label: 'Sufijo Bates', value: '' },
  ];
  const v = await formDialog(isBates ? 'Numeración Bates' : preset === 'numbers' ? 'Numerar páginas' : 'Encabezado y pie de página', fields, {
    ok: 'Aplicar', wide: true,
    layout: (b, els) => b.append(
      h('p', { class: 'props-help' }, 'Variables: {p} página · {n} total de páginas · {fecha} · {archivo} · {bates} número Bates'),
      h('div', { class: 'grid3' }, ...els.slice(0, 6)), h('div', { class: 'grid3' }, ...els.slice(6, 12)), h('div', { class: 'grid2' }, els[12], els[13]),
      h('details', { open: isBates }, h('summary', {}, 'Numeración Bates'), h('div', { class: 'grid2', style: { marginTop: '8px' } }, ...els.slice(14)))),
  });
  if (!v) return;
  let idx;
  try { idx = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  const slots = [['hl', 'top', 'left'], ['hc', 'top', 'center'], ['hr', 'top', 'right'], ['fl', 'bot', 'left'], ['fc', 'bot', 'center'], ['fr', 'bot', 'right']].filter(([k]) => v[k].trim());
  if (!slots.length) { toast('Escribí al menos un texto', 'err'); return; }
  const total = idx.length;
  await docOp('Agregando encabezado y pie…', async (doc) => {
    const f = await doc.embedFont(StandardFonts[STD_FONT[v.font][0]]);
    await drawOnPages(doc, idx, (page, { W, H, j }) => {
      const k = idx.indexOf(j);
      const vars = {
        p: String((v.start ?? 1) + k), n: String(total + (v.start ?? 1) - 1), fecha: today(), archivo: baseName(S.fileName),
        bates: (v.bprefix || '') + String((v.bstart ?? 1) + k).padStart(v.bdigits || 6, '0') + (v.bsuffix || ''),
      };
      for (const [key, pos, al] of slots) {
        const t = winAnsi(v[key].replace(/\{(\w+)\}/g, (m, n) => vars[n] ?? m));
        const tw = f.widthOfTextAtSize(t, v.size);
        const x = al === 'left' ? mm2pt(v.mside) : al === 'right' ? W - mm2pt(v.mside) - tw : (W - tw) / 2;
        const y = pos === 'top' ? H - mm2pt(v.mtop) - v.size * 0.75 : mm2pt(v.mbot);
        page.drawText(t, { x, y, size: v.size, font: f, color: hexToRgb(v.color) });
      }
    });
  });
}

/* ---------- propiedades del documento ---------- */
async function propertiesDialog() {
  if (!S.pdf) return;
  const meta = await S.pdf.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const head = new TextDecoder().decode(S.bytes.slice(0, 16)).match(/%PDF-(\d\.\d)/);
  const pg = S.pages[S.current];
  const fmtDate = (d) => { const x = pdfjsLib.PDFDateString?.toDateObject?.(d); return x ? x.toLocaleString('es-AR') : (d || '—'); };
  const fields = await S.pdf.getFieldObjects().catch(() => null);
  const table = h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginBottom: '12px' } },
    ...[
      ['Archivo', S.fileName], ['Tamaño', fmtBytes(S.bytes.length)], ['Páginas', S.pages.length], ['Versión PDF', head ? head[1] : '—'],
      ['Tamaño de página', pg ? `${(pg.w / 72 * 25.4).toFixed(1)} × ${(pg.h / 72 * 25.4).toFixed(1)} mm (${pg.w.toFixed(0)} × ${pg.h.toFixed(0)} pt)` : '—'],
      ['Creado', fmtDate(info.CreationDate)], ['Modificado', fmtDate(info.ModDate)], ['Aplicación', info.Creator || '—'], ['Productor PDF', info.Producer || '—'],
      ['Protegido', S.wasEncrypted ? 'Sí (desbloqueado para edición)' : 'No'], ['Seguridad al guardar', S.encryption ? 'Con contraseña' : 'Ninguna'],
      ['Formularios', fields ? Object.keys(fields).length + ' campo(s)' : 'No'], ['PDF etiquetado', info.IsTagged ?? meta.info?.Marked ? 'Sí' : 'No'], ['Linealizado (web rápida)', info.IsLinearized ? 'Sí' : 'No'],
    ].map(([k, val]) => h('tr', {}, h('td', { style: { color: 'var(--muted)', padding: '3px 8px 3px 0', whiteSpace: 'nowrap' } }, k), h('td', { style: { padding: '3px 0' } }, String(val)))));
  const v = await formDialog('Propiedades del documento', [
    { name: 'tbl', type: 'html', html: table },
    { name: 'title', label: 'Título', value: info.Title || '' }, { name: 'author', label: 'Autor', value: info.Author || '' },
    { name: 'subject', label: 'Asunto', value: info.Subject || '' }, { name: 'keywords', label: 'Palabras clave', value: info.Keywords || '' },
    { name: 'creator', label: 'Aplicación', value: info.Creator || '' }, { name: 'producer', label: 'Productor', value: info.Producer || '' },
    { name: 'displayTitle', label: 'Mostrar el título (en vez del nombre de archivo) al abrir', type: 'checkbox', value: false },
  ], { ok: 'Guardar propiedades', wide: true, layout: (b, els) => b.append(els[0], h('div', { class: 'grid2' }, ...els.slice(1, 7)), els[7]) });
  if (!v) return;
  await docOp('Actualizando propiedades…', (doc) => {
    doc.setTitle(v.title, { showInWindowTitleBar: v.displayTitle }); doc.setAuthor(v.author); doc.setSubject(v.subject);
    doc.setKeywords(v.keywords.split(/[,;]\s*/).filter(Boolean)); doc.setCreator(v.creator); doc.setProducer(v.producer); doc.setModificationDate(new Date());
  });
  toast('Propiedades actualizadas', 'ok');
}

/* ---------- adjuntos ---------- */
async function listAttachments() {
  try { const doc = await loadLib(S.bytes); return doc.getAttachments(); } catch (e) { console.warn(e); return []; }
}
async function addAttachment() {
  const files = await pickFiles({ accept: '*/*', multiple: true });
  if (!files.length) return;
  await docOp('Adjuntando archivos…', async (doc) => {
    for (const f of files) await doc.attach(await readBytes(f), f.name, { mimeType: f.type || 'application/octet-stream', description: f.name, creationDate: new Date(f.lastModified), modificationDate: new Date(f.lastModified) });
  });
  showSide('attachments');
}
async function removeAttachment(name) {
  if (!(await confirmBox('Quitar adjunto', `¿Quitar "${name}" del documento?`, 'Quitar'))) return;
  await docOp('Quitando adjunto…', (doc) => { doc.detach(name); }, { gc: true });
  showSide('attachments');
}

/* ---------- marcadores ---------- */
async function readOutline() {
  const ol = await S.pdf.getOutline().catch(() => null);
  if (!ol) return [];
  const conv = async (items) => Promise.all(items.map(async (it) => ({ title: it.title, page: it.dest ? await resolveDest(it.dest) : null, url: it.url || null, children: it.items?.length ? await conv(it.items) : [] })));
  return conv(ol);
}
async function editableOutline() {
  if (!S.outline) S.outline = await readOutline();
  return S.outline;
}
async function addBookmark() {
  if (!S.pdf) return;
  const sel = window.getSelection()?.toString().trim();
  const v = await formDialog('Nuevo marcador', [
    { name: 'title', label: 'Título', value: sel ? sel.slice(0, 120) : 'Página ' + (S.current + 1) },
    { name: 'page', label: 'Página de destino', type: 'number', value: S.current + 1, min: 1, max: S.pages.length },
  ], { ok: 'Agregar' });
  if (!v) return;
  pushUndo();
  const tree = await editableOutline();
  tree.push({ title: v.title, page: clamp(v.page - 1, 0, S.pages.length - 1), children: [] });
  tree.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9));
  showSide('bookmarks');
}
async function autoBookmarks() {
  if (!(await confirmBox('Marcadores automáticos', 'Se crearán marcadores a partir de los títulos detectados (texto de mayor tamaño). Los marcadores existentes se reemplazarán.', 'Crear'))) return;
  const res = await withBusy('Detectando títulos…', async () => {
    const all = [];
    for (let i = 0; i < S.pages.length; i++) { const lines = await pageLines(i); lines.forEach((l) => all.push({ ...l, page: i })); }
    if (!all.length) return [];
    const sizes = all.map((l) => Math.round(l.fs)).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)];
    const big = [...new Set(all.filter((l) => l.fs > body * 1.25 && l.text.trim().length > 2 && l.text.length < 120).map((l) => Math.round(l.fs)))].sort((a, b) => b - a).slice(0, 2);
    const tree = [];
    for (const l of all) {
      const lvl = big.indexOf(Math.round(l.fs));
      if (lvl < 0) continue;
      const node = { title: l.text.trim(), page: l.page, children: [] };
      if (lvl === 0 || !tree.length) tree.push(node); else tree[tree.length - 1].children.push(node);
    }
    return tree;
  });
  if (!res) return;
  if (!res.length) { toast('No se detectaron títulos', 'err'); return; }
  pushUndo();
  S.outline = res;
  showSide('bookmarks');
  toast(`${res.length} marcador(es) creados`, 'ok');
}

/* ---------- seguridad ---------- */
async function encryptDialog() {
  const v = await formDialog('Proteger con contraseña', [
    { name: 'user', label: 'Contraseña para abrir el documento', type: 'password', value: '', help: 'Dejala vacía para permitir abrirlo sin contraseña y solo restringir permisos' },
    { name: 'user2', label: 'Repetir contraseña', type: 'password', value: '' },
    { name: 'owner', label: 'Contraseña de permisos (propietario)', type: 'password', value: '', help: 'Necesaria para cambiar los permisos. Si la dejás vacía se genera una al azar.' },
    { name: 'print', label: 'Permitir imprimir', type: 'checkbox', value: true },
    { name: 'copy', label: 'Permitir copiar texto e imágenes', type: 'checkbox', value: true },
    { name: 'modify', label: 'Permitir modificar el documento', type: 'checkbox', value: false },
    { name: 'annot', label: 'Permitir comentarios', type: 'checkbox', value: true },
    { name: 'forms', label: 'Permitir rellenar formularios', type: 'checkbox', value: true },
    { name: 'assembly', label: 'Permitir insertar, rotar o eliminar páginas', type: 'checkbox', value: false },
    { name: 'algo', label: 'Cifrado', type: 'select', value: 'AES-256', options: [['AES-256', 'AES de 256 bits (recomendado)'], ['AES-128', 'AES de 128 bits (compatibilidad con Acrobat 7)']] },
  ], {
    ok: 'Aplicar',
    validate: (x) => (x.user !== x.user2 ? 'Las contraseñas no coinciden' : !x.user && !x.owner && x.print && x.copy && x.modify && x.annot && x.forms && x.assembly ? 'Definí una contraseña o restringí algún permiso' : null),
  });
  if (!v) return false;
  const owner = v.owner || [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36)).join('');
  S.encryption = {
    userPassword: v.user, ownerPassword: owner, algorithm: v.algo,
    permissions: { printing: v.print ? 'highResolution' : false, copying: v.copy, modifying: v.modify, annotating: v.annot, fillingForms: v.forms, contentAccessibility: true, documentAssembly: v.assembly },
  };
  S.dirty = true;
  toast('La protección se aplicará al guardar el documento', 'ok', 4500);
  return true;
}
async function removeSecurity() {
  if (!S.encryption && !S.wasEncrypted) { toast('Este documento no tiene seguridad'); return; }
  S.encryption = null;
  S.dirty = true;
  toast('La seguridad se quitará al guardar el documento', 'ok');
}
async function sanitizeDialog() {
  const v = await formDialog('Quitar información oculta', [
    { name: 'meta', label: 'Metadatos (autor, título, aplicación, XMP)', type: 'checkbox', value: true },
    { name: 'js', label: 'JavaScript y acciones automáticas', type: 'checkbox', value: true },
    { name: 'att', label: 'Archivos adjuntos', type: 'checkbox', value: true },
    { name: 'comments', label: 'Comentarios y anotaciones (conserva enlaces y formularios)', type: 'checkbox', value: false },
    { name: 'thumbs', label: 'Miniaturas incrustadas y datos privados de aplicaciones', type: 'checkbox', value: true },
    { name: 'links', label: 'Enlaces', type: 'checkbox', value: false },
  ], { ok: 'Quitar' });
  if (!v) return;
  const N = (n) => PDFName.of(n);
  await docOp('Limpiando documento…', (doc) => {
    const cat = doc.catalog;
    const ctx = doc.context;
    if (v.meta) {
      const info = ctx.lookup(ctx.trailerInfo.Info);
      if (info instanceof PDFDict) for (const k of [...info.keys()]) info.delete(k);
      cat.delete(N('Metadata'));
      for (const p of doc.getPages()) p.node.delete(N('Metadata'));
    }
    const names = cat.lookup(N('Names'));
    if (v.js) {
      cat.delete(N('OpenAction')); cat.delete(N('AA'));
      if (names instanceof PDFDict) names.delete(N('JavaScript'));
      for (const p of doc.getPages()) {
        p.node.delete(N('AA'));
        const annots = p.node.lookup(N('Annots'));
        if (annots instanceof PDFArray) for (let i = 0; i < annots.size(); i++) {
          const a = annots.lookup(i);
          if (!(a instanceof PDFDict)) continue;
          a.delete(N('AA'));
          const act = a.lookup(N('A'));
          if (act instanceof PDFDict && String(act.get(N('S'))) === '/JavaScript') a.delete(N('A'));
        }
      }
      const af = cat.lookup(N('AcroForm'));
      if (af instanceof PDFDict) { af.delete(N('XFA')); }
    }
    if (v.att && names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
    if (v.comments || v.links || v.att) {
      for (const p of doc.getPages()) {
        const annots = p.node.lookup(N('Annots'));
        if (!(annots instanceof PDFArray)) continue;
        const keep = [];
        for (let i = 0; i < annots.size(); i++) {
          const a = annots.lookup(i);
          const sub = a instanceof PDFDict ? String(a.get(N('Subtype'))) : '';
          const isLink = sub === '/Link', isWidget = sub === '/Widget';
          if ((sub === '/FileAttachment' && v.att) || (isLink && v.links) || (!isLink && !isWidget && v.comments && sub !== '/FileAttachment')) continue;
          keep.push(annots.get(i));
        }
        p.node.set(N('Annots'), ctx.obj(keep));
      }
    }
    if (v.thumbs) { for (const p of doc.getPages()) { p.node.delete(N('Thumb')); p.node.delete(N('PieceInfo')); } cat.delete(N('PieceInfo')); }
  }, { gc: true });
  toast('Información oculta eliminada', 'ok');
}

/* ---------- redacción ---------- */
async function applyRedactions({ confirm = true } = {}) {
  const pagesWith = S.objects.map((a, i) => (a.some((o) => o.type === 'redact') ? i : -1)).filter((i) => i >= 0);
  if (!pagesWith.length) { toast('No hay áreas marcadas para redactar. Usá "Marcar para redactar" o "Buscar y redactar".'); return; }
  let opts = { color: '#000000', label: '', dpi: 200 };
  if (confirm) {
    const v = await formDialog('Aplicar redacciones', [
      { name: 'info', type: 'html', html: `<p>Se eliminará de forma permanente el contenido de las áreas marcadas en ${pagesWith.length} página(s).</p><p class="props-help">Para garantizar que el contenido no pueda recuperarse, esas páginas se convierten en imagen (su texto deja de ser seleccionable; podés usar OCR después).</p>` },
      { name: 'color', label: 'Color de relleno', type: 'color', value: '#000000' },
      { name: 'label', label: 'Texto superpuesto (opcional)', value: '', placeholder: 'Ej.: REDACTADO' },
      { name: 'dpi', label: 'Resolución de las páginas', type: 'select', value: '200', options: [['150', '150 ppp'], ['200', '200 ppp'], ['300', '300 ppp']] },
    ], { ok: 'Aplicar redacciones' });
    if (!v) return;
    opts = { color: v.color, label: v.label, dpi: +v.dpi };
  }
  const ok = await docOp('Aplicando redacciones…', async (doc) => {
    const pages = doc.getPages();
    const list = pages.slice();
    for (const j of pagesWith) {
      const pg = S.pages[j];
      const k = opts.dpi / 72;
      const c = await renderToCanvas(pg.proxy, k);
      const ctx = c.getContext('2d');
      for (const o of S.objects[j].filter((x) => x.type === 'redact')) {
        ctx.fillStyle = opts.color;
        ctx.fillRect(o.x * k, o.y * k, o.w * k, o.h * k);
        if (opts.label) {
          ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.min(o.h * 0.6, 14) * k}px Arial`;
          ctx.fillText(opts.label, (o.x + o.w / 2) * k, (o.y + o.h / 2) * k, o.w * k * 0.95);
        }
      }
      const img = await doc.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.9));
      const np = doc.addPage([pg.w, pg.h]);
      np.drawImage(img, { x: 0, y: 0, width: pg.w, height: pg.h });
      list[j] = np;
    }
    setPageOrder(doc, list);
    return { map: pages.map((_, i) => i), sameDisplay: new Set(pagesWith) };
  }, { gc: true });
  if (!ok) return;
  for (let i = 0; i < S.objects.length; i++) S.objects[i] = S.objects[i].filter((o) => o.type !== 'redact');
  renderAllOverlays();
  toast('Redacciones aplicadas', 'ok');
}
const REDACT_PATTERNS = {
  email: [/[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[a-z]{2,}/giu, 'Direcciones de correo'],
  phone: [/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/g, 'Números de teléfono'],
  id: [/\b\d{1,2}\.?\d{3}\.?\d{3}\b|\b\d{2}-\d{8}-\d\b/g, 'DNI / CUIT / CUIL'],
  card: [/\b(?:\d[ -]?){13,16}\b/g, 'Tarjetas de crédito'],
  date: [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, 'Fechas'],
};
async function searchRedactDialog() {
  const v = await formDialog('Buscar y redactar', [
    { name: 'mode', label: 'Buscar', type: 'select', value: 'text', options: [['text', 'Palabra o frase'], ['pattern', 'Patrón'], ['regex', 'Expresión regular']] },
    { name: 'text', label: 'Texto (varias palabras separadas por ; )', value: window.getSelection()?.toString().trim() || '', show: (x) => x.mode === 'text' },
    { name: 'pattern', label: 'Patrón', type: 'select', value: 'email', options: Object.entries(REDACT_PATTERNS).map(([k, [, l]]) => [k, l]), show: (x) => x.mode === 'pattern' },
    { name: 'regex', label: 'Expresión regular', value: '', show: (x) => x.mode === 'regex' },
    { name: 'cs', label: 'Distinguir mayúsculas y minúsculas', type: 'checkbox', show: (x) => x.mode === 'text' },
    { name: 'ww', label: 'Solo palabras completas', type: 'checkbox', show: (x) => x.mode === 'text' },
  ], { ok: 'Buscar' });
  if (!v) return;
  const queries = [];
  try {
    if (v.mode === 'text') v.text.split(';').map((s) => s.trim()).filter(Boolean).forEach((q) => queries.push(q));
    else if (v.mode === 'pattern') queries.push(REDACT_PATTERNS[v.pattern][0]);
    else queries.push(new RegExp(v.regex, 'giu'));
  } catch (e) { toast('Expresión no válida: ' + e.message, 'err'); return; }
  if (!queries.length) return;
  const hits = await withBusy('Buscando…', async () => {
    const all = [];
    for (const q of queries) all.push(...(await findAll(q, { caseSensitive: v.cs, wholeWord: v.ww })));
    return all;
  });
  if (!hits?.length) { toast('No se encontraron coincidencias', 'err'); return; }
  const ok = await confirmBox('Buscar y redactar', `Se encontraron ${hits.length} coincidencia(s). ¿Marcarlas para redactar?\n\nPodés revisarlas y quitar las que no correspondan antes de aplicar.`, 'Marcar');
  if (!ok) return;
  pushUndo();
  for (const hit of hits) for (const r of hit.rects) S.objects[hit.page].push({ id: uid(), page: hit.page, type: 'redact', x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
  renderAllOverlays();
  goToPage(hits[0].page);
  toast('Marcadas. Usá "Aplicar redacciones" para eliminarlas definitivamente.', 'ok', 5000);
}

/* ---------- OCR ---------- */
function loadScript(src) {
  return new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('No se pudo descargar ' + src + '. El OCR necesita conexión a internet la primera vez.')); document.head.append(s); });
}
async function ocrDialog() {
  const v = await formDialog('Reconocer texto (OCR)', [
    { name: 'info', type: 'html', html: '<p class="props-help">Convierte páginas escaneadas en texto seleccionable y buscable. El motor de OCR (Tesseract) se descarga de internet la primera vez; el procesamiento ocurre en tu equipo.</p>' },
    { name: 'lang', label: 'Idioma', type: 'select', value: 'spa', options: [['spa', 'Español'], ['eng', 'Inglés'], ['spa+eng', 'Español + Inglés'], ['por', 'Portugués'], ['fra', 'Francés'], ['deu', 'Alemán'], ['ita', 'Italiano']] },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
    { name: 'dpi', label: 'Resolución', type: 'select', value: '300', options: [['200', '200 ppp (rápido)'], ['300', '300 ppp (recomendado)']] },
    { name: 'skip', label: 'Omitir páginas que ya tienen texto', type: 'checkbox', value: true },
  ], { ok: 'Reconocer' });
  if (!v) return;
  let idx;
  try { idx = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  const results = await withBusy('Cargando motor de OCR…', async () => {
    if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    let pageNo = 0;
    const worker = await window.Tesseract.createWorker(v.lang, 1, {
      logger: (m) => { if (m.status === 'recognizing text') progress((pageNo + m.progress) / idx.length, `Reconociendo página ${pageNo + 1} de ${idx.length}…`); },
    });
    const out = new Map();
    const k = +v.dpi / 72;
    for (const [n, j] of idx.entries()) {
      pageNo = n;
      if (v.skip) { const tc = await getText(j); if (tc.items.some((it) => it.str.trim())) continue; }
      const c = await renderToCanvas(S.pages[j].proxy, k);
      const { data } = await worker.recognize(c);
      out.set(j, (data.words || []).filter((w) => w.text.trim() && w.confidence > 30).map((w) => ({
        text: w.text, x: w.bbox.x0 / k, y: w.bbox.y0 / k, w: (w.bbox.x1 - w.bbox.x0) / k, h: (w.bbox.y1 - w.bbox.y0) / k,
        base: w.baseline && w.baseline.y0 > w.bbox.y0 ? ((w.baseline.y0 + w.baseline.y1) / 2) / k : null,
      })));
    }
    await worker.terminate();
    return out;
  });
  if (!results) return;
  if (!results.size) { toast('Todas las páginas ya tenían texto. Desmarcá "Omitir páginas…" para forzar.'); return; }
  const { beginText, endText, setFontAndSize, setTextMatrix, showText, setTextRenderingMode, TextRenderingMode } = PDFLib;
  let words = 0;
  await docOp('Agregando capa de texto…', async (doc) => {
    const f = await doc.embedFont(StandardFonts.Helvetica);
    await drawOnPages(doc, [...results.keys()], (page, { H, j }) => {
      const key = page.node.newFontDictionary('OCR', f.ref);
      for (const w of results.get(j)) {
        const t = winAnsi(w.text);
        const size = Math.max(2, w.h * 0.92);
        const tw = f.widthOfTextAtSize(t, size);
        if (!tw) continue;
        const base = w.base ?? (w.y + w.h * 0.8);
        page.pushOperators(beginText(), setFontAndSize(key, size), setTextRenderingMode(TextRenderingMode.Invisible),
          setTextMatrix(w.w / tw, 0, 0, 1, w.x, H - base), showText(f.encodeText(t)), endText());
        words++;
      }
    });
  });
  toast(`OCR completado: ${words} palabra(s) reconocidas en ${results.size} página(s)`, 'ok', 5000);
}

/* ---------- optimizar ---------- */
async function optimizeDialog() {
  const v = await formDialog('Optimizar PDF (reducir tamaño)', [
    { name: 'images', label: 'Recomprimir imágenes', type: 'checkbox', value: true },
    { name: 'quality', label: 'Calidad JPEG (%)', type: 'number', value: 70, min: 10, max: 95, show: (x) => x.images },
    { name: 'maxpx', label: 'Lado máximo de las imágenes (píxeles)', type: 'select', value: '2000', options: [['1200', '1200 (pantalla)'], ['2000', '2000 (equilibrado)'], ['3000', '3000 (impresión)'], ['99999', 'Sin reducir']], show: (x) => x.images },
    { name: 'unused', label: 'Eliminar objetos no utilizados', type: 'checkbox', value: true },
    { name: 'meta', label: 'Quitar metadatos XMP y miniaturas', type: 'checkbox', value: false },
  ], { ok: 'Optimizar' });
  if (!v) return;
  const before = S.bytes.length;
  let changedImgs = 0;
  const ok = await docOp('Optimizando…', async (doc) => {
    const ctx = doc.context;
    if (v.images) {
      const objs = ctx.enumerateIndirectObjects();
      let n = 0;
      for (const [ref, obj] of objs) {
        n++;
        if (n % 20 === 0) progress(n / objs.length, 'Analizando imágenes…');
        if (!(obj instanceof PDFRawStream)) continue;
        const d = obj.dict;
        if (String(d.get(PDFName.of('Subtype'))) !== '/Image' || d.get(PDFName.of('ImageMask'))?.asBoolean?.() || d.get(PDFName.of('Decode'))) continue;
        try {
          const nb = await recompressImage(ctx, obj, v.quality / 100, +v.maxpx);
          if (nb) { ctx.assign(ref, nb); changedImgs++; }
        } catch (e) { console.warn('imagen omitida', e); }
      }
    }
    if (v.meta) { doc.catalog.delete(PDFName.of('Metadata')); for (const p of doc.getPages()) { p.node.delete(PDFName.of('Thumb')); p.node.delete(PDFName.of('PieceInfo')); } }
  }, { gc: v.unused });
  if (!ok) return;
  const after = S.bytes.length;
  await alertBox('Optimización terminada', `Tamaño original: ${fmtBytes(before)}\nTamaño nuevo: ${fmtBytes(after)} (${after <= before ? '−' : '+'}${Math.abs(100 - after / before * 100).toFixed(1)}%)\nImágenes recomprimidas: ${changedImgs}\n\nGuardá el documento para conservar el resultado.`);
}
async function recompressImage(ctx, obj, quality, maxPx) {
  const d = obj.dict;
  const num = (k) => d.lookup(PDFName.of(k))?.asNumber?.();
  const w = num('Width'), hh = num('Height'), bpc = num('BitsPerComponent');
  let filter = d.lookup(PDFName.of('Filter'));
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : null;
  const fname = filter ? String(filter) : '';
  let cs = d.lookup(PDFName.of('ColorSpace'));
  let comps = 0;
  if (cs instanceof PDFName) comps = { '/DeviceRGB': 3, '/DeviceGray': 1 }[String(cs)] || 0;
  else if (cs instanceof PDFArray && String(cs.get(0)) === '/ICCBased') comps = cs.lookup(1)?.dict?.lookup(PDFName.of('N'))?.asNumber?.() || 0;
  if (comps !== 1 && comps !== 3) return null;
  if (!w || !hh || w * hh < 40000) return null;
  let bitmap;
  if (fname === '/DCTDecode') bitmap = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
  else if (fname === '/FlateDecode' && bpc === 8) {
    const raw = PDFLib.decodePDFRawStream(obj).decode();
    if (raw.length < w * hh * comps) return null;
    const id = new ImageData(w, hh);
    for (let i = 0, p = 0; i < w * hh; i++, p += comps) {
      id.data[i * 4] = raw[p]; id.data[i * 4 + 1] = raw[p + (comps === 3 ? 1 : 0)]; id.data[i * 4 + 2] = raw[p + (comps === 3 ? 2 : 0)]; id.data[i * 4 + 3] = 255;
    }
    bitmap = await createImageBitmap(id);
  } else return null;
  const k = Math.min(1, maxPx / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
  const cx = c.getContext('2d');
  cx.drawImage(bitmap, 0, 0, c.width, c.height);
  const bytes = await canvasToBytes(c, 'image/jpeg', quality);
  if (bytes.length > obj.contents.length * 0.9) return null;
  const nd = { Type: 'XObject', Subtype: 'Image', Width: c.width, Height: c.height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' };
  const dict = ctx.obj(nd);
  for (const key of ['SMask', 'Mask', 'Intent', 'Interpolate', 'OC']) { const val = d.get(PDFName.of(key)); if (val) dict.set(PDFName.of(key), val); }
  return PDFRawStream.of(dict, bytes);
}
async function rasterCompressDialog() {
  const v = await formDialog('Comprimir convirtiendo a imagen', [
    { name: 'info', type: 'html', html: '<p class="props-help">Máxima reducción para documentos escaneados o con muchas imágenes: cada página se convierte en una imagen JPEG. El texto deja de ser seleccionable (podés aplicar OCR después).</p>' },
    { name: 'dpi', label: 'Resolución', type: 'select', value: '120', options: [['72', '72 ppp (mínimo)'], ['96', '96 ppp'], ['120', '120 ppp'], ['150', '150 ppp'], ['200', '200 ppp']] },
    { name: 'q', label: 'Calidad JPEG (%)', type: 'number', value: 65, min: 10, max: 95 },
    { name: 'gray', label: 'Convertir a escala de grises', type: 'checkbox', value: false },
  ], { ok: 'Comprimir' });
  if (!v) return;
  const before = S.bytes.length;
  const bytes = await withBusy('Comprimiendo…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    const out = await PDFDocument.create();
    for (let i = 0; i < pdf.numPages; i++) {
      progress(i / pdf.numPages, `Página ${i + 1} de ${pdf.numPages}…`);
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const c = await renderToCanvas(page, +v.dpi / 72);
      if (v.gray) { const cx = c.getContext('2d'); cx.globalCompositeOperation = 'saturation'; cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height); }
      const img = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', v.q / 100));
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    }
    await pdf.destroy();
    return out.save();
  });
  if (!bytes) return;
  await replaceDocument(bytes);
  await alertBox('Compresión terminada', `Tamaño original: ${fmtBytes(before)}\nTamaño nuevo: ${fmtBytes(bytes.length)}\n\nGuardá el documento para conservar el resultado (podés deshacer con Ctrl+Z).`);
}
async function replaceDocument(bytes) {
  pushUndo();
  S.objects = [];
  S.outline = null;
  S.sel = null;
  await loadPdfJs(bytes, { keepView: true });
}

/* ---------- formularios ---------- */
// Quita del formulario los widgets cuyas páginas ya no existen (por ejemplo, páginas eliminadas)
function pruneOrphanFields(doc) {
  const live = new Set();
  for (const p of doc.getPages()) {
    const annots = p.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) for (let i = 0; i < annots.size(); i++) { const r = annots.get(i); if (r instanceof PDFRef) live.add(r.tag); }
  }
  const form = doc.getForm();
  for (const f of form.getFields()) {
    try {
      const kids = f.acroField.dict.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray && kids.size()) {
        const keep = [];
        for (let i = 0; i < kids.size(); i++) { const r = kids.get(i); if (!(r instanceof PDFRef) || live.has(r.tag) || f.acroField.dict.context.lookup(r)?.has?.(PDFName.of('T'))) keep.push(r); }
        if (keep.length !== kids.size()) f.acroField.dict.set(PDFName.of('Kids'), doc.context.obj(keep));
        if (!keep.length) form.acroForm.removeField(f.acroField);
      } else if (!live.has(f.ref.tag)) form.acroForm.removeField(f.acroField);
    } catch (e) { console.warn('campo huérfano', e); }
  }
  return form;
}
async function flattenForm() {
  if (!(await confirmBox('Aplanar formulario', 'Los campos se convertirán en contenido fijo de la página y ya no podrán editarse.', 'Aplanar'))) return;
  await docOp('Aplanando formulario…', (doc) => {
    const form = pruneOrphanFields(doc);
    if (!form.getFields().length) { toast('El documento no tiene campos de formulario'); return false; }
    try { form.updateFieldAppearances(); } catch (e) { console.warn(e); }
    form.flatten();
  });
}
async function readFormValues(bytes) {
  const doc = await loadLib(bytes);
  const out = {};
  for (const f of doc.getForm().getFields()) {
    const n = f.getName();
    const t = f.constructor.name;
    try {
      if (f instanceof PDFLib.PDFTextField) out[n] = f.getText() ?? '';
      else if (f instanceof PDFLib.PDFCheckBox) out[n] = f.isChecked();
      else if (f instanceof PDFLib.PDFRadioGroup) out[n] = f.getSelected() ?? null;
      else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) out[n] = f.getSelected();
      else out[n] = null;
    } catch { out[n] = null; void t; }
  }
  return out;
}
async function exportFormData() {
  const data = await withBusy('Leyendo formulario…', async () => readFormValues(await getBaseBytes()));
  if (!data) return;
  if (!Object.keys(data).length) { toast('El documento no tiene campos de formulario'); return; }
  const v = await formDialog('Exportar datos del formulario', [{ name: 'fmt', label: 'Formato', type: 'select', value: 'json', options: [['json', 'JSON'], ['csv', 'CSV (Excel)']] }], { ok: 'Exportar' });
  if (!v) return;
  if (v.fmt === 'json') download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), baseName(S.fileName) + '_datos.json');
  else {
    const cell = (x) => { const s = Array.isArray(x) ? x.join(', ') : x == null ? '' : String(x); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + Object.keys(data).map(cell).join(';') + '\r\n' + Object.values(data).map(cell).join(';') + '\r\n';
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), baseName(S.fileName) + '_datos.csv');
  }
}
async function importFormData() {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('El archivo no es un JSON válido', 'err'); return; }
  let n = 0;
  await docOp('Importando datos…', (doc) => {
    const form = doc.getForm();
    for (const [name, val] of Object.entries(data)) {
      let f; try { f = form.getField(name); } catch { continue; }
      try {
        if (f instanceof PDFLib.PDFTextField) f.setText(val == null ? '' : winAnsi(String(val)));
        else if (f instanceof PDFLib.PDFCheckBox) (val ? f.check() : f.uncheck());
        else if (f instanceof PDFLib.PDFRadioGroup) (val ? f.select(String(val)) : f.clear());
        else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) f.select(Array.isArray(val) ? val : String(val));
        n++;
      } catch (e) { console.warn(name, e); }
    }
    try { form.updateFieldAppearances(); } catch (e) { console.warn(e); }
  });
  toast(`${n} campo(s) completados`, 'ok');
}
async function clearFormData() {
  if (!(await confirmBox('Borrar formulario', 'Se vaciarán todos los campos del formulario.', 'Borrar'))) return;
  await docOp('Borrando formulario…', (doc) => {
    for (const f of doc.getForm().getFields()) {
      try {
        if (f instanceof PDFLib.PDFTextField) f.setText('');
        else if (f instanceof PDFLib.PDFCheckBox) f.uncheck();
        else if (f instanceof PDFLib.PDFRadioGroup || f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) f.clear();
      } catch (e) { console.warn(e); }
    }
    try { doc.getForm().updateFieldAppearances(); } catch (e) { console.warn(e); }
  });
}
async function removeFormFields() {
  if (!(await confirmBox('Eliminar campos', 'Se eliminarán todos los campos de formulario del documento (sus valores también).', 'Eliminar'))) return;
  await docOp('Eliminando campos…', (doc) => { const form = pruneOrphanFields(doc); for (const f of form.getFields()) { try { form.removeField(f); } catch (e) { console.warn(e); } } }, { gc: true });
}
async function detectFormFields() {
  // Crea campos de texto sobre líneas de subrayado "____" y casillas sobre "[ ]" / "☐"
  const created = await withBusy('Detectando campos…', async () => {
    let n = 0;
    pushUndo();
    for (let i = 0; i < S.pages.length; i++) {
      for (const [q, ftype] of [[/_{4,}/g, 'text'], [/\[\s?\]|☐|□/g, 'check']]) {
        for (const hit of await findInPage(i, q, {})) {
          const r = hit.rects[0];
          const o = ftype === 'text' ? { x: r.x, y: r.y - r.h * 0.2, w: Math.max(30, r.w), h: Math.max(14, r.h * 1.1) } : { x: r.x, y: r.y + (r.h - 12) / 2, w: 12, h: 12 };
          S.objects[i].push({ id: uid(), page: i, type: 'field', ftype, ...o, name: (ftype === 'text' ? 'Texto' : 'Casilla') + (fieldCounter++) });
          n++;
        }
      }
    }
    return n;
  });
  renderAllOverlays();
  toast(created ? `${created} campo(s) detectados. Revisalos y guardá para crearlos.` : 'No se detectaron campos (se buscan líneas "____" y casillas "[ ]").', created ? 'ok' : '', 5000);
}

/* ---------- PDF/A ---------- */
async function pdfaDialog() {
  const v = await formDialog('Guardar como PDF/A', [
    { name: 'info', type: 'html', html: '<p class="props-help">Agrega la estructura de archivo PDF/A (perfil de color sRGB, identificador y metadatos XMP). No modifica el contenido de las páginas; para una validación formal usá una herramienta como veraPDF.</p>' },
    { name: 'conf', label: 'Nivel de conformidad', type: 'select', value: '2B', options: [['1B', 'PDF/A-1b'], ['2B', 'PDF/A-2b'], ['3B', 'PDF/A-3b']] },
  ], { ok: 'Convertir' });
  if (!v) return;
  if (S.encryption) { S.encryption = null; toast('Se quitó la contraseña: PDF/A no admite cifrado'); }
  await docOp('Convirtiendo a PDF/A…', async (doc) => {
    await drawObjectsIntoDoc(doc, { flattenComments: true });
    doc.convertToPDFA({ conformance: v.conf });
    return { map: doc.getPages().map((_, i) => i) };
  });
  // los objetos ya se incorporaron al documento
  S.objects = S.objects.map(() => []);
  renderAllOverlays();
  toast('Documento convertido a PDF/A-' + v.conf.toLowerCase() + '. Guardalo para conservarlo.', 'ok', 5000);
}
