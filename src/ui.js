/* Interfaz: cinta de opciones, barra superior, panel lateral, atajos de teclado e inicialización. */
const needDoc = (fn) => async (...a) => { if (!S.pdf) { toast('Abrí un documento primero', 'err'); return; } return fn(...a); };
const CMDS = {
  open: () => $('#fileInput').click(),
  save: needDoc(() => saveDoc()),
  saveAs: needDoc(() => saveDoc({ as: true })),
  print: needDoc(printDoc),
  undo, redo,
  prevPage: () => goToPage(S.current - 1), nextPage: () => goToPage(S.current + 1),
  zoomIn: () => zoomStep(1), zoomOut: () => zoomStep(-1),
  fitWidth: () => applyZoom('fitw'), fitPage: () => applyZoom('fitp'),
  twoPages: () => { S.layout = S.layout === 'two' ? 'single' : 'two'; pagesEl().classList.toggle('two', S.layout === 'two'); if (S.zoomMode !== 'custom') applyZoom(S.zoomMode); $$('[data-cmd="twoPages"]').forEach((b) => b.classList.toggle('active', S.layout === 'two')); },
  night: () => { document.body.classList.toggle('night'); $$('[data-cmd="night"]').forEach((b) => b.classList.toggle('active', document.body.classList.contains('night'))); },
  present: needDoc(presentation),
  readPage: needDoc(() => readAloud(false)), readFrom: needDoc(() => readAloud(true)),
  properties: needDoc(propertiesDialog), prefs: prefsDialog, help: helpDialog,
  searchNext: () => searchMove(1), searchPrev: () => searchMove(-1), searchOptions: searchOptionsDialog,
  commentsList: needDoc(() => showSide('comments')),
  watermark: needDoc(watermarkDialog), header: needDoc(() => headerFooterDialog()), numbers: needDoc(() => headerFooterDialog('numbers')), bates: needDoc(() => headerFooterDialog('bates')),
  cropMargins: needDoc(cropMarginsDialog), resize: needDoc(resizeDialog),
  organize: needDoc(() => toggleOrganizer()),
  rotl: needDoc(() => rotatePages(targetPages(), -90)), rotr: needDoc(() => rotatePages(targetPages(), 90)),
  delPages: needDoc(() => deletePages(targetPages())), dupPages: needDoc(() => duplicatePages(targetPages())),
  blank: needDoc(insertBlankDialog), insertFile: needDoc(insertFromFileDialog), replace: needDoc(replacePagesDialog),
  extract: needDoc(extractDialog), split: needDoc(splitDialog), merge: mergeDialog, reverse: needDoc(reversePages),
  hlFields: () => { document.body.classList.toggle('hl-fields'); $$('[data-cmd="hlFields"]').forEach((b) => b.classList.toggle('active', document.body.classList.contains('hl-fields'))); },
  detectFields: needDoc(detectFormFields), exportData: needDoc(exportFormData), importData: needDoc(importFormData), clearForm: needDoc(clearFormData),
  flattenForm: needDoc(flattenForm), removeFields: needDoc(removeFormFields),
  encrypt: needDoc(encryptDialog), removeSecurity: needDoc(removeSecurity), searchRedact: needDoc(searchRedactDialog), applyRedactions: needDoc(() => applyRedactions()),
  sanitize: needDoc(sanitizeDialog),
  toWord: needDoc(exportWord), toExcel: needDoc(exportCsv), toImages: needDoc(exportImagesDialog), toText: needDoc(exportTextFile), toHtml: needDoc(exportHtml),
  pdfa: needDoc(pdfaDialog), newBlank: newBlankDialog, fromImages: () => createFromImages(), fromText: createFromTextDialog,
  ocr: needDoc(ocrDialog), optimize: needDoc(optimizeDialog), compress: needDoc(rasterCompressDialog), compare: needDoc(compareDialog),
  attach: needDoc(addAttachment), addBookmark: needDoc(addBookmark), autoBookmarks: needDoc(autoBookmarks),
  toggleSide: () => { $('#main').classList.toggle('no-side'); if (S.zoomMode !== 'custom') applyZoom(S.zoomMode); },
  toggleProps: () => { $('#props').classList.toggle('collapsed'); if (S.zoomMode !== 'custom') applyZoom(S.zoomMode); },
  theme: () => {
    const cur = document.documentElement.dataset.theme || 'auto';
    const next = { auto: 'dark', dark: 'light', light: 'auto' }[cur];
    if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    lsSet('ma.theme', next);
    toast('Tema: ' + { auto: 'automático', dark: 'oscuro', light: 'claro' }[next]);
  },
  stampPick: () => chooseStamp(), sigManage: () => signatureManager('signature'),
};

