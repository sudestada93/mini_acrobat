/* Núcleo: estado global, utilidades, iconos, diálogos, zip, deshacer. */
const PDFLib = window.PDFLib;
const pdfjsLib = window.pdfjsLib;
{
  const src = document.getElementById('pdfjs-worker-src').textContent;
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';

const S = {
  bytes: null,          // Uint8Array del PDF de trabajo (siempre sin cifrar)
  fileName: 'documento.pdf',
  pdf: null,            // documento de pdf.js
  pages: [],            // [{w,h,rot,vt,view, el,...}]
  objects: [],          // objetos de edición por página (coordenadas de pantalla a escala 1)
  scale: 1,
  zoomMode: 'fitw',
  tool: 'select',
  sel: null,            // objeto seleccionado
  selPages: new Set(),  // páginas seleccionadas en miniaturas/organizador
  current: 0,
  undo: [], redo: [],
  outline: null,        // árbol de marcadores editado (null = el del PDF)
  encryption: null,     // {userPassword, ownerPassword, permissions}
  wasEncrypted: false,
  dirty: false,
  version: 0,
  layout: 'single',
  style: {
    stroke: '#e5162d', fill: null, width: 2, opacity: 1,
    color: '#111111', size: 14, font: 'helv', bold: false, italic: false, align: 'left', bg: null,
    hl: '#ffe500', note: '#ffd84d',
  },
  author: lsGet('ma.author', 'Usuario'),
};

/* ---------- utilidades DOM ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const today = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const baseName = (n) => n.replace(/\.[^.]+$/, '');

/* ---------- iconos (trazos 24×24) ---------- */
const ICONS = {
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h9V3M7 21v-7h10v7',
  saveas: 'M5 3h11l3 3v6M7 3v5h9V3M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M15 19h6M18 16v6',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  up: 'm18 15-6-6-6 6', down: 'm6 9 6 6 6-6', left: 'm15 18-6-6 6-6', right: 'm9 18 6-6-6-6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  select: 'M5 3l14 8-6 2-2 6z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.5 14.5a1.5 1.5 0 0 1 2.4-1.8L8 14',
  fitw: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  fitp: 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4',
  two: 'M3 5h8v14H3zM13 5h8v14h-8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  present: 'M2 4h20v12H2zM8 21l4-5 4 5',
  speak: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  note: 'M4 4h16v12H8l-4 4z',
  highlight: 'm9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
  strike: 'M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  hlarea: 'M3 5h18v14H3zM7 9h10M7 13h6',
  textbox: 'M4 7V4h16v3M9 20h6M12 4v16',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  rect: 'M3 5h18v14H3z', ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z',
  line: 'M5 19 19 5', arrow: 'M5 19 19 5M10 5h9v9',
  stamp: 'M5 22h14M19 15H5a2 2 0 0 0-2 2v2h18v-2a2 2 0 0 0-2-2zM14 15V9.5a3.5 3.5 0 1 0-4 0V15',
  ruler: 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  edittext: 'M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4M14 20h6',
  image: 'M3 5h18v14H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  eraser: 'm7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19M22 21H7M5 11l9 9',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  watermark: 'M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z',
  header: 'M4 4h16v16H4zM4 9h16M8 6.5h8',
  numbers: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  bates: 'M4 4h16v16H4zM8 16V8l-2 1.5M12 8h3a1.5 1.5 0 0 1 0 3h-3v5h4.5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  rotl: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', rotr: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  blank: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 12v6M9 15h6',
  insert: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l3 3 3-3M12 18v-6',
  extract: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l3-3 3 3M12 12v6',
  split: 'M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3M15 9l6-6',
  merge: 'M8 6h8M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 8v4a4 4 0 0 0 4 4h0a2 2 0 0 1 2 2v3M18 8v4a4 4 0 0 1-4 4',
  replace: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  reverse: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  resize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  sign: 'M3 17c3-3 4-9 6-9s1 6 3 6 2-3 4-3 2 3 5 3M3 21h18',
  initials: 'M4 18V6M4 6l5 12M9 18V6M14 18c2 0 6-1 6-6s-4-6-6-6z',
  check: 'M20 6 9 17l-5-5', cross: 'M18 6 6 18M6 6l12 12', dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  ftext: 'M3 6h18v12H3zM7 10v4M7 12h0', fcheck: 'M3 3h18v18H3zM7 12l3 3 7-7', fradio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  fdrop: 'M3 6h18v12H3zM15 11l2 2 2-2', flist: 'M3 4h18v16H3zM7 9h10M7 13h10M7 17h6',
  hlfields: 'M3 6h18v12H3zM7 12h10', exportd: 'M12 3v12M7 10l5 5 5-5M5 21h14', importd: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  flatten: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1',
  redact: 'M3 5h18v4H3zM3 13h11v4H3z', redactsearch: 'M3 5h10v4H3zM16 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM21 21l-2.5-2.5M3 13h7v4H3z',
  apply: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6',
  sanitize: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M9 10l6 6M15 10l-6 6',
  toimg: 'M3 5h18v14H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  totext: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  toword: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 12l1.5 6 2.5-4 2.5 4L16 12',
  tohtml: 'm16 18 6-6-6-6M8 6l-6 6 6 6', newdoc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 11v6M9 14h6',
  fromimg: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 18l3-4 2 2 3-4',
  fromtxt: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M12 13v6',
  pdfa: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  ocr: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h8M8 12h8M8 16h5',
  optimize: 'M13 2 3 14h9l-1 8 10-12h-9z', compress: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  compare: 'M3 3h7v18H3zM14 3h7v18h-7zM6 8h1M6 12h1M17 8h1M17 12h1',
  attach: 'm21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  props: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-5M12 10h.01',
  bookmark: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z', layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  thumbs: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', comments: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z',
  sidebar: 'M3 3h18v18H3zM9 3v18', panel: 'M3 3h18v18H3zM15 3v18', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  front: 'M8 8h12v12H8zM4 16V4h12', back: 'M4 4h12v12H4zM8 20h12V8',
  play: 'M6 4l14 8-14 8z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z', stop: 'M5 5h14v14H5z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14', zip: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM10 4h2M10 8h2M10 12h2v4h-2z',
  sort: 'M3 6h18M6 12h12M10 18h4', keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  bg: 'M3 3h18v18H3zM3 15l6-6 12 12', theme: 'M12 3a9 9 0 1 0 0 18V3z', user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
};
function icon(name, cls = 'i') {
  const d = ICONS[name] || ICONS.info;
  return h('span', { html: `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`, style: { display: 'contents' } });
}

/* ---------- matrices 2D [a b c d e f] ---------- */
const M = {
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  // aplica A y luego B
  then: (A, B) => [
    B[0] * A[0] + B[2] * A[1], B[1] * A[0] + B[3] * A[1],
    B[0] * A[2] + B[2] * A[3], B[1] * A[2] + B[3] * A[3],
    B[0] * A[4] + B[2] * A[5] + B[4], B[1] * A[4] + B[3] * A[5] + B[5],
  ],
  inv: (m) => {
    const det = m[0] * m[3] - m[1] * m[2];
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  },
};
// rectángulo (en espacio de pantalla) -> rectángulo de usuario PDF [x,y,w,h]
function boxToUser(pi, b) {
  const inv = M.inv(S.pages[pi].vt);
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => M.apply(inv, x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

/* ---------- colores ---------- */
function hexToRgb(hex) {
  if (!hex) return null;
  let s = hex.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const PALETTE = ['#111111', '#ffffff', '#e5162d', '#ff7a00', '#ffe500', '#22a447', '#1473e6', '#7b3fe4', '#ff4fa3', '#8a8a8a'];

/* ---------- avisos, ocupado ---------- */
function toast(msg, kind = '', ms = 3200) {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
function status(msg) { $('#statusText').textContent = msg; }
let busyDepth = 0;
function busy(on, text = 'Procesando…') {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
  $('#busy').hidden = busyDepth === 0;
  if (on) {
    $('#busyText').textContent = text;
    $('#busy .progress')?.remove();
  }
}
function progress(frac, text) {
  let p = $('#busy .progress');
  if (!p) { p = h('div', { class: 'progress' }, h('div')); $('#busy').append(p); }
  p.firstChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  if (text) $('#busyText').textContent = text;
}
async function withBusy(text, fn) {
  busy(true, text);
  await sleep(30);
  try { return await fn(); }
  catch (e) { console.error(e); toast('Error: ' + (e.message || e), 'err', 6000); return undefined; }
  finally { busy(false); }
}

/* ---------- modales ---------- */
function modal({ title, body, buttons = [{ label: 'Cerrar', value: null }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const bodyEl = h('div', { class: 'mbody' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); resolve(v); };
    const foot = h('footer');
    for (const b of buttons) {
      foot.append(h('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
        onclick: async () => {
          if (b.onClick) { const r = await b.onClick(bodyEl); if (r === false) return; close(r === undefined ? b.value : r); }
          else close(b.value);
        },
      }, b.label));
    }
    const m = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('span', {}, title), h('span', { class: 'tb-spacer' }), h('button', { class: 'ib', title: 'Cerrar', onclick: () => close(null) }, icon('x'))),
      bodyEl, foot);
    const bd = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === bd) close(null); } }, m);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const pb = buttons.findIndex((b) => b.primary);
        if (pb >= 0) { e.preventDefault(); foot.children[pb].click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('#modalRoot').append(bd);
    onOpen?.(bodyEl, close);
    setTimeout(() => (bodyEl.querySelector('input:not([type=hidden]),select,textarea') || foot.lastChild)?.focus(), 30);
  });
}
function alertBox(title, msg) { return modal({ title, body: h('div', { style: { whiteSpace: 'pre-wrap' } }, msg), buttons: [{ label: 'Aceptar', primary: true, value: true }] }); }
function confirmBox(title, msg, ok = 'Aceptar') {
  return modal({ title, body: h('div', { style: { whiteSpace: 'pre-wrap' } }, msg), buttons: [{ label: 'Cancelar', value: false }, { label: ok, primary: true, value: true }] });
}

