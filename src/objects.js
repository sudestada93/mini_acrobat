/* Objetos de edición: modelo, dibujo en pantalla, selección, arrastre y panel de propiedades. */
const FONT_CSS = { helv: 'Arial, Helvetica, "Liberation Sans", sans-serif', times: '"Times New Roman", Times, "Liberation Serif", serif', cour: '"Courier New", Courier, "Liberation Mono", monospace' };
const FONT_NAMES = [['helv', 'Helvetica / Arial'], ['times', 'Times'], ['cour', 'Courier']];
const BOX_TYPES = new Set(['rect', 'ellipse', 'text', 'image', 'stamp', 'link', 'redact', 'field', 'mark', 'note']);
const LINE_TYPES = new Set(['line', 'arrow', 'measure']);
const TYPE_NAMES = {
  rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', image: 'Imagen', stamp: 'Sello', link: 'Enlace', redact: 'Área a redactar',
  field: 'Campo de formulario', mark: 'Marca', note: 'Nota', line: 'Línea', arrow: 'Flecha', measure: 'Medición', ink: 'Dibujo a mano alzada', markup: 'Marcado de texto',
};
const MARKUP_NAMES = { highlight: 'Resaltado', underline: 'Subrayado', strike: 'Tachado' };
const imgCache = new Map();
function getImg(src) {
  if (!imgCache.has(src)) { const im = new Image(); im.src = src; imgCache.set(src, im); }
  return imgCache.get(src);
}