const T = (id) => ({ tool: id }), C = (cmd, label, ic, title) => ({ cmd, label, icon: ic, title }), SEP = { sep: true };
const TABS = [
  { id: 'home', label: 'Inicio', items: [C('open', 'Abrir', 'open', 'Abrir PDF (Ctrl O)'), C('save', 'Guardar', 'save', 'Guardar (Ctrl S)'), C('saveAs', 'Guardar como', 'saveas', 'Guardar como (Ctrl Mayús S)'), C('print', 'Imprimir', 'print', 'Imprimir (Ctrl P)'), SEP,
    T('select'), T('hand'), SEP, C('fitWidth', 'Ajustar ancho', 'fitw'), C('fitPage', 'Página completa', 'fitp'), C('twoPages', 'Dos páginas', 'two'), C('night', 'Modo noche', 'moon'), C('present', 'Presentación', 'present', 'Modo presentación a pantalla completa'), SEP,
    C('readPage', 'Leer página', 'speak'), C('readFrom', 'Leer desde aquí', 'speak'), C('properties', 'Propiedades', 'props'), C('help', 'Ayuda', 'info')] },
  { id: 'comment', label: 'Comentar', items: [T('note'), T('highlight'), T('underline'), T('strike'), T('hlarea'), SEP, T('text'), T('ink'), T('rect'), T('ellipse'), T('line'), T('arrow'), SEP, T('stamp'), C('stampPick', 'Elegir sello', 'stamp'), T('measure'), SEP, C('commentsList', 'Lista de comentarios', 'comments')] },
  { id: 'edit', label: 'Editar', items: [T('edittext'), T('text'), T('image'), T('link'), T('whiteout'), SEP, C('watermark', 'Marca de agua', 'watermark'), C('header', 'Encabezado y pie', 'header'), C('numbers', 'Numerar páginas', 'numbers'), C('bates', 'Numeración Bates', 'bates'), SEP, T('crop'), C('cropMargins', 'Recortar márgenes', 'crop'), C('resize', 'Tamaño de página', 'resize')] },
  { id: 'organize', label: 'Organizar', items: [C('organize', 'Organizar páginas', 'grid'), SEP, C('rotl', 'Girar a la izquierda', 'rotl'), C('rotr', 'Girar a la derecha', 'rotr'), C('delPages', 'Eliminar páginas', 'trash'), C('dupPages', 'Duplicar', 'copy'), SEP,
    C('blank', 'Página en blanco', 'blank'), C('insertFile', 'Insertar archivo', 'insert'), C('replace', 'Reemplazar páginas', 'replace'), C('extract', 'Extraer', 'extract'), C('split', 'Dividir', 'split'), C('merge', 'Combinar archivos', 'merge'), C('reverse', 'Invertir orden', 'reverse')] },
  { id: 'sign', label: 'Rellenar y firmar', items: [T('signature'), T('initials'), C('sigManage', 'Mis firmas', 'user'), SEP, T('text'), T('date'), T('mark-check'), T('mark-cross'), T('mark-dot'), SEP, C('hlFields', 'Resaltar campos', 'hlfields'), C('clearForm', 'Borrar formulario', 'eraser')] },
  { id: 'forms', label: 'Formularios', items: [T('field-text'), T('field-check'), T('field-radio'), T('field-dropdown'), T('field-list'), C('detectFields', 'Detectar campos', 'search'), SEP,
    C('hlFields', 'Resaltar campos', 'hlfields'), C('exportData', 'Exportar datos', 'exportd'), C('importData', 'Importar datos', 'importd'), C('clearForm', 'Borrar valores', 'eraser'), C('flattenForm', 'Aplanar formulario', 'flatten'), C('removeFields', 'Eliminar campos', 'trash')] },
  { id: 'protect', label: 'Proteger', items: [C('encrypt', 'Proteger con contraseña', 'lock'), C('removeSecurity', 'Quitar seguridad', 'unlock'), SEP, T('redact'), C('searchRedact', 'Buscar y redactar', 'redactsearch'), C('applyRedactions', 'Aplicar redacciones', 'apply'), SEP, C('sanitize', 'Quitar información oculta', 'sanitize')] },
  { id: 'convert', label: 'Convertir', items: [C('toWord', 'A Word (.docx)', 'toword'), C('toExcel', 'A Excel (.csv)', 'list'), C('toImages', 'A imágenes', 'toimg'), C('toText', 'A texto', 'totext'), C('toHtml', 'A HTML', 'tohtml'), C('pdfa', 'PDF/A', 'pdfa'), SEP,
    C('newBlank', 'Nuevo en blanco', 'newdoc'), C('fromImages', 'Desde imágenes', 'fromimg'), C('fromText', 'Desde texto', 'fromtxt'), C('merge', 'Combinar archivos', 'merge')] },
  { id: 'tools', label: 'Herramientas', items: [C('ocr', 'Reconocer texto (OCR)', 'ocr'), C('optimize', 'Optimizar tamaño', 'optimize'), C('compress', 'Comprimir al máximo', 'compress'), C('compare', 'Comparar archivos', 'compare'), SEP,
    C('attach', 'Adjuntar archivo', 'attach'), C('addBookmark', 'Agregar marcador', 'bookmark'), C('autoBookmarks', 'Marcadores automáticos', 'bookmark'), SEP, C('prefs', 'Preferencias', 'user')] },
];
let activeTab = lsGet('ma.tab', 'home');
function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const t of TABS) tabs.append(h('button', { role: 'tab', class: t.id === activeTab ? 'active' : '', 'aria-selected': String(t.id === activeTab), onclick: () => { activeTab = t.id; lsSet('ma.tab', t.id); renderTabs(); } }, t.label));
  renderRibbon();
}
function renderRibbon() {
  const rb = $('#ribbon');
  rb.innerHTML = '';
  const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
  for (const it of tab.items) {
    if (it.sep) { rb.append(h('div', { class: 'rb-sep' })); continue; }
    if (it.tool) {
      const tl = TOOLS[it.tool];
      rb.append(h('button', { class: 'rb' + (S.tool === it.tool ? ' active' : ''), 'data-tool': it.tool, title: tl.label, onclick: () => (S.tool === it.tool && it.tool !== 'select' ? setTool('select') : (needsDoc(it.tool) && setTool(it.tool))) }, icon(tl.icon), h('span', {}, tl.label)));
    } else {
      rb.append(h('button', { class: 'rb', 'data-cmd': it.cmd, title: it.title || it.label }, icon(it.icon), h('span', {}, it.label)));
    }
  }
  updateToggleStates();
}
function needsDoc(tool) { if (!S.pdf && tool !== 'select' && tool !== 'hand') { toast('Abrí un documento primero', 'err'); return false; } return true; }
function updateToggleStates() {
  $$('[data-cmd="twoPages"]').forEach((b) => b.classList.toggle('active', S.layout === 'two'));
  $$('[data-cmd="night"]').forEach((b) => b.classList.toggle('active', document.body.classList.contains('night')));
  $$('[data-cmd="hlFields"]').forEach((b) => b.classList.toggle('active', document.body.classList.contains('hl-fields')));
  $$('[data-cmd="organize"]').forEach((b) => b.classList.toggle('active', !$('#organizer').hidden));
}