// Diálogo de formulario genérico. fields: [{name,label,type,value,options,help,min,max,step,show}]
function fieldEl(f) {
  const id = 'f_' + f.name + '_' + uid();
  let input;
  const t = f.type || 'text';
  if (t === 'select') {
    input = h('select', { id, name: f.name }, ...(f.options || []).map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: String(v) === String(f.value) }, l);
    }));
  } else if (t === 'textarea') {
    input = h('textarea', { id, name: f.name, placeholder: f.placeholder || '' });
    input.value = f.value ?? '';
  } else if (t === 'checkbox') {
    input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
    return h('div', { class: 'field check', 'data-name': f.name }, h('label', { for: id }, input, f.label), f.help ? h('div', { class: 'help' }, f.help) : null);
  } else if (t === 'html') {
    return h('div', { class: 'field', 'data-name': f.name }, typeof f.html === 'string' ? h('div', { html: f.html }) : f.html);
  } else {
    input = h('input', { id, name: f.name, type: t, min: f.min, max: f.max, step: f.step, placeholder: f.placeholder || '', accept: f.accept, multiple: f.multiple });
    if (t !== 'file') input.value = f.value ?? '';
  }
  return h('div', { class: 'field', 'data-name': f.name }, f.label ? h('label', { for: id }, f.label) : null, input, f.help ? h('div', { class: 'help' }, f.help) : null);
}
function readForm(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number' || el.type === 'range') out[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type === 'file') out[el.name] = [...el.files];
    else out[el.name] = el.value;
  }
  return out;
}
function formDialog(title, fields, { ok = 'Aceptar', wide = false, validate, layout } = {}) {
  const body = h('div');
  const els = fields.map((f) => fieldEl(f));
  if (layout) layout(body, els); else body.append(...els);
  const refresh = () => {
    const v = readForm(body);
    fields.forEach((f, i) => { if (f.show) els[i].hidden = !f.show(v); });
  };
  body.addEventListener('input', refresh); body.addEventListener('change', refresh);
  refresh();
  return modal({
    title, body, wide,
    buttons: [{ label: 'Cancelar', value: null }, {
      label: ok, primary: true, onClick: () => {
        const v = readForm(body);
        if (validate) { const err = validate(v); if (err) { toast(err, 'err'); return false; } }
        return v;
      },
    }],
  });
}
// rango de páginas "1-3,5,8-" -> índices base 0
function parseRange(str, n) {
  str = (str || '').trim();
  if (!str || /^tod/i.test(str)) return [...Array(n).keys()];
  const out = [];
  for (const part of str.split(/[,;\s]+/)) {
    if (!part) continue;
    if (/^(par|pares|even)$/i.test(part)) { for (let i = 1; i < n; i += 2) out.push(i); continue; }
    if (/^(impar|impares|odd)$/i.test(part)) { for (let i = 0; i < n; i += 2) out.push(i); continue; }
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n;
      for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.push(i - 1);
    } else if (/^\d+$/.test(part)) { const v = +part; if (v >= 1 && v <= n) out.push(v - 1); }
    else throw new Error('Rango de páginas no válido: ' + part);
  }
  return [...new Set(out)];
}
const rangeHelp = 'Ej.: 1-3, 5, 8-  ·  vacío = todas  ·  "pares" / "impares"';