function objBox(o) {
  if (BOX_TYPES.has(o.type)) return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (LINE_TYPES.has(o.type)) {
    const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
    return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }
  if (o.type === 'ink') {
    const pts = o.strokes.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (o.type === 'markup') {
    const x = Math.min(...o.rects.map((r) => r.x)), y = Math.min(...o.rects.map((r) => r.y));
    return { x, y, w: Math.max(...o.rects.map((r) => r.x + r.w)) - x, h: Math.max(...o.rects.map((r) => r.y + r.h)) - y };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}
// Transforma todos los puntos de un objeto con fn([x,y]) -> [x,y]
function transformObj(o, fn) {
  const box = (b) => {
    const p1 = fn([b.x, b.y]), p2 = fn([b.x + b.w, b.y + b.h]);
    return { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) };
  };
  if (o.type === 'text' || o.type === 'note') {
    // el texto conserva su tamaño: solo se mueve su esquina
    const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const [nx, ny] = fn([c.x, c.y]);
    o.x = nx - o.w / 2; o.y = ny - o.h / 2;
    if (o.cover) Object.assign(o.cover, box(o.cover));
  } else if (BOX_TYPES.has(o.type)) Object.assign(o, box(o));
  else if (LINE_TYPES.has(o.type)) { [o.x1, o.y1] = fn([o.x1, o.y1]); [o.x2, o.y2] = fn([o.x2, o.y2]); }
  else if (o.type === 'ink') o.strokes = o.strokes.map((s) => s.map(fn));
  else if (o.type === 'markup') o.rects = o.rects.map(box);
}
function moveObj(o, dx, dy) { transformObj(o, ([x, y]) => [x + dx, y + dy]); }

/* ---------- alta / baja ---------- */
function addObject(pi, o, { select: doSelect = true, undoable = true } = {}) {
  if (undoable) pushUndo();
  o.id = o.id || uid();
  o.page = pi;
  S.objects[pi].push(o);
  renderOverlay(pi);
  invalidateThumb(pi);
  if (doSelect) selectObj(o);
  refreshCommentsIfOpen();
  return o;
}
function removeObject(o, { undoable = true } = {}) {
  if (!o) return;
  if (undoable) pushUndo();
  const arr = S.objects[o.page];
  const k = arr.findIndex((x) => x.id === o.id);
  if (k >= 0) arr.splice(k, 1);
  if (S.sel?.id === o.id) S.sel = null;
  renderOverlay(o.page);
  invalidateThumb(o.page);
  renderProps();
  refreshCommentsIfOpen();
}
function findObj(id) { for (const arr of S.objects) for (const o of arr) if (o.id === id) return o; return null; }
function changed(o) { renderOverlay(o.page); invalidateThumb(o.page); S.dirty = true; }

/* ---------- dibujo en pantalla ---------- */
function renderAllOverlays() { S.pages.forEach((_, i) => renderOverlay(i)); }
function renderOverlay(pi) {
  const pg = S.pages[pi];
  if (!pg?.el) return;
  const ov = pg.el.querySelector('.ov');
  const editing = ov.querySelector('.tx[contenteditable]');
  if (editing) return; // no interrumpir la edición de texto
  ov.innerHTML = '';
  for (const o of S.objects[pi] || []) {
    const el = objEl(o);
    el.addEventListener('pointerdown', (e) => onObjPointerDown(e, o));
    el.addEventListener('dblclick', (e) => {
      if (S.tool !== 'select') return;
      e.stopPropagation();
      if (o.type === 'text') startTextEdit(o);
      else if (o.type === 'note' || o.type === 'markup') openNotePopup(o);
    });
    ov.append(el);
  }
  if (S.sel && S.sel.page === pi) drawHandles(ov, S.sel);
}
const px = (v) => v * S.scale + 'px';
function svgWrap(viewBox, inner) {
  return `<svg viewBox="${viewBox}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
function arrowHeadPts(x1, y1, x2, y2, w) {
  const len = Math.max(8, w * 4.5), ang = Math.atan2(y2 - y1, x2 - x1), sp = Math.PI / 7;
  return [[x2, y2], [x2 - len * Math.cos(ang - sp), y2 - len * Math.sin(ang - sp)], [x2 - len * Math.cos(ang + sp), y2 - len * Math.sin(ang + sp)]];
}
function measureLabel(o) {
  const d = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  const unit = o.unit || 'mm';
  const k = unit === 'mm' ? 25.4 / 72 : unit === 'cm' ? 2.54 / 72 : unit === 'in' ? 1 / 72 : 1;
  const val = d * k * (o.ratio || 1);
  return val.toFixed(unit === 'pt' ? 0 : 1).replace('.', ',') + ' ' + (unit === 'in' ? 'pulg' : unit);
}
const MARK_PATHS = {
  check: 'M2 11 L8 17 L20 4', cross: 'M3 3 L19 19 M19 3 L3 19', dot: 'M11 11 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0',
};
function objEl(o) {
  const s = S.scale;
  const el = h('div', { class: 'obj ' + o.type + (S.sel?.id === o.id ? ' selected' : '') + (o.nowrap ? ' nowrap' : ''), 'data-id': o.id });
  const op = o.opacity ?? 1;
  const place = (b) => Object.assign(el.style, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
  switch (o.type) {
    case 'rect': case 'ellipse': {
      place(o);
      const sw = o.stroke ? o.width : 0;
      const dash = o.dash ? `stroke-dasharray="${o.width * 3} ${o.width * 2}"` : '';
      const fill = o.fill || 'none';
      const st = `stroke="${o.stroke || 'none'}" stroke-width="${sw}" fill="${fill}" ${dash}`;
      const shape = o.type === 'rect'
        ? `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, o.w - sw)}" height="${Math.max(0, o.h - sw)}" ${st}/>`
        : `<ellipse cx="${o.w / 2}" cy="${o.h / 2}" rx="${Math.max(0, (o.w - sw) / 2)}" ry="${Math.max(0, (o.h - sw) / 2)}" ${st}/>`;
      el.innerHTML = svgWrap(`0 0 ${o.w || 1} ${o.h || 1}`, shape);
      el.style.opacity = op;
      if (o.blend) el.style.mixBlendMode = 'multiply';
      break;
    }
    case 'line': case 'arrow': case 'measure': {
      const pad = o.width * 4 + 14;
      const b = objBox(o);
      const vb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      place(vb);
      const dash = o.dash ? `stroke-dasharray="${o.width * 3} ${o.width * 2}"` : '';
      let inner = `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${o.stroke}" stroke-width="${o.width}" stroke-linecap="round" ${dash}/>`;
      if (o.type === 'arrow') inner += `<polygon points="${arrowHeadPts(o.x1, o.y1, o.x2, o.y2, o.width).map((p) => p.join(',')).join(' ')}" fill="${o.stroke}"/>`;
      if (o.type === 'measure') {
        const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), t = 6;
        const nx = -Math.sin(ang) * t, ny = Math.cos(ang) * t;
        inner += `<line x1="${o.x1 + nx}" y1="${o.y1 + ny}" x2="${o.x1 - nx}" y2="${o.y1 - ny}" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        inner += `<line x1="${o.x2 + nx}" y1="${o.y2 + ny}" x2="${o.x2 - nx}" y2="${o.y2 - ny}" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2;
        inner += `<text x="${mx}" y="${my - 5}" font-size="10" font-family="Arial, sans-serif" fill="${o.stroke}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(measureLabel(o))}</text>`;
      }
      el.innerHTML = svgWrap(`${vb.x} ${vb.y} ${vb.w} ${vb.h}`, inner);
      el.style.opacity = op;
      break;
    }
    case 'ink': {
      const pad = o.width + 4;
      const b = objBox(o);
      const vb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      place(vb);
      const paths = o.strokes.map((st) => `<path d="${inkPath(st)}" fill="none" stroke="${o.stroke}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      el.innerHTML = svgWrap(`${vb.x} ${vb.y} ${vb.w} ${vb.h}`, paths);
      el.style.opacity = op;
      if (o.blend) el.style.mixBlendMode = 'multiply';
      break;
    }
    case 'text': {
      Object.assign(el.style, { left: px(o.x), top: px(o.y), width: o.nowrap ? 'auto' : px(o.w), minHeight: px(o.size * 1.2) });
      if (o.cover) {
        el.append(h('div', { class: 'cover', style: { left: px(o.cover.x - o.x), top: px(o.cover.y - o.y), width: px(o.cover.w), height: px(o.cover.h), background: o.coverColor || '#fff' } }));
      }
      const tx = h('div', { class: 'tx', style: {
        fontFamily: FONT_CSS[o.font] || FONT_CSS.helv, fontSize: o.size * s + 'px', color: o.color, fontWeight: o.bold ? 700 : 400,
        fontStyle: o.italic ? 'italic' : 'normal', textAlign: o.align || 'left', background: o.bg || 'transparent', opacity: op, position: 'relative',
      } });
      tx.textContent = o.text;
      el.append(tx);
      break;
    }
    case 'image': {
      place(o);
      el.append(h('img', { src: o.src, alt: '', draggable: 'false', style: { opacity: op } }));
      break;
    }
    case 'stamp': {
      place(o);
      const fs = o.sub ? o.h * 0.38 : o.h * 0.5;
      el.append(h('div', { class: 'st', style: { borderColor: o.color, color: o.color, borderWidth: Math.max(1.5, o.h * 0.06) * s + 'px', fontSize: fs * s + 'px', opacity: op } },
        h('div', {}, o.text), o.sub ? h('div', { style: { fontSize: fs * 0.45 * s + 'px', fontWeight: 600, marginTop: o.h * 0.04 * s + 'px' } }, o.sub) : null));
      break;
    }
    case 'note': {
      place(o);
      el.title = (o.author ? o.author + ': ' : '') + (o.text || '');
      el.append(h('div', { class: 'ni', style: { background: o.color || '#ffd84d' }, html: `<svg viewBox="0 0 24 24" fill="none" stroke="#5a4800" stroke-width="2"><path d="${ICONS.note}"/></svg>` }));
      break;
    }
    case 'markup': {
      const b = objBox(o);
      place(b);
      for (const r of o.rects) {
        let st;
        if (o.kind === 'highlight') st = { left: px(r.x - b.x), top: px(r.y - b.y), width: px(r.w), height: px(r.h), background: o.color, opacity: o.opacity ?? 0.45, mixBlendMode: 'multiply' };
        else {
          const th = Math.max(1, r.h * 0.08);
          const top = o.kind === 'underline' ? r.y + r.h * 0.86 : r.y + r.h * 0.52;
          st = { left: px(r.x - b.x), top: px(top - b.y - th / 2), width: px(r.w), height: px(th), background: o.color, opacity: o.opacity ?? 1 };
        }
        el.append(h('div', { class: 'mk', style: st }));
      }
      if (o.comment) el.title = o.comment;
      break;
    }
    case 'link': place(o); el.append(h('div', { class: 'lk', title: o.url ? o.url : 'Ir a la página ' + (o.dest + 1) })); break;
    case 'redact': place(o); el.append(h('div', { class: 'rd', title: 'Se redactará al aplicar las redacciones' })); break;
    case 'field': {
      place(o);
      const lbl = { text: 'T', check: '☑', radio: '◉', dropdown: '▾', list: '☰', button: '⏺' }[o.ftype] || '';
      el.append(h('div', { class: 'fd', style: { justifyContent: o.ftype === 'check' || o.ftype === 'radio' ? 'center' : 'flex-start' } }, o.ftype === 'check' || o.ftype === 'radio' ? lbl : `${lbl} ${o.name}`));
      break;
    }
    case 'mark': {
      place(o);
      const fill = o.kind === 'dot';
      el.innerHTML = svgWrap('0 0 22 22', `<path d="${MARK_PATHS[o.kind]}" fill="${fill ? o.stroke : 'none'}" stroke="${o.stroke}" stroke-width="${fill ? 0 : 2.6}" stroke-linecap="round" stroke-linejoin="round"/>`);
      el.style.opacity = op;
      break;
    }
  }
  return el;
}
function inkPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} ` + pts.map((p) => `L${p[0]} ${p[1]}`).join(' ');
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]} ${l[1]}`;
}
function measureTextObj(o) {
  // tras dibujar, guarda el tamaño real del texto (para exportar y para los tiradores)
  const el = S.pages[o.page]?.el?.querySelector(`.obj[data-id="${o.id}"] .tx`);
  if (!el) return;
  if (o.nowrap) o.w = Math.max(4, el.scrollWidth / S.scale);
  o.h = Math.max(o.size * 1.2, el.offsetHeight / S.scale);
}

/* ---------- selección y tiradores ---------- */
function selectObj(o) {
  const prev = S.sel;
  S.sel = o;
  if (prev && prev.page !== o?.page) renderOverlay(prev.page);
  if (o) renderOverlay(o.page);
  renderProps();
}
function deselect() { if (!S.sel) return; const p = S.sel.page; S.sel = null; renderOverlay(p); renderProps(); }
function drawHandles(ov, o) {
  if (o.type === 'text') measureTextObj(o);
  const handles = [];
  if (LINE_TYPES.has(o.type)) handles.push(['p1', o.x1, o.y1], ['p2', o.x2, o.y2]);
  else if (BOX_TYPES.has(o.type) && o.type !== 'note' || o.type === 'ink') {
    const b = objBox(o);
    const pts = { nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y], e: [b.x + b.w, b.y + b.h / 2], se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h], sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2] };
    for (const [k, [x, y]] of Object.entries(pts)) {
      if (o.type === 'text' && !['e', 'w'].includes(k)) continue;
      if (o.type === 'text' && o.nowrap) continue;
      handles.push([k, x, y]);
    }
  }
  const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move' };
  for (const [k, x, y] of handles) {
    const hd = h('div', { class: 'handle' + (k.startsWith('p') ? ' round' : ''), 'data-h': k, style: { left: px(x), top: px(y), cursor: cursors[k] } });
    hd.addEventListener('pointerdown', (e) => startResize(e, o, k));
    ov.append(hd);
  }
}

function pagePoint(pi, e) {
  const r = S.pages[pi].el.getBoundingClientRect();
  return [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale];
}

// arrastre genérico con captura de puntero
function dragLoop(e, onMove, onEnd) {
  e.preventDefault();
  const target = e.target;
  try { target.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
  const mv = (ev) => onMove(ev);
  const up = (ev) => {
    target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
    onEnd?.(ev);
  };
  target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
}

function onObjPointerDown(e, o) {
  if (S.tool !== 'select' || e.button !== 0) return;
  const tx = e.target.closest('.tx[contenteditable]');
  if (tx) return; // editando texto
  e.stopPropagation();
  if (S.sel?.id !== o.id) selectObj(o);
  const pi = o.page;
  const [sx, sy] = pagePoint(pi, e);
  let moved = false;
  const orig = clone(o);
  dragLoop(e, (ev) => {
    const [x, y] = pagePoint(pi, ev);
    let dx = x - sx, dy = y - sy;
    if (!moved && Math.hypot(dx, dy) * S.scale < 3) return;
    if (!moved) { pushUndo(); moved = true; }
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    Object.assign(o, clone(orig));
    moveObj(o, dx, dy);
    renderOverlay(pi);
  }, () => { if (moved) { changed(o); renderProps(); } });
}

function startResize(e, o, k) {
  e.stopPropagation();
  const pi = o.page;
  const orig = clone(o);
  const b0 = objBox(orig);
  pushUndo();
  dragLoop(e, (ev) => {
    const [x, y] = pagePoint(pi, ev);
    Object.assign(o, clone(orig));
    if (k === 'p1' || k === 'p2') {
      let nx = x, ny = y;
      if (ev.shiftKey) { // ángulos de 45°
        const ox = k === 'p1' ? o.x2 : o.x1, oy = k === 'p1' ? o.y2 : o.y1;
        const ang = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x - ox, y - oy);
        nx = ox + Math.cos(ang) * len; ny = oy + Math.sin(ang) * len;
      }
      if (k === 'p1') { o.x1 = nx; o.y1 = ny; } else { o.x2 = nx; o.y2 = ny; }
    } else {
      let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
      if (k.includes('w')) x0 = Math.min(x, x1 - 4);
      if (k.includes('e')) x1 = Math.max(x, x0 + 4);
      if (k.includes('n')) y0 = Math.min(y, y1 - 4);
      if (k.includes('s')) y1 = Math.max(y, y0 + 4);
      const keep = (ev.shiftKey || o.type === 'image' || o.type === 'mark') && k.length === 2;
      if (keep && b0.w && b0.h) {
        const ratio = b0.w / b0.h;
        let w = x1 - x0, hh = y1 - y0;
        if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
        if (k.includes('w')) x0 = x1 - w; else x1 = x0 + w;
        if (k.includes('n')) y0 = y1 - hh; else y1 = y0 + hh;
      }
      const nb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (o.type === 'ink') {
        const sx = b0.w ? nb.w / b0.w : 1, sy = b0.h ? nb.h / b0.h : 1;
        o.strokes = orig.strokes.map((st) => st.map(([px0, py0]) => [nb.x + (px0 - b0.x) * sx, nb.y + (py0 - b0.y) * sy]));
      } else if (o.type === 'text') { o.x = nb.x; o.w = nb.w; }
      else Object.assign(o, nb);
    }
    renderOverlay(pi);
  }, () => { changed(o); renderProps(); });
}

function startTextEdit(o) {
  if (o.type !== 'text') return;
  if (S.tool !== 'select') setTool('select');
  selectObj(o);
  const el = S.pages[o.page].el.querySelector(`.obj[data-id="${o.id}"] .tx`);
  if (!el) return;
  try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.focus();
  const range = document.createRange(); range.selectNodeContents(el);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const before = o.text;
  const finish = () => {
    el.removeEventListener('blur', finish);
    el.removeAttribute('contenteditable');
    const txt = el.innerText.replace(/\n$/, '');
    if (!txt.trim()) { removeObject(o, { undoable: before !== '' }); return; }
    if (txt !== before) { if (before !== '') pushUndo(); o.text = txt; }
    measureTextObj(o);
    changed(o);
    renderProps();
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
  });
  el.addEventListener('input', () => { if (o.nowrap) { o.w = el.scrollWidth / S.scale; } });
}

/* ---------- panel de propiedades ---------- */
function colorPicker(value, onChange, { allowNone = false } = {}) {
  const wrap = h('div', { class: 'colors' });
  const set = (v) => { onChange(v); $$('button', wrap).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); };
  if (allowNone) wrap.append(h('button', { class: 'none' + (value == null ? ' on' : ''), 'data-v': 'null', title: 'Sin color', onclick: () => set(null) }));
  for (const c of PALETTE) wrap.append(h('button', { style: { background: c }, class: c === value ? 'on' : '', 'data-v': c, title: c, onclick: () => set(c) }));
  const ci = h('input', { type: 'color', value: value || '#000000', title: 'Otro color' });
  ci.addEventListener('input', () => set(ci.value));
  wrap.append(ci);
  return wrap;
}
function propRow(label, ctl) { return h('div', { class: 'prop' }, h('label', {}, label), ctl); }
function numInput(value, onChange, { min = 0, max = 999, step = 1 } = {}) {
  const i = h('input', { type: 'number', value: Math.round(value * 100) / 100, min, max, step });
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) onChange(clamp(v, min, max)); });
  return i;
}
function rangeInput(value, onChange, { min = 0, max = 1, step = 0.05 } = {}) {
  const i = h('input', { type: 'range', min, max, step });
  i.value = value;
  i.addEventListener('input', () => onChange(parseFloat(i.value)));
  return i;
}
function toggleBtn(label, on, onChange, title) {
  const b = h('button', { class: 'toggle' + (on ? ' on' : ''), title }, label);
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); onChange(v); });
  return b;
}

const TOOL_HELP = {
  select: 'Hacé clic en un objeto para seleccionarlo, arrastralo para moverlo y usá los tiradores para cambiar su tamaño. Doble clic en un texto para editarlo. También podés seleccionar texto del PDF y completar formularios.',
  hand: 'Arrastrá para desplazarte por el documento.',
  edittext: 'Hacé clic sobre cualquier texto del PDF para reemplazarlo. El texto original queda cubierto y se escribe el nuevo en su lugar.',
  text: 'Hacé clic donde quieras escribir.', note: 'Hacé clic para pegar una nota adhesiva.',
  highlight: 'Seleccioná texto con el mouse para resaltarlo.', underline: 'Seleccioná texto para subrayarlo.', strike: 'Seleccioná texto para tacharlo.',
  hlarea: 'Arrastrá para resaltar un área.', ink: 'Dibujá a mano alzada. Mantené Mayús para trazos rectos.', rect: 'Arrastrá para dibujar. Mayús = cuadrado.',
  ellipse: 'Arrastrá para dibujar. Mayús = círculo.', line: 'Arrastrá para dibujar. Mayús = ángulos de 45°.', arrow: 'Arrastrá para dibujar una flecha.',
  measure: 'Arrastrá para medir distancias. Podés cambiar la escala y la unidad en este panel.', stamp: 'Hacé clic para colocar el sello elegido.',
  image: 'Hacé clic para colocar la imagen elegida.', link: 'Arrastrá para definir el área del enlace.', whiteout: 'Arrastrá para tapar contenido con un rectángulo blanco.',
  redact: 'Arrastrá para marcar contenido a eliminar. Después usá "Aplicar redacciones".', crop: 'Arrastrá un rectángulo para recortar la página.',
  signature: 'Hacé clic para colocar tu firma.', initials: 'Hacé clic para colocar tus iniciales.', date: 'Hacé clic para insertar la fecha de hoy.',
  'mark-check': 'Hacé clic para colocar una tilde.', 'mark-cross': 'Hacé clic para colocar una cruz.', 'mark-dot': 'Hacé clic para colocar un punto.',
  'field-text': 'Arrastrá para crear un campo de texto.', 'field-check': 'Arrastrá para crear una casilla de verificación.', 'field-radio': 'Arrastrá para crear un botón de opción.',
  'field-dropdown': 'Arrastrá para crear una lista desplegable.', 'field-list': 'Arrastrá para crear un cuadro de lista.',
};
const STYLE_KEYS = {
  rect: ['stroke', 'fill', 'width', 'opacity', 'dash'], ellipse: ['stroke', 'fill', 'width', 'opacity', 'dash'], line: ['stroke', 'width', 'opacity', 'dash'],
  arrow: ['stroke', 'width', 'opacity', 'dash'], ink: ['stroke', 'width', 'opacity'], measure: ['stroke', 'width'],
  text: ['font', 'size', 'color', 'bold', 'italic', 'align', 'bg'], date: ['font', 'size', 'color'], hlarea: ['hl'], highlight: ['hl'], underline: ['stroke'], strike: ['stroke'],
  'mark-check': ['stroke'], 'mark-cross': ['stroke'], 'mark-dot': ['stroke'], note: ['note'],
};

function styleControls(keys, get, set) {
  const out = [];
  const L = { stroke: 'Color', fill: 'Relleno', width: 'Grosor', opacity: 'Opacidad', font: 'Fuente', size: 'Tamaño', color: 'Color', bg: 'Fondo', hl: 'Color', note: 'Color' };
  for (const k of keys) {
    if (k === 'stroke' || k === 'color' || k === 'hl' || k === 'note') out.push(propRow(L[k], colorPicker(get(k), (v) => set(k, v), { allowNone: false })));
    else if (k === 'fill' || k === 'bg') out.push(propRow(L[k], colorPicker(get(k), (v) => set(k, v), { allowNone: true })));
    else if (k === 'width') out.push(propRow(L[k], numInput(get(k), (v) => set(k, v), { min: 0.25, max: 40, step: 0.5 })));
    else if (k === 'size') out.push(propRow(L[k], numInput(get(k), (v) => set(k, v), { min: 4, max: 200, step: 1 })));
    else if (k === 'opacity') out.push(propRow(L[k], rangeInput(get(k) ?? 1, (v) => set(k, v), { min: 0.05, max: 1 })));
    else if (k === 'font') {
      const sel = h('select', {}, ...FONT_NAMES.map(([v, l]) => h('option', { value: v, selected: v === get(k) }, l)));
      sel.addEventListener('change', () => set(k, sel.value));
      out.push(propRow(L[k], sel));
    } else if (k === 'bold') {
      out.push(propRow('Estilo', h('div', { class: 'prop-row' },
        toggleBtn('N', get('bold'), (v) => set('bold', v), 'Negrita'),
        h('span', { style: { fontStyle: 'italic' } }, toggleBtn('C', get('italic'), (v) => set('italic', v), 'Cursiva')))));
    } else if (k === 'align') {
      const sel = h('select', {}, ...[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([v, l]) => h('option', { value: v, selected: v === get(k) }, l)));
      sel.addEventListener('change', () => set(k, sel.value));
      out.push(propRow('Alineación', sel));
    } else if (k === 'dash') {
      out.push(propRow('Trazo', toggleBtn('- -', get('dash'), (v) => set('dash', v), 'Discontinuo')));
    }
  }
  return out;
}

function renderProps() {
  const p = $('#props');
  if (!p) return;
  p.innerHTML = '';
  const o = S.sel;
  if (!o) {
    const t = S.tool;
    p.append(h('h3', {}, icon(TOOLS[t]?.icon || 'select'), TOOLS[t]?.label || 'Seleccionar'));
    p.append(h('p', { class: 'props-help' }, TOOL_HELP[t] || ''));
    const keys = STYLE_KEYS[t];
    if (keys) {
      const map = { hl: 'hl', note: 'note' };
      p.append(...styleControls(keys, (k) => S.style[map[k] || k], (k, v) => { S.style[map[k] || k] = v; }));
    }
    if (t === 'measure') {
      const unit = h('select', {}, ...[['mm', 'mm'], ['cm', 'cm'], ['in', 'pulgadas'], ['pt', 'puntos']].map(([v, l]) => h('option', { value: v, selected: v === (S.style.unit || 'mm') }, l)));
      unit.addEventListener('change', () => (S.style.unit = unit.value));
      p.append(propRow('Unidad', unit), propRow('Escala 1:', numInput(S.style.ratio || 1, (v) => (S.style.ratio = v), { min: 0.0001, max: 1e6, step: 1 })));
    }
    if (t === 'stamp') p.append(h('button', { class: 'btn small', onclick: () => chooseStamp() }, 'Elegir sello…'));
    if (t === 'signature' || t === 'initials') p.append(h('button', { class: 'btn small', onclick: () => signatureManager(t) }, 'Administrar firmas…'));
    if (t === 'select' && S.pdf) {
      p.append(h('div', { class: 'props-help', style: { marginTop: '14px' }, html:
        '<b>Atajos</b><br><span class="kbd">Supr</span> borrar · <span class="kbd">Ctrl D</span> duplicar<br><span class="kbd">Ctrl C/V</span> copiar/pegar · flechas: mover<br><span class="kbd">Ctrl Z/Y</span> deshacer/rehacer<br><span class="kbd">V</span> seleccionar · <span class="kbd">H</span> mano · <span class="kbd">T</span> texto' }));
    }
    return;
  }
  p.append(h('h3', {}, o.type === 'markup' ? MARKUP_NAMES[o.kind] : TYPE_NAMES[o.type] || o.type));
  const upd = (k, v) => {
    pushUndo();
    o[k] = v;
    if (['stroke', 'fill', 'width', 'opacity', 'font', 'size', 'color', 'bold', 'italic', 'align', 'bg', 'dash'].includes(k)) S.style[k] = v;
    changed(o);
    if (o.type === 'text') setTimeout(() => { measureTextObj(o); renderOverlay(o.page); }, 0);
  };
  const get = (k) => o[k];
  let keys = STYLE_KEYS[o.type] || [];
  if (o.type === 'rect' && o.blend) keys = ['fill', 'opacity'];
  if (o.type === 'markup') keys = [o.kind === 'highlight' ? 'hl' : 'stroke'];
  if (o.type === 'note') keys = ['note'];
  if (o.type === 'stamp') keys = ['color', 'opacity'];
  if (o.type === 'image') keys = ['opacity'];
  if (o.type === 'mark') keys = ['stroke', 'opacity'];
  if (o.type === 'text') keys = [...keys, 'opacity'];
  const keyMap = { hl: 'color', note: 'color' };
  p.append(...styleControls(keys, (k) => get(keyMap[k] || k), (k, v) => upd(keyMap[k] || k, v)));

  if (o.type === 'text') {
    p.append(h('button', { class: 'btn small', style: { marginBottom: '8px' }, onclick: () => startTextEdit(o) }, icon('edit'), 'Editar texto'));
    if (o.cover) p.append(propRow('Cubierta', colorPicker(o.coverColor || '#ffffff', (v) => { pushUndo(); o.coverColor = v; changed(o); })));
  }
  if (o.type === 'note' || o.type === 'markup') {
    const ta = h('textarea', { rows: 4, placeholder: 'Comentario…' });
    ta.value = (o.type === 'note' ? o.text : o.comment) || '';
    ta.addEventListener('change', () => { pushUndo(); if (o.type === 'note') o.text = ta.value; else o.comment = ta.value; changed(o); refreshCommentsIfOpen(); });
    p.append(propRow('Comentario', ta));
  }
  if (o.type === 'stamp') {
    const ti = h('input', { type: 'text', value: o.text });
    ti.addEventListener('change', () => upd('text', ti.value));
    const si = h('input', { type: 'text', value: o.sub || '' });
    si.addEventListener('change', () => upd('sub', si.value));
    p.append(propRow('Texto', ti), propRow('Subtítulo', si));
  }
  if (o.type === 'measure') {
    const unit = h('select', {}, ...[['mm', 'mm'], ['cm', 'cm'], ['in', 'pulgadas'], ['pt', 'puntos']].map(([v, l]) => h('option', { value: v, selected: v === (o.unit || 'mm') }, l)));
    unit.addEventListener('change', () => upd('unit', unit.value));
    p.append(propRow('Unidad', unit), propRow('Escala 1:', numInput(o.ratio || 1, (v) => upd('ratio', v), { min: 0.0001, max: 1e6 })), propRow('Medida', h('b', {}, measureLabel(o))));
  }
  if (o.type === 'link') {
    const mode = h('select', {}, h('option', { value: 'url', selected: !!o.url }, 'Sitio web (URL)'), h('option', { value: 'page', selected: !o.url }, 'Página del documento'));
    const url = h('input', { type: 'text', value: o.url || '', placeholder: 'https://…' });
    const pg = h('input', { type: 'number', value: (o.dest ?? 0) + 1, min: 1, max: S.pages.length });
    const sync = () => { url.parentElement.hidden = mode.value !== 'url'; pg.parentElement.hidden = mode.value !== 'page'; };
    mode.addEventListener('change', () => { sync(); });
    url.addEventListener('change', () => { pushUndo(); o.url = url.value.trim(); delete o.dest; changed(o); });
    pg.addEventListener('change', () => { pushUndo(); o.url = ''; o.dest = clamp(+pg.value - 1, 0, S.pages.length - 1); changed(o); });
    p.append(propRow('Destino', mode), propRow('URL', url), propRow('Página', pg));
    sync();
  }
  if (o.type === 'field') {
    const name = h('input', { type: 'text', value: o.name });
    name.addEventListener('change', () => upd('name', name.value.trim() || o.name));
    p.append(propRow('Nombre', name));
    if (o.ftype === 'radio') {
      const val = h('input', { type: 'text', value: o.value || '' });
      val.addEventListener('change', () => upd('value', val.value.trim()));
      p.append(propRow('Valor', val), h('p', { class: 'props-help' }, 'Los botones de opción con el mismo nombre forman un grupo.'));
    }
    if (o.ftype === 'dropdown' || o.ftype === 'list') {
      const opts = h('textarea', { rows: 4, placeholder: 'Una opción por línea' });
      opts.value = (o.options || []).join('\n');
      opts.addEventListener('change', () => upd('options', opts.value.split('\n').map((x) => x.trim()).filter(Boolean)));
      p.append(propRow('Opciones', opts));
    }
    if (o.ftype === 'text') {
      const def = h('input', { type: 'text', value: o.value || '' });
      def.addEventListener('change', () => upd('value', def.value));
      p.append(propRow('Valor inicial', def), propRow('Tamaño letra', numInput(o.fontSize || 0, (v) => upd('fontSize', v), { min: 0, max: 72 })),
        propRow('Multilínea', toggleBtn('¶', o.multiline, (v) => upd('multiline', v))));
    }
    p.append(propRow('Obligatorio', toggleBtn('*', o.required, (v) => upd('required', v))));
  }
  // posición y tamaño
  const b = objBox(o);
  p.append(h('div', { class: 'props-help', style: { margin: '6px 0 10px' } }, `Posición: ${b.x.toFixed(0)}, ${b.y.toFixed(0)} pt · Tamaño: ${b.w.toFixed(0)} × ${b.h.toFixed(0)} pt`));
  p.append(h('div', { class: 'prop-row' },
    h('button', { class: 'btn small', title: 'Duplicar (Ctrl D)', onclick: () => duplicateSel() }, icon('copy'), 'Duplicar'),
    h('button', { class: 'btn small', title: 'Traer al frente', onclick: () => zOrder(o, 1) }, icon('front')),
    h('button', { class: 'btn small', title: 'Enviar al fondo', onclick: () => zOrder(o, -1) }, icon('back')),
    h('button', { class: 'btn small danger', title: 'Eliminar (Supr)', onclick: () => removeObject(o) }, icon('trash'), 'Eliminar')));
  if (['image', 'stamp', 'text', 'rect', 'mark'].includes(o.type)) {
    p.append(h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: () => copyToPages(o) }, icon('copy'), 'Repetir en otras páginas…'));
  }
  if (o.type === 'redact') p.append(h('button', { class: 'btn small primary', style: { marginTop: '8px' }, onclick: () => applyRedactions() }, 'Aplicar redacciones'));
}
function zOrder(o, dir) {
  pushUndo();
  const arr = S.objects[o.page];
  const k = arr.indexOf(o);
  arr.splice(k, 1);
  if (dir > 0) arr.push(o); else arr.unshift(o);
  changed(o);
}
let clipboard = null;
function duplicateSel() {
  const o = S.sel;
  if (!o) return;
  const c = clone(o); c.id = uid(); moveObj(c, 12, 12);
  addObject(o.page, c);
}
async function copyToPages(o) {
  const v = await formDialog('Repetir en otras páginas', [{ name: 'range', label: 'Páginas', value: '', help: rangeHelp }], { ok: 'Repetir' });
  if (!v) return;
  let idx;
  try { idx = parseRange(v.range, S.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  pushUndo();
  let n = 0;
  for (const i of idx) {
    if (i === o.page) continue;
    const c = clone(o); c.id = uid(); c.page = i;
    S.objects[i].push(c); renderOverlay(i); invalidateThumb(i); n++;
  }
  toast(`Copiado en ${n} página(s)`, 'ok');
}

/* ---------- dibujo aproximado en lienzo (miniaturas) ---------- */
function drawObjectsOnCanvas(ctx, pi, sc) {
  for (const o of S.objects[pi] || []) {
    ctx.save();
    ctx.globalAlpha = o.opacity ?? 1;
    ctx.lineWidth = (o.width || 1) * sc;
    ctx.strokeStyle = o.stroke || '#000';
    const b = objBox(o);
    const R = (r) => [r.x * sc, r.y * sc, r.w * sc, r.h * sc];
    switch (o.type) {
      case 'rect': if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(...R(b)); } if (o.stroke) ctx.strokeRect(...R(b)); break;
      case 'ellipse': ctx.beginPath(); ctx.ellipse((b.x + b.w / 2) * sc, (b.y + b.h / 2) * sc, b.w / 2 * sc, b.h / 2 * sc, 0, 0, Math.PI * 2); if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); } if (o.stroke) ctx.stroke(); break;
      case 'line': case 'arrow': case 'measure': ctx.beginPath(); ctx.moveTo(o.x1 * sc, o.y1 * sc); ctx.lineTo(o.x2 * sc, o.y2 * sc); ctx.stroke(); break;
      case 'ink': for (const st of o.strokes) { ctx.beginPath(); st.forEach(([x, y], k) => (k ? ctx.lineTo(x * sc, y * sc) : ctx.moveTo(x * sc, y * sc))); ctx.stroke(); } break;
      case 'text':
        if (o.cover) { ctx.fillStyle = o.coverColor || '#fff'; ctx.fillRect(...R(o.cover)); }
        if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(...R(b)); }
        ctx.fillStyle = o.color; ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size * sc}px ${FONT_CSS[o.font]}`; ctx.textBaseline = 'top';
        o.text.split('\n').forEach((ln, k) => ctx.fillText(ln, b.x * sc, (b.y + k * o.size * 1.2 + o.size * 0.1) * sc));
        break;
      case 'image': { const im = getImg(o.src); if (im.complete) ctx.drawImage(im, ...R(b)); break; }
      case 'stamp': ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1, b.h * 0.06 * sc); ctx.strokeRect(...R(b)); ctx.fillStyle = o.color; ctx.font = `bold ${b.h * 0.4 * sc}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.text, (b.x + b.w / 2) * sc, (b.y + b.h / 2) * sc); break;
      case 'markup': ctx.fillStyle = o.color; for (const r of o.rects) { if (o.kind === 'highlight') { ctx.globalAlpha = 0.4; ctx.fillRect(...R(r)); } else ctx.fillRect(r.x * sc, (r.y + r.h * (o.kind === 'underline' ? 0.86 : 0.5)) * sc, r.w * sc, Math.max(1, r.h * 0.08 * sc)); } break;
      case 'note': ctx.fillStyle = o.color || '#ffd84d'; ctx.fillRect(...R(b)); break;
      case 'redact': ctx.fillStyle = '#000'; ctx.globalAlpha = 0.5; ctx.fillRect(...R(b)); break;
      case 'mark': ctx.strokeStyle = o.stroke; ctx.strokeRect(...R(b)); break;
      default: break;
    }
    ctx.restore();
  }
}