/* ---------- panel lateral ---------- */
const SIDE_TABS = [['thumbs', 'thumbs', 'Miniaturas'], ['bookmarks', 'bookmark', 'Marcadores'], ['comments', 'comments', 'Comentarios'], ['attachments', 'attach', 'Adjuntos'], ['layers', 'layers', 'Capas']];
let sideTab = lsGet('ma.side', 'thumbs');
function renderSideTabs() {
  const st = $('#sideTabs');
  st.innerHTML = '';
  for (const [id, ic, label] of SIDE_TABS) st.append(h('button', { class: id === sideTab ? 'active' : '', title: label, 'aria-label': label, onclick: () => showSide(id) }, icon(ic)));
}
function showSide(id) {
  sideTab = id; lsSet('ma.side', id);
  $('#main').classList.remove('no-side');
  renderSideTabs();
  refreshSidebar();
}
let sideToken = 0;
async function refreshSidebar() {
  const body = $('#sideBody');
  const tok = ++sideToken;
  const keepScroll = body.scrollTop;
  if (!S.pdf) { body.innerHTML = '<div class="empty">Abrí un documento para ver su contenido.</div>'; return; }
  const frag = h('div');
  if (sideTab === 'thumbs') {
    frag.append(h('div', { class: 'side-title' }, 'Páginas', h('span', { class: 'tb-spacer' }),
      h('button', { class: 'ib', title: 'Organizar páginas', onclick: () => toggleOrganizer(true) }, icon('grid'))));
    const list = h('div', { class: 'thumbs' });
    S.pages.forEach((_, i) => list.append(thumbEl(i, 140)));
    frag.append(list, h('p', { class: 'props-help', style: { marginTop: '10px' } }, 'Ctrl+clic para seleccionar varias. Arrastrá para reordenar.'));
    body.innerHTML = ''; body.append(frag);
    lazyThumbs(list, 140);
  } else if (sideTab === 'bookmarks') {
    const tree = S.outline || await readOutline();
    if (tok !== sideToken) return;
    frag.append(h('div', { class: 'side-title' }, 'Marcadores', h('span', { class: 'tb-spacer' }),
      h('button', { class: 'ib', title: 'Agregar marcador para la página actual', onclick: addBookmark }, icon('plus')),
      h('button', { class: 'ib', title: 'Crear marcadores automáticamente', onclick: autoBookmarks }, icon('list'))));
    if (!tree.length) frag.append(h('div', { class: 'empty' }, 'El documento no tiene marcadores. Usá + para agregar uno.'));
    frag.append(outlineTree(tree, []));
    body.innerHTML = ''; body.append(frag);
  } else if (sideTab === 'comments') {
    frag.append(h('div', { class: 'side-title' }, 'Comentarios'));
    let count = 0;
    S.objects.forEach((arr, i) => arr.forEach((o) => {
      if (!['note', 'markup', 'stamp'].includes(o.type)) return;
      count++;
      const label = o.type === 'note' ? 'Nota' : o.type === 'stamp' ? 'Sello' : MARKUP_NAMES[o.kind];
      frag.append(h('div', { class: 'list-item', onclick: () => { setTool('select'); goToPage(i); selectObj(o); } },
        h('div', { class: 'meta' }, h('span', { class: 'swatch', style: { background: o.color } }), h('b', {}, label), h('span', {}, 'pág. ' + (i + 1)), h('span', { class: 'tb-spacer' }), o.author || ''),
        (o.text || o.comment) && o.type !== 'stamp' ? h('div', { class: 'body' }, o.text || o.comment) : o.type === 'stamp' ? h('div', { class: 'body' }, o.text) : null));
    }));
    // anotaciones existentes en el PDF
    if (S.pages.length <= 400) {
      for (let i = 0; i < S.pages.length; i++) {
        const annots = await S.pages[i].proxy.getAnnotations().catch(() => []);
        if (tok !== sideToken) return;
        for (const a of annots) {
          const txt = a.contentsObj?.str || a.contents || '';
          if (['Link', 'Widget', 'Popup'].includes(a.subtype) || (!txt && !['Highlight', 'Underline', 'StrikeOut', 'Text', 'FreeText', 'Ink', 'Stamp'].includes(a.subtype))) continue;
          count++;
          frag.append(h('div', { class: 'list-item', onclick: () => goToPage(i) },
            h('div', { class: 'meta' }, h('b', {}, a.subtype), h('span', {}, 'pág. ' + (i + 1)), h('span', { class: 'tb-spacer' }), a.titleObj?.str || a.title || ''),
            txt ? h('div', { class: 'body' }, txt) : null));
        }
      }
    }
    if (!count) frag.append(h('div', { class: 'empty' }, 'No hay comentarios. Usá la pestaña "Comentar" para agregar notas, resaltados y sellos.'));
    body.innerHTML = ''; body.append(frag);
  } else if (sideTab === 'attachments') {
    const list = await listAttachments();
    if (tok !== sideToken) return;
    frag.append(h('div', { class: 'side-title' }, 'Adjuntos', h('span', { class: 'tb-spacer' }), h('button', { class: 'ib', title: 'Adjuntar archivo', onclick: addAttachment }, icon('plus'))));
    if (!list.length) frag.append(h('div', { class: 'empty' }, 'No hay archivos adjuntos.'));
    for (const a of list) {
      frag.append(h('div', { class: 'list-item' },
        h('div', { class: 'meta' }, icon('attach'), h('b', { style: { color: 'var(--text)', wordBreak: 'break-all' } }, a.name)),
        h('div', { class: 'meta', style: { marginTop: '4px' } }, fmtBytes(a.data.length), h('span', { class: 'tb-spacer' }),
          h('button', { class: 'btn small', onclick: () => download(a.data, a.name, a.mimeType || 'application/octet-stream') }, 'Descargar'),
          h('button', { class: 'btn small danger', onclick: () => removeAttachment(a.name) }, 'Quitar'))));
    }
    body.innerHTML = ''; body.append(frag);
  } else if (sideTab === 'layers') {
    frag.append(h('div', { class: 'side-title' }, 'Capas'));
    const cfg = S.ocConfig;
    const groups = cfg ? Object.entries(cfg.getGroups() || {}) : [];
    if (!groups.length) frag.append(h('div', { class: 'empty' }, 'El documento no tiene capas (contenido opcional).'));
    for (const [id, grp] of groups) {
      const cb = h('input', { type: 'checkbox', checked: grp.visible });
      cb.addEventListener('change', () => { cfg.setVisibility(id, cb.checked); S.pages.forEach((p, i) => { p.rendered = false; p.renderedScale = 0; if (p.visible) queueRender(i); }); });
      frag.append(h('label', { class: 'tree-row' }, cb, h('span', { class: 't' }, grp.name || id)));
    }
    body.innerHTML = ''; body.append(frag);
  }
  body.scrollTop = keepScroll;
}
function refreshCommentsIfOpen() { if (sideTab === 'comments') refreshSidebar(); }
function outlineTree(items, path) {
  const ul = h('ul', { class: 'tree' });
  items.forEach((it, k) => {
    const p = [...path, k];
    const row = h('div', { class: 'tree-row', title: it.title, onclick: () => { if (it.page != null) goToPage(it.page); else if (it.url) window.open(it.url, '_blank', 'noopener'); } },
      icon('bookmark'), h('span', { class: 't' }, it.title), h('span', { class: 'pg' }, it.page != null ? String(it.page + 1) : ''),
      h('span', { class: 'acts' },
        h('button', { class: 'ib', title: 'Renombrar', onclick: (e) => { e.stopPropagation(); editBookmark(p, 'rename'); } }, icon('edit')),
        h('button', { class: 'ib', title: 'Subir', onclick: (e) => { e.stopPropagation(); editBookmark(p, 'up'); } }, icon('up')),
        h('button', { class: 'ib', title: 'Bajar', onclick: (e) => { e.stopPropagation(); editBookmark(p, 'down'); } }, icon('down')),
        h('button', { class: 'ib', title: 'Eliminar', onclick: (e) => { e.stopPropagation(); editBookmark(p, 'delete'); } }, icon('trash'))));
    const li = h('li', {}, row);
    if (it.children?.length) li.append(outlineTree(it.children, p));
    ul.append(li);
  });
  return ul;
}
async function editBookmark(path, action) {
  let title;
  const tree0 = await editableOutline();
  const cur = path.reduce((acc, k, i) => (i === path.length - 1 ? acc : acc[k].children), tree0);
  const k = path[path.length - 1];
  if (action === 'rename') {
    const v = await formDialog('Editar marcador', [
      { name: 'title', label: 'Título', value: cur[k].title },
      { name: 'page', label: 'Página de destino', type: 'number', value: (cur[k].page ?? S.current) + 1, min: 1, max: S.pages.length },
    ], { ok: 'Guardar' });
    if (!v) return;
    title = v.title;
    pushUndo();
    cur[k].title = title; cur[k].page = clamp(v.page - 1, 0, S.pages.length - 1);
  } else {
    pushUndo();
    if (action === 'delete') cur.splice(k, 1);
    else if (action === 'up' && k > 0) [cur[k - 1], cur[k]] = [cur[k], cur[k - 1]];
    else if (action === 'down' && k < cur.length - 1) [cur[k + 1], cur[k]] = [cur[k], cur[k + 1]];
  }
  refreshSidebar();
}