/* ---------- archivos ---------- */
function pickFiles({ accept = 'application/pdf,.pdf', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());
const readDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
function download(data, name, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const dataURLtoBytes = (u) => { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const canvasToBytes = (c, type = 'image/png', q = 0.92) => new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, q));
const isPdfFile = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isImageFile = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name);

/* ---------- zip (sin compresión) ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(); const chunks = []; const central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function downloadMany(files, zipName) {
  if (files.length === 1) download(files[0].data, files[0].name, files[0].type || 'application/octet-stream');
  else download(makeZip(files), zipName, 'application/zip');
}

/* ---------- texto compatible con fuentes estándar (WinAnsi) ---------- */
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function winAnsi(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\t') out += '    ';
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]$/.test(base) ? base : '?';
    }
  }
  return out;
}

/* ---------- deshacer / rehacer ---------- */
function snapshot() { return { bytes: S.bytes, objects: clone(S.objects), outline: S.outline ? clone(S.outline) : null }; }
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 40) S.undo.shift();
  S.redo = [];
  S.dirty = true;
  updateHistoryButtons();
}
async function restore(snap) {
  const bytesChanged = snap.bytes !== S.bytes;
  S.objects = snap.objects;
  S.outline = snap.outline;
  S.sel = null;
  if (bytesChanged) await loadPdfJs(snap.bytes, { keepView: true });
  else renderAllOverlays();
  refreshSidebar();
  renderProps();
}
async function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  await restore(S.undo.pop());
  updateHistoryButtons();
}
async function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  await restore(S.redo.pop());
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const u = $('[data-cmd="undo"]'), r = $('[data-cmd="redo"]');
  if (u) u.disabled = !S.undo.length;
  if (r) r.disabled = !S.redo.length;
}