/* ---------- diálogos varios ---------- */
async function prefsDialog() {
  const v = await formDialog('Preferencias', [
    { name: 'author', label: 'Tu nombre (para comentarios, sellos y firmas escritas)', value: S.author },
    { name: 'flatten', label: 'Aplanar comentarios al guardar (por defecto se guardan como anotaciones editables)', type: 'checkbox', value: S.flattenComments },
    { name: 'localFonts', label: 'Usar las fuentes instaladas en el equipo al editar texto (Chrome y Edge piden permiso la primera vez)', type: 'checkbox', value: lsGet('ma.localFonts', true) },
    { name: 'fonts', type: 'html', html: h('div', {}, h('button', { class: 'btn small', onclick: () => uploadFonts() }, 'Cargar fuentes (.ttf / .otf)…'),
      h('div', { class: 'help' }, `Fuentes cargadas o instaladas en uso: ${[...S.extFonts.values()].map((e) => e.family + (e.bold ? ' negrita' : '') + (e.italic ? ' cursiva' : '')).join(', ') || 'ninguna'}`)) },
  ], { ok: 'Guardar' });
  if (!v) return;
  lsSet('ma.localFonts', v.localFonts);
  S.author = v.author.trim() || 'Usuario'; lsSet('ma.author', S.author);
  S.flattenComments = v.flatten; lsSet('ma.flattenComments', v.flatten);
}
async function searchOptionsDialog() {
  const v = await formDialog('Opciones de búsqueda', [
    { name: 'cs', label: 'Distinguir mayúsculas y minúsculas', type: 'checkbox', value: S.search.caseSensitive },
    { name: 'ww', label: 'Solo palabras completas', type: 'checkbox', value: S.search.wholeWord },
  ], { ok: 'Aplicar' });
  if (!v) return;
  S.search.caseSensitive = v.cs; S.search.wholeWord = v.ww;
  if ($('#searchInput').value) runSearch($('#searchInput').value);
}
function helpDialog() {
  const rows = [
    ['Ctrl O / Ctrl S / Ctrl Mayús S', 'Abrir · Guardar · Guardar como'], ['Ctrl P', 'Imprimir'], ['Ctrl Z / Ctrl Y', 'Deshacer · Rehacer'],
    ['Ctrl F, Intro, Mayús Intro', 'Buscar, siguiente, anterior'], ['Ctrl + / Ctrl − / Ctrl 0', 'Acercar · Alejar · Ajustar al ancho'],
    ['Re Pág / Av Pág, Inicio / Fin', 'Navegar páginas'], ['V · H · T · N · E', 'Seleccionar · Mano · Texto · Nota · Editar texto'],
    ['Supr', 'Eliminar objeto seleccionado'], ['Ctrl C / Ctrl V / Ctrl D', 'Copiar · Pegar · Duplicar objeto'], ['Flechas (Mayús)', 'Mover objeto 1 pt (10 pt)'],
    ['Esc', 'Cancelar / volver a Seleccionar'], ['Ctrl + rueda', 'Zoom'], ['Doble clic', 'Editar texto o nota'],
  ];
  const body = h('div', {},
    h('p', {}, 'Mini Acrobat es un editor de PDF que funciona por completo en tu navegador: los documentos nunca se envían a ningún servidor. Solo el OCR descarga su motor de internet la primera vez.'),
    h('table', { style: { width: '100%', borderCollapse: 'collapse' } }, ...rows.map(([k, d]) => h('tr', {}, h('td', { style: { padding: '4px 10px 4px 0', whiteSpace: 'nowrap' } }, h('span', { class: 'kbd' }, k)), h('td', {}, d)))),
    h('p', { class: 'props-help', style: { marginTop: '12px' } }, 'Basado en pdf.js (Mozilla, Apache 2.0) y pdf-lib (MIT).'));
  modal({ title: 'Ayuda y atajos de teclado', body, wide: true });
}

/* ---------- barra superior ---------- */
function renderTopbar() {
  $('#tb-file').append(
    h('button', { class: 'ib', 'data-cmd': 'open', title: 'Abrir (Ctrl O)' }, icon('open')),
    h('button', { class: 'ib', 'data-cmd': 'save', title: 'Guardar (Ctrl S)' }, icon('save')),
    h('button', { class: 'ib', 'data-cmd': 'print', title: 'Imprimir (Ctrl P)' }, icon('print')));
  $('#tb-history').append(
    h('button', { class: 'ib', 'data-cmd': 'undo', title: 'Deshacer (Ctrl Z)', disabled: true }, icon('undo')),
    h('button', { class: 'ib', 'data-cmd': 'redo', title: 'Rehacer (Ctrl Y)', disabled: true }, icon('redo')));
  const fill = (sel, ic) => { const b = $(sel); b.append(icon(ic)); };
  fill('[data-cmd="prevPage"]', 'up'); fill('[data-cmd="nextPage"]', 'down');
  fill('[data-cmd="zoomOut"]', 'minus'); fill('[data-cmd="zoomIn"]', 'plus');
  fill('[data-cmd="searchPrev"]', 'up'); fill('[data-cmd="searchNext"]', 'down'); fill('[data-cmd="searchOptions"]', 'sliders');
  $('#tb-right').append(
    h('button', { class: 'ib', 'data-cmd': 'toggleSide', title: 'Mostrar u ocultar panel lateral' }, icon('sidebar')),
    h('button', { class: 'ib', 'data-cmd': 'toggleProps', title: 'Mostrar u ocultar propiedades' }, icon('panel')),
    h('button', { class: 'ib', 'data-cmd': 'theme', title: 'Tema claro / oscuro' }, icon('theme')),
    h('button', { class: 'ib', 'data-cmd': 'help', title: 'Ayuda' }, icon('info')));
}

/* ---------- eventos globales ---------- */
function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if ($('#modalRoot').children.length || $('#present')) return;
  if (mod && k === 'o') { e.preventDefault(); CMDS.open(); return; }
  if (mod && k === 's') { e.preventDefault(); e.shiftKey ? CMDS.saveAs() : CMDS.save(); return; }
  if (mod && k === 'p') { e.preventDefault(); CMDS.print(); return; }
  if (mod && k === 'f') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); return; }
  if (mod && (k === '+' || k === '=')) { e.preventDefault(); zoomStep(1); return; }
  if (mod && k === '-') { e.preventDefault(); zoomStep(-1); return; }
  if (mod && k === '0') { e.preventDefault(); applyZoom('fitw'); return; }
  if (isTyping(e)) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd' && S.sel) { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'c' && S.sel && !window.getSelection()?.toString()) { clipboard = clone(S.sel); toast('Objeto copiado'); return; }
  if (mod && k === 'v' && clipboard && S.pdf) {
    const c = clone(clipboard); c.id = uid();
    if (c.page === S.current) moveObj(c, 12, 12);
    else { const b = objBox(c); const pg = S.pages[S.current]; moveObj(c, clamp(b.x, 0, pg.w - b.w) - b.x, clamp(b.y, 0, pg.h - b.h) - b.y); }
    addObject(S.current, c);
    e.preventDefault();
    return;
  }
  if (mod && k === 'a' && !$('#organizer').hidden) { e.preventDefault(); S.selPages = new Set(S.pages.map((_, i) => i)); renderOrganizer(); return; }
  if (e.key === 'Escape') {
    if (!$('#organizer').hidden) toggleOrganizer(false);
    else if (S.sel) deselect();
    else setTool('select');
    if (reading) { speechSynthesis.cancel(); reading = null; }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); removeObject(S.sel); return; }
  if ((e.key === 'Delete') && !$('#organizer').hidden && S.selPages.size) { deletePages(targetPages()); return; }
  if (S.sel && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (!e.repeat) pushUndo();
    moveObj(S.sel, e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    changed(S.sel);
    return;
  }
  if (mod) return;
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && S.zoomMode === 'fitp')) { e.preventDefault(); goToPage(S.current + 1); return; }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && S.zoomMode === 'fitp')) { e.preventDefault(); goToPage(S.current - 1); return; }
  if (e.key === 'Home') { e.preventDefault(); goToPage(0); return; }
  if (e.key === 'End') { e.preventDefault(); goToPage(S.pages.length - 1); return; }
  const shortcuts = { v: 'select', h: 'hand', t: 'text', n: 'note', e: 'edittext' };
  if (shortcuts[k] && S.pdf && !e.altKey) setTool(shortcuts[k]);
}

function setupEvents() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b && !b.disabled && CMDS[b.dataset.cmd]) CMDS[b.dataset.cmd]();
  });
  document.addEventListener('keydown', onKey);
  $('#fileInput').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openFile(f); });
  $('#pageInput').addEventListener('change', (e) => goToPage((parseInt(e.target.value, 10) || 1) - 1));
  $('#pageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { goToPage((parseInt(e.target.value, 10) || 1) - 1); viewer().focus(); } });
  $('#zoomSelect').addEventListener('change', (e) => { if (e.target.value !== 'custom') applyZoom(e.target.value === 'fitw' || e.target.value === 'fitp' ? e.target.value : +e.target.value); });
  let st = null;
  $('#searchInput').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => runSearch(e.target.value), 350); });
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st); if (e.target.value !== S.search.query) runSearch(e.target.value); else searchMove(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.target.value = ''; clearSearch(); viewer().focus(); }
  });
  let raf = 0;
  viewer().addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; updateCurrentFromScroll(); }); });
  viewer().addEventListener('wheel', (e) => { if (e.ctrlKey && S.pdf) { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  viewer().addEventListener('pointerdown', (e) => {
    if (S.tool !== 'hand' || e.button !== 0) return;
    const v = viewer(); const sx = e.clientX, sy = e.clientY, l = v.scrollLeft, t = v.scrollTop;
    v.classList.add('panning');
    dragLoop(e, (ev) => { v.scrollLeft = l - (ev.clientX - sx); v.scrollTop = t - (ev.clientY - sy); }, () => v.classList.remove('panning'));
  });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.pdf && S.zoomMode !== 'custom') applyZoom(S.zoomMode); }, 150); });
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  // redimensionar panel lateral
  $('#sideResizer').addEventListener('pointerdown', (e) => {
    dragLoop(e, (ev) => { const w = clamp(ev.clientX, 160, 480); $('#main').style.setProperty('--side-w', w + 'px'); }, () => { if (S.zoomMode !== 'custom') applyZoom(S.zoomMode); });
  });
  // arrastrar y soltar archivos
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('#dropMask').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropMask').hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#dropMask').hidden = true;
    const files = [...e.dataTransfer.files].filter((f) => isPdfFile(f) || isImageFile(f));
    if (!files.length) { toast('Solo se admiten PDF e imágenes', 'err'); return; }
    if (!S.pdf) {
      if (files.every(isImageFile)) return createFromImages(files);
      const pdfs = files.filter(isPdfFile);
      await openFile(pdfs[0]);
      if (files.length > 1) toast('Se abrió el primer PDF. Usá "Combinar archivos" para unir varios.');
      return;
    }
    const r = await modal({ title: 'Archivos soltados', body: `${files.length} archivo(s): ${files.map((f) => f.name).join(', ')}`, buttons: [
      { label: 'Cancelar', value: null }, ...(files.length === 1 && isPdfFile(files[0]) ? [{ label: 'Abrir', value: 'open' }] : []),
      { label: 'Insertar al final', value: 'insert', primary: true }] });
    if (r === 'open') openFile(files[0]);
    else if (r === 'insert') {
      const at = S.pages.length;
      await docOp('Insertando…', async (doc) => {
        const pages = doc.getPages();
        const added = await pagesFromFiles(doc, files);
        setPageOrder(doc, [...pages, ...added]);
        return [...pages.map((_, i) => i), ...added.map(() => -1)];
      });
      goToPage(at);
    }
  });
  // pegar imágenes del portapapeles
  document.addEventListener('paste', async (e) => {
    if (isTyping(e) || !S.pdf) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const im = await normalizeImage(await readDataURL(item.getAsFile()));
    const pg = S.pages[S.current];
    const w = Math.min(pg.w * 0.6, im.w * 0.75), hh = w * im.h / im.w;
    setTool('select');
    addObject(S.current, { type: 'image', x: (pg.w - w) / 2, y: (pg.h - hh) / 2, w, h: hh, src: im.src });
  });
}

/* ---------- inicio ---------- */
function init() {
  const th = lsGet('ma.theme', 'auto');
  if (th !== 'auto') document.documentElement.dataset.theme = th;
  renderTopbar();
  renderTabs();
  renderSideTabs();
  refreshSidebar();
  setupEvents();
  setTool('select');
  updateHistoryButtons();
  if (window.innerWidth < 820) $('#props').classList.add('collapsed');
  // API mínima para pruebas automatizadas
  window.miniAcrobat = { S, CMDS, pageItems, allLines, layoutText, openBytes, buildOutput, setTool, addObject, docOp, rotatePages, deletePages, movePages, duplicatePages, applyRedactions, findAll, undo, redo };
}
init();
