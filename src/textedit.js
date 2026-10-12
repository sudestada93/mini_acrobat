/* Edición de texto: detección de líneas y párrafos del PDF, modelo de texto con formato por fragmento,
   maquetado preciso, editor en pantalla y escritura en el PDF (reutilizando la fuente original y
   eliminando el texto reemplazado del contenido de la página). */

const BASE_RATIO = { helv: 0.9465, times: 0.9375, cour: 0.8665 };
const r2 = (v) => Math.round(v * 100) / 100;
const sameStyle = (a, b) => a.s === b.s && a.c === b.c && (a.hs || 1) === (b.hs || 1) && Math.abs((a.cs || 0) - (b.cs || 0)) < 0.01 && Math.abs((a.ws || 0) - (b.ws || 0)) < 0.01 &&
  JSON.stringify(a.fd) === JSON.stringify(b.fd);
const styleOf = (r) => ({ fd: clone(r.fd), s: r.s, c: r.c, hs: r.hs || 1, cs: r.cs || 0, ws: r.ws || 0 });

// Convierte objetos de texto del formato anterior (texto plano) al modelo con fragmentos
function ensureRuns(o) {
  if (o.runs) return o;
  const key = o.font || 'helv';
  const s = o.size || 14;
  o.runs = [{ t: o.text || '', fd: stdFd(key, !!o.bold, !!o.italic), s, c: o.color || '#000000' }];
  o.asc = (BASE_RATIO[key] || 0.9465) * s;
  o.desc = 0.25 * s;
  o.lh = 1.2 * s;
  if (o.cover && !o.regions) { o.regions = [o.cover]; o.edit = true; }
  for (const k of ['text', 'size', 'font', 'color', 'bold', 'italic', 'cover']) delete o[k];
  return o;
}
const textOf = (o) => (o.runs ? o.runs.map((r) => r.t).join('') : o.text || '');

// Carga las fuentes del PDF que usan los textos editados (para mostrarlos y guardarlos con la fuente original)
async function preloadTextFonts() {
  const need = new Map();
  S.objects.forEach((arr, pi) => arr.forEach((o) => { if (o.type === 'text' && o.runs) for (const r of o.runs) if (r.fd.pdf) { if (!need.has(pi)) need.set(pi, new Set()); need.get(pi).add(r.fd.pdf); } }));
  for (const [pi, bases] of need) {
    if (!S.pages[pi]) continue;
    await loadPageFonts(pi);
    for (const b of bases) {
      if (pdfFontFor(pi, b)) continue;
      for (let j = 0; j < S.pages.length && !pdfFontFor(pi, b); j++) await loadPageFonts(j);
    }
  }
}

/* ---------- maquetado ---------- */
function layoutText(o) {
  ensureRuns(o);
  const pi = o.page ?? 0;
  const paras = [[]];
  for (const run of o.runs) {
    const hs = run.hs || 1, cs = run.cs || 0;
    for (const p of run.t.split(/(\n| +)/)) {
      if (!p) continue;
      if (p === '\n') { paras.push([]); continue; }
      const piece = { t: p, run, kind: p[0] === ' ' ? 's' : 'w' };
      if (piece.kind === 'w') {
        piece.rf = resolveFont(pi, run.fd, p);
        piece.w = measureWith(piece.rf, p, run.s) * hs + cs * [...p].length;
      } else piece.w = p.length * (spaceWidth(pi, run.fd, run.s) * hs + (run.ws || 0) + cs);
      piece.adv = piece.w;
      paras[paras.length - 1].push(piece);
    }
    // el ajuste "kern" va al final del fragmento (espacio original hasta el siguiente)
    const lp = paras[paras.length - 1][paras[paras.length - 1].length - 1];
    if (run.kern && lp && lp.run === run && !run.t.endsWith('\n')) lp.adv += run.kern;
  }
  const lines = [];
  paras.forEach((para) => {
    let line = { pieces: [], first: true, last: false };
    const avail = (first) => (o.nowrap ? Infinity : Math.max(8, o.w - (first ? o.indent || 0 : 0)));
    const width = (pcs) => { let w = 0; pcs.forEach((p, i) => { w += i === pcs.length - 1 ? p.w : p.adv; }); return w; };
    let i = 0;
    while (i < para.length) {
      // grupo = espacios previos + palabra (puede abarcar varios fragmentos)
      const grp = [];
      while (i < para.length && para[i].kind === 's') grp.push(para[i++]);
      while (i < para.length && para[i].kind === 'w') grp.push(para[i++]);
      const words = grp.filter((p) => p.kind === 'w');
      if (line.pieces.length && words.length && width([...line.pieces, ...grp]) > avail(line.first) + 0.01) {
        lines.push(line);
        line = { pieces: grp.filter((p) => p.kind === 'w'), first: false, last: false };
      } else line.pieces.push(...grp);
    }
    line.last = true;
    lines.push(line);
  });
  let maxW = 0;
  for (const ln of lines) {
    // los espacios al final de la línea no cuentan para la alineación (salvo en una sola línea)
    let end = ln.pieces.length;
    if (!o.nowrap) while (end > 0 && ln.pieces[end - 1].kind === 's') end--;
    ln.vis = ln.pieces.slice(0, end);
    ln.width = 0;
    ln.vis.forEach((p, k) => { ln.width += k === ln.vis.length - 1 ? p.w : p.adv; });
    maxW = Math.max(maxW, ln.width + (ln.first ? o.indent || 0 : 0));
  }
  const boxW = o.nowrap ? Math.max(2, maxW) : o.w;
  const out = [];
  lines.forEach((ln, k) => {
    const base = o.y + o.asc + k * o.lh;
    const ind = ln.first ? o.indent || 0 : 0;
    const avail = boxW - ind;
    let x = o.x + ind, extra = 0;
    const al = o.align || 'left';
    const spaces = ln.vis.filter((p, idx) => p.kind === 's' && idx > 0).reduce((a, p) => a + p.t.length, 0);
    if (al === 'justify' && !ln.last && spaces) extra = (avail - ln.width) / spaces;
    else if (al === 'center') x += (avail - ln.width) / 2;
    else if (al === 'right') x += avail - ln.width;
    const segs = [];
    ln.vis.forEach((p, idx) => {
      if (p.kind === 'w') segs.push({ t: p.t, run: p.run, rf: p.rf, x, w: p.w, base });
      x += p.adv + (p.kind === 's' && idx > 0 ? extra * p.t.length : 0);
    });
    out.push({ segs, base, width: ln.width });
  });
  if (o.nowrap) o.w = boxW;
  o.h = Math.max(1, o.asc + (lines.length - 1) * o.lh + (o.desc ?? o.lh * 0.25));
  return { lines: out };
}

/* ---------- dibujo en pantalla ---------- */
function segFontCss(seg) {
  const fd = seg.run.fd;
  if (seg.rf.kind === 'pdf' && seg.rf.h.embedded) return { family: `'${seg.rf.h.ln}'`, weight: 400, style: 'normal', text: pdfDisplayString(seg.rf.h, seg.t) };
  if (seg.rf.kind === 'ext' && seg.rf.e.css) return { family: `'${seg.rf.e.css}'`, weight: 400, style: 'normal', text: seg.t };
  if (seg.rf.kind === 'std') {
    // se muestra con la misma fuente estándar que se usará al guardar
    const n = seg.rf.name;
    const cat = /^Times/.test(n) ? 'serif' : /^Courier/.test(n) ? 'mono' : 'sans';
    return { family: GENERIC_CSS[cat], weight: /Bold/.test(n) ? 700 : 400, style: /Italic|Oblique/.test(n) ? 'italic' : 'normal', text: seg.t };
  }
  return { family: cssFamily(fd), weight: fd.bold ? 700 : 400, style: fd.italic ? 'italic' : 'normal', text: seg.t };
}
function textObjEl(o, el) {
  const L = layoutText(o);
  const s = S.scale;
  Object.assign(el.style, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h) });
  for (const r of o.edit ? o.regions || [] : []) {
    el.append(h('div', { class: 'cover', style: { left: px(r.x - o.x), top: px(r.y - o.y), width: px(r.w), height: px(r.h), background: o.coverColor || '#fff' } }));
  }
  if (o.bg) el.append(h('div', { class: 'cover', style: { left: 0, top: 0, width: '100%', height: '100%', background: o.bg, opacity: o.opacity ?? 1 } }));
  let svg = '';
  for (const ln of L.lines) for (const seg of ln.segs) {
    const f = segFontCss(seg);
    const hs = seg.run.hs || 1;
    const adj = hs !== 1 ? 'spacingAndGlyphs' : 'spacing';
    const tl = [...seg.t].length > 1 || hs !== 1 ? ` textLength="${seg.w.toFixed(3)}" lengthAdjust="${adj}"` : '';
    svg += `<text x="${seg.x.toFixed(3)}" y="${seg.base.toFixed(3)}" font-size="${seg.run.s}" fill="${seg.run.c}"${tl} xml:space="preserve" style="font-family:${esc(f.family)};font-weight:${f.weight};font-style:${f.style}">${esc(f.text)}</text>`;
  }
  const wrap = h('div', { class: 'tsvg', html: `<svg viewBox="${o.x} ${o.y} ${Math.max(o.w, 0.1)} ${Math.max(o.h, 0.1)}" preserveAspectRatio="none" style="opacity:${o.opacity ?? 1}">${svg}</svg>` });
  el.append(wrap);
  void s;
}
function drawTextOnCanvas(ctx, o, sc) {
  const L = layoutText(o);
  ctx.save();
  for (const r of o.edit ? o.regions || [] : []) { ctx.fillStyle = o.coverColor || '#fff'; ctx.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc); }
  if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(o.x * sc, o.y * sc, o.w * sc, o.h * sc); }
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.textBaseline = 'alphabetic';
  for (const ln of L.lines) for (const seg of ln.segs) {
    const f = segFontCss(seg);
    ctx.font = `${f.style} ${f.weight} ${seg.run.s * sc}px ${f.family.replace(/'/g, '"')}`;
    ctx.fillStyle = seg.run.c;
    ctx.fillText(f.text, seg.x * sc, seg.base * sc, seg.w * sc + 1);
  }
  ctx.restore();
}

/* ---------- análisis del texto de la página ---------- */
S.lineModels = [];
async function pageItems(pi) {
  if (S.lineModels[pi]) return S.lineModels[pi];
  const fonts = await loadPageFonts(pi);
  const tc = await getText(pi);
  const vt = S.pages[pi].vt;
  const items = [];
  tc.items.forEach((it, k) => {
    if (it.str === undefined || it.str === '') return;
    const tx = M.then(it.transform, vt);
    const fs = Math.hypot(tx[2], tx[3]);
    if (fs < 0.5) return;
    const horiz = Math.abs(tx[1]) < 1e-3 * fs && Math.abs(tx[2]) < 1e-3 * fs && tx[0] > 0 && tx[3] < 0;
    const fh = fonts.byLoaded?.get(it.fontName) || null;
    const st = tc.styles[it.fontName] || {};
    items.push({
      k, str: it.str, x: tx[4], base: tx[5], w: it.width, fs, hs: Math.abs(tx[0]) / fs, horiz, h: fh,
      asc: fh ? fh.asc : st.ascent || 0.8, desc: fh ? fh.desc : Math.abs(st.descent || 0.2), generic: st.fontFamily,
    });
  });
  // texto superpuesto para simular negrita (se dibuja dos veces con un leve desplazamiento)
  items.sort((a, b) => a.base - b.base || a.x - b.x);
  const out = [];
  for (const it of items) {
    const dup = out.find((p) => p.str === it.str && Math.abs(p.base - it.base) < 0.6 && Math.abs(p.x - it.x) < Math.max(1.2, it.fs * 0.08));
    if (dup) { dup.fakeBold = true; continue; }
    out.push(it);
  }
  S.lineModels[pi] = out;
  return out;
}
const itemBox = (it) => ({ x: it.x, y: it.base - it.asc * it.fs, w: it.w, h: (it.asc + it.desc) * it.fs });
function hitItem(items, x, y) {
  let best = null, ba = Infinity;
  for (const it of items) {
    if (!it.horiz) continue;
    const b = itemBox(it);
    if (x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1) { const a = b.w * b.h; if (a < ba) { ba = a; best = it; } }
  }
  return best;
}
function lineOf(items, seed) {
  const same = items.filter((o) => o.horiz && Math.abs(o.base - seed.base) < Math.max(1, 0.3 * Math.min(o.fs, seed.fs)) && o.fs > seed.fs * 0.45 && o.fs < seed.fs * 2.2).sort((a, b) => a.x - b.x);
  const i = same.indexOf(seed);
  let lo = i, hi = i;
  const ok = (a, b) => { const g = b.x - (a.x + a.w); const m = Math.max(a.fs, b.fs); return g < 1.4 * m && g > -0.6 * m; };
  while (lo > 0 && ok(same[lo - 1], same[lo])) lo--;
  while (hi < same.length - 1 && ok(same[hi], same[hi + 1])) hi++;
  return same.slice(lo, hi + 1);
}
function allLines(items) {
  const used = new Set();
  const lines = [];
  for (const it of items) {
    if (!it.horiz || used.has(it)) continue;
    const ln = lineOf(items, it).filter((x) => !used.has(x));
    ln.forEach((x) => used.add(x));
    if (ln.length) lines.push(ln);
  }
  return lines;
}
const lineLeft = (ln) => Math.min(...ln.map((i) => i.x));
const lineRight = (ln) => Math.max(...ln.map((i) => i.x + i.w));
const lineBase = (ln) => ln[0].base;
const lineFs = (ln) => Math.max(...ln.map((i) => i.fs));
function lineBox(ln) {
  const x0 = lineLeft(ln), x1 = lineRight(ln);
  const y0 = Math.min(...ln.map((i) => i.base - i.asc * i.fs)), y1 = Math.max(...ln.map((i) => i.base + i.desc * i.fs));
  return { x: x0 - 0.4, y: y0 - 0.3, w: x1 - x0 + 0.8, h: y1 - y0 + 0.6 };
}
function paragraphOf(items, seedLine) {
  const lines = allLines(items).sort((a, b) => lineBase(a) - lineBase(b));
  const idx = lines.findIndex((l) => l.includes(seedLine[0]));
  if (idx < 0) return [seedLine];
  const fs0 = lineFs(seedLine);
  const overlap = (a, b) => Math.min(lineRight(a), lineRight(b)) - Math.max(lineLeft(a), lineLeft(b)) > 0.3 * Math.min(lineRight(a) - lineLeft(a), lineRight(b) - lineLeft(b));
  const para = [lines[idx]];
  let left = lineLeft(lines[idx]), right = lineRight(lines[idx]);
  let step = null;
  // hacia abajo
  for (let j = idx + 1, prev = lines[idx]; j < lines.length; j++) {
    const L = lines[j];
    if (!overlap(L, prev)) continue;
    const d = lineBase(L) - lineBase(prev);
    if (d < 0.9 * fs0 || d > 2.3 * fs0 || (step && Math.abs(d - step) > 0.18 * step) || Math.abs(lineFs(L) - fs0) > 0.6 * fs0 * 0.5) break;
    if (Math.abs(lineLeft(L) - left) > 3 && Math.abs((lineLeft(L) + lineRight(L)) / 2 - (left + right) / 2) > 3) break;
    if (lineRight(prev) < right - 3 * fs0 && para.length > 1) break; // la anterior era la última del párrafo
    para.push(L); step = step || d; prev = L; right = Math.max(right, lineRight(L));
  }
  // hacia arriba
  for (let j = idx - 1, next = lines[idx]; j >= 0; j--) {
    const L = lines[j];
    if (!overlap(L, next)) continue;
    const d = lineBase(next) - lineBase(L);
    if (d < 0.9 * fs0 || d > 2.3 * fs0 || (step && Math.abs(d - step) > 0.18 * step) || Math.abs(lineFs(L) - fs0) > 0.3 * fs0) break;
    if (lineRight(L) < right - 3 * fs0) break; // termina un párrafo anterior
    const indented = lineLeft(L) > left + 0.5 && lineLeft(L) < left + 4 * fs0;
    if (Math.abs(lineLeft(L) - left) > 3 && !indented) break;
    para.unshift(L); step = step || d; next = L; right = Math.max(right, lineRight(L));
    if (indented) break; // sangría de primera línea: comienzo del párrafo
  }
  return para;
}

// Color del texto y del fondo a partir de la página dibujada
function sampleInk(pi, box) {
  const out = { bg: '#ffffff', fg: '#000000' };
  const pg = S.pages[pi];
  const c = pg.el?.querySelector('canvas');
  if (!c || !c.width) return out;
  try {
    const k = c.width / pg.w;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const x = clamp(Math.floor(box.x * k), 0, c.width - 1), y = clamp(Math.floor(box.y * k), 0, c.height - 1);
    const w = clamp(Math.ceil(box.w * k), 1, c.width - x), hh = clamp(Math.ceil(box.h * k), 1, c.height - y);
    const d = ctx.getImageData(x, y, w, hh).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) { const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); counts.set(key, (counts.get(key) || 0) + 1); }
    const bk = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // promedio real de los píxeles del color de fondo dominante
    let br = 0, bgc = 0, bb = 0, bn = 0;
    for (let i = 0; i < d.length; i += 4) if ((((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)) === bk) { br += d[i]; bgc += d[i + 1]; bb += d[i + 2]; bn++; }
    const bg = [br / bn, bgc / bn, bb / bn];
    let maxd = 0;
    const dist = (i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    for (let i = 0; i < d.length; i += 4) maxd = Math.max(maxd, dist(i));
    const hex = (a) => '#' + a.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    out.bg = hex(bg);
    if (maxd > 60) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (dist(i) >= 0.75 * maxd) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      let fg = [r / n, g / n, b / n];
      // casi negro o casi gris neutro -> valor limpio
      if (Math.max(...fg) < 45) fg = [0, 0, 0];
      out.fg = hex(fg);
    }
  } catch { /* lienzo no disponible */ }
  return out;
}
function fdFromItem(it) {
  if (it.h) {
    const inf = it.h.info;
    return { family: inf.family, name: inf.name, bold: inf.bold || !!it.fakeBold, italic: inf.italic, cat: inf.cat, pdf: it.h.usable && !it.fakeBold ? it.h.base : null, ext: null };
  }
  const cat = it.generic === 'serif' ? 'serif' : it.generic === 'monospace' ? 'mono' : 'sans';
  return { ...stdFd(CAT_STD[cat]), bold: !!it.fakeBold };
}
// Fragmentos de estilo para una línea del PDF, calibrados para reproducir las posiciones originales
function runsFromLine(pi, line, { para = false } = {}) {
  const runs = [];
  line.forEach((it, j) => {
    const blank = !it.str.trim();
    const prev = runs[runs.length - 1];
    const run = { t: it.str, fd: fdFromItem(it), s: r2(it.fs), c: blank && prev ? prev.c : sampleInk(pi, itemBox(it)).fg, hs: Math.abs(it.hs - 1) < 0.01 ? 1 : Math.round(it.hs * 1000) / 1000, cs: 0, ws: 0, kern: 0 };
    if (blank && prev) run.fd = clone(prev.fd);
    const nat = measureRun(pi, { ...run, cs: 0, ws: 0 });
    const n = [...run.t].length;
    const spaces = (run.t.match(/ /g) || []).length;
    const extra = it.w - nat;
    // el ancho extra va a los espacios (texto justificado) o se reparte entre las letras (interletrado)
    if (spaces && (spaces === n || (Math.abs(extra) > 0.1 * it.fs && !para))) run.ws = Math.round((extra / spaces) * 1000) / 1000;
    else run.cs = Math.round((extra / Math.max(1, n)) * 1000) / 1000;
    if (Math.abs(run.cs) > it.fs * 0.3) run.cs = 0;
    const next = line[j + 1];
    if (next) {
      const g = next.x - (it.x + it.w);
      if (g > 0.18 * it.fs && !/\s$/.test(run.t) && !/^\s/.test(next.str)) {
        run.t += ' ';
        if (!para) run.kern = r2(g - (spaceWidth(pi, run.fd, run.s) * run.hs + run.ws + run.cs));
      } else if (!para) run.kern = r2(g);
    }
    runs.push(run);
  });
  return mergeRuns(runs);
}
function measureRun(pi, run) {
  let w = 0;
  for (const p of run.t.split(/( +)/)) {
    if (!p) continue;
    if (p[0] === ' ') w += p.length * (spaceWidth(pi, run.fd, run.s) * (run.hs || 1) + (run.ws || 0) + (run.cs || 0));
    else w += measureWith(resolveFont(pi, run.fd, p), p, run.s) * (run.hs || 1) + (run.cs || 0) * [...p].length;
  }
  return w;
}
function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !last.kern && sameStyle(last, r)) { last.t += r.t; last.kern = r.kern || 0; }
    else out.push({ ...r });
  }
  const nonEmpty = out.filter((r) => r.t !== '');
  return nonEmpty.length ? nonEmpty : out.slice(0, 1).map((r) => ({ ...r, t: '' }));
}

/* ---------- herramienta "Editar texto" ---------- */
async function editTextAt(pi, x, y, { paragraph = false, clientX, clientY } = {}) {
  // ¿ya hay un texto editable en ese punto?
  const existing = [...S.objects[pi]].reverse().find((o) => o.type === 'text' && x >= o.x - 2 && x <= o.x + o.w + 2 && y >= o.y - 2 && y <= o.y + o.h + 2);
  if (existing) { startTextEdit(existing, { clientX, clientY }); return; }
  const lfp = requestLocalFonts();
  const items = await pageItems(pi);
  const it = hitItem(items, x, y);
  if (!it) { toast('No hay texto del documento en ese lugar. Usá "Añadir texto" para escribir texto nuevo.'); return; }
  const seedLine = lineOf(items, it);
  const lines = paragraph ? paragraphOf(items, seedLine) : [seedLine];
  const o = buildEditObject(pi, lines, paragraph && lines.length > 1);
  await prepareFonts(o);
  addObject(pi, o);
  startTextEdit(o, { clientX, clientY });
  // si el acceso a las fuentes instaladas llega después, se usan para las letras que falten
  if (!S.localFonts) lfp?.then(async (list) => { if (!list) return; await prepareFonts(o); if (!(editing && editing.o === o)) changed(o); syncBar(); });
}
function buildEditObject(pi, lines, paragraph) {
  const first = lines[0], last = lines[lines.length - 1];
  const regions = lines.map(lineBox);
  const bgs = regions.map((r) => sampleInk(pi, r).bg);
  const asc = Math.max(...first.map((i) => i.asc * i.fs));
  const desc = Math.max(...last.map((i) => i.desc * i.fs));
  const fs0 = lineFs(first);
  const o = { type: 'text', edit: true, regions, coverColor: bgs[0], asc, desc, lh: r2(fs0 * 1.2), align: 'left', runs: [] };
  if (!paragraph) {
    o.nowrap = true;
    o.x = lineLeft(first);
    o.y = lineBase(first) - asc;
    o.runs = runsFromLine(pi, first);
    return o;
  }
  const left = Math.min(...lines.map(lineLeft)), right = Math.max(...lines.map(lineRight));
  o.nowrap = false;
  o.x = left; o.y = lineBase(first) - asc; o.w = right - left + 0.6;
  o.indent = r2(lineLeft(first) - left);
  o.lh = r2((lineBase(last) - lineBase(first)) / Math.max(1, lines.length - 1));
  const lefts = lines.map(lineLeft), rights = lines.map(lineRight);
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const mids = lines.map((l) => (lineLeft(l) + lineRight(l)) / 2);
  if (lines.length > 1 && spread(rights.slice(0, -1)) < 2 && spread(lefts.slice(1)) < 2) o.align = 'justify';
  else if (spread(rights) < 2 && spread(lefts) > 4) o.align = 'right';
  else if (spread(mids) < 2 && spread(lefts) > 4) o.align = 'center';
  if (o.align !== 'left' && o.align !== 'justify') o.indent = 0;
  let runs = [];
  lines.forEach((ln, k) => {
    const lr = runsFromLine(pi, ln, { para: true });
    if (k < lines.length - 1) {
      const lastRun = lr[lr.length - 1];
      const nextFirst = lines[k + 1][0].str;
      if (/[A-Za-zÀ-ÿ]-$/.test(lastRun.t) && /^[a-zà-ÿ]/.test(nextFirst)) lastRun.t = lastRun.t.slice(0, -1);
      else if (!/\s$/.test(lastRun.t)) lastRun.t += ' ';
    }
    runs.push(...lr);
  });
  runs.forEach((r) => { r.kern = 0; r.ws = 0; });
  o.runs = mergeRuns(runs);
  return o;
}
// carga la misma fuente instalada en el equipo (si hay permiso) para los caracteres que falten
async function prepareFonts(o) {
  if (!S.localFonts) return;
  const seen = new Set();
  for (const r of o.runs) {
    const k = r.fd.family + r.fd.bold + r.fd.italic;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!matchExtFont(r.fd)) await loadLocalMatch(r.fd);
  }
}
// resaltado de la línea bajo el cursor
let hoverBox = null;
async function edittextHover(pi, e) {
  const items = S.lineModels[pi] || (pageItems(pi), null);
  hoverBox?.remove(); hoverBox = null;
  if (!items || editing) return;
  const [x, y] = pagePoint(pi, e);
  if (S.objects[pi].some((o) => o.type === 'text' && x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h)) return;
  const it = hitItem(items, x, y);
  if (!it) return;
  const lines = e.shiftKey ? paragraphOf(items, lineOf(items, it)) : [lineOf(items, it)];
  const b = lines.map(lineBox).reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), x2: Math.max(a.x2, r.x + r.w), y2: Math.max(a.y2, r.y + r.h) }), { x: 1e9, y: 1e9, x2: -1e9, y2: -1e9 });
  hoverBox = h('div', { class: 'edit-hover', style: { left: px(b.x), top: px(b.y), width: px(b.x2 - b.x), height: px(b.y2 - b.y) } });
  S.pages[pi].el.querySelector('.ov').append(hoverBox);
}

/* ---------- editor en pantalla ---------- */
let editing = null;
function edLines(ed) {
  const lines = [];
  let loose = null;
  for (const n of [...ed.childNodes]) {
    if (n.nodeType === 1 && n.tagName === 'DIV') { loose = null; lines.push(n); }
    else { if (!loose) { loose = []; lines.push(loose); } loose.push(n); }
  }
  return lines;
}
// recorre el contenido del editor en orden: [{node, start}] con '\n' entre líneas
function edMap(ed) {
  const items = [];
  let pos = 0;
  edLines(ed).forEach((ln, li) => {
    if (li) pos += 1;
    const roots = Array.isArray(ln) ? ln : [ln];
    for (const r of roots) {
      const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n = r.nodeType === 3 ? r : tw.currentNode;
      const visit = (node) => {
        if (node.nodeType === 3) { items.push({ node, start: pos }); pos += node.data.length; }
        else if (node.tagName === 'BR' && node.nextSibling) { items.push({ node, start: pos, br: true }); pos += 1; }
      };
      if (r.nodeType === 3) visit(r);
      else while ((n = tw.nextNode())) visit(n);
    }
  });
  return { items, total: pos };
}
function edReadRuns(ed, o) {
  const src = o.runs;
  const out = [];
  let lastStyle = styleOf(src[0] || { fd: stdFd(), s: 14, c: '#000' });
  let lastRi = -1;
  const push = (t, ri) => {
    const st = ri >= 0 && src[ri] ? styleOf(src[ri]) : lastStyle;
    const prev = out[out.length - 1];
    if (prev && prev.ri === ri && sameStyle(prev, st)) prev.t += t;
    else out.push({ ...st, t, ri });
    lastStyle = st; lastRi = ri;
  };
  edLines(ed).forEach((ln, li) => {
    if (li) push('\n', lastRi);
    const roots = Array.isArray(ln) ? ln : [ln];
    for (const r of roots) {
      const nodes = [];
      if (r.nodeType === 3) nodes.push(r);
      else if (r.nodeType === 1) { const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n; while ((n = tw.nextNode())) nodes.push(n); }
      for (const n of nodes) {
        if (n.nodeType === 3) { const sp = n.parentElement?.closest('[data-ri]'); push(n.data.replace(/ /g, ' '), sp ? +sp.dataset.ri : lastRi); }
        else if (n.tagName === 'BR' && n.nextSibling) push('\n', lastRi);
      }
    }
  });
  // conserva el ajuste final de cada fragmento original
  const lastIdx = new Map();
  out.forEach((r, i) => { if (r.ri >= 0) lastIdx.set(r.ri, i); });
  for (const [ri, i] of lastIdx) if (src[ri]?.kern) out[i].kern = src[ri].kern;
  out.forEach((r) => delete r.ri);
  return mergeRuns(out.length ? out : [{ ...lastStyle, t: '' }]);
}
function runCss(r, s) {
  return {
    fontFamily: cssFamily(r.fd), fontWeight: r.fd.bold ? 700 : 400, fontStyle: r.fd.italic ? 'italic' : 'normal', fontSize: r.s * s + 'px', color: r.c,
    letterSpacing: (r.cs || 0) * s + 'px', wordSpacing: (r.ws || 0) * s + 'px',
  };
}
function edRender(ed, o) {
  const s = S.scale;
  ed.innerHTML = '';
  let line = h('div', { class: 'ln' });
  ed.append(line);
  o.runs.forEach((r, ri) => {
    const parts = r.t.split('\n');
    parts.forEach((p, k) => {
      if (k > 0) { if (!line.childNodes.length) line.append(h('br')); line = h('div', { class: 'ln' }); ed.append(line); }
      if (p) {
        const sp = h('span', { 'data-ri': ri, style: runCss(r, s) }, p);
        if (r.kern && k === parts.length - 1) sp.style.marginRight = r.kern * s + 'px';
        line.append(sp);
      }
    });
  });
  if (!line.childNodes.length) line.append(h('br'));
  for (const ln of ed.children) Object.assign(ln.style, { lineHeight: o.lh * s + 'px', minHeight: o.lh * s + 'px' });
  if (!o.nowrap && o.indent) ed.firstChild.style.textIndent = o.indent * s + 'px';
}
function edAlign(ed, o) {
  const s = S.scale;
  const first = ed.firstChild;
  const mk = h('span', { style: { display: 'inline-block', width: '0', height: '0' } });
  first.prepend(mk);
  const off = mk.getBoundingClientRect().bottom - ed.getBoundingClientRect().top;
  mk.remove();
  ed.style.top = (o.y + o.asc) * s - off + 'px';
}
function edGetOffsets(ed) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!ed.contains(r.startContainer)) return null;
  const { items, total } = edMap(ed);
  const toOff = (node, off) => {
    if (node.nodeType === 3) { const it = items.find((x) => x.node === node); return it ? it.start + off : total; }
    // contenedor de elementos: posición del siguiente nodo de texto
    const child = node.childNodes[off];
    if (!child) { const tail = [...items].reverse().find((x) => node.contains(x.node)); return tail ? tail.start + (tail.br ? 1 : tail.node.data.length) : (node === ed ? total : (items.find((x) => node.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_FOLLOWING)?.start ?? total)); }
    const it = items.find((x) => child === x.node || child.contains?.(x.node) || (child.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_FOLLOWING));
    return it ? it.start : total;
  };
  const a = toOff(r.startContainer, r.startOffset), b = toOff(r.endContainer, r.endOffset);
  return [Math.min(a, b), Math.max(a, b)];
}
function edSetSelection(ed, a, b) {
  const { items } = edMap(ed);
  const loc = (pos) => {
    for (const it of items) { if (it.br) continue; if (pos <= it.start + it.node.data.length && pos >= it.start) return [it.node, pos - it.start]; }
    const last = items.filter((x) => !x.br).pop();
    return last ? [last.node, last.node.data.length] : [ed, 0];
  };
  const r = document.createRange();
  const [n1, o1] = loc(a), [n2, o2] = loc(b);
  r.setStart(n1, o1); r.setEnd(n2, o2);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
// aplica un cambio de estilo a un rango de caracteres (o a todo si el rango está vacío)
function styleRange(runs, a, b, fn) {
  const chars = [];
  runs.forEach((r) => { const arr = [...r.t]; arr.forEach((ch, i) => chars.push({ ch, st: styleOf(r), kern: i === arr.length - 1 ? r.kern || 0 : 0 })); if (!arr.length) chars.push({ ch: '', st: styleOf(r), kern: 0 }); });
  const all = a === b;
  let pos = 0;
  for (const c of chars) { const len = c.ch.length; if (all || (pos >= a && pos < b)) c.st = fn(c.st) || c.st; pos += len; }
  const out = [];
  for (const c of chars) {
    const last = out[out.length - 1];
    if (last && !last.kern && sameStyle(last, c.st)) { last.t += c.ch; last.kern = c.kern; }
    else out.push({ ...c.st, t: c.ch, kern: c.kern });
  }
  return mergeRuns(out);
}
function styleAt(o, pos) {
  let p = 0;
  for (const r of o.runs) { const n = r.t.length; if (pos <= p + n && n) return r; p += n; }
  return o.runs[o.runs.length - 1];
}
// variante negrita/cursiva de una fuente: busca primero en las fuentes del documento
function variantFd(fd, patch) {
  const want = { ...fd, ...patch };
  if (want.bold === fd.bold && want.italic === fd.italic && !('family' in patch)) return want;
  const fam = famKey(want.family);
  for (const hnd of S.pdfFontsAll.values()) {
    if (hnd.usable && (famKey(hnd.info.family) === fam || famKey(hnd.info.name) === famKey(want.name)) && hnd.info.bold === !!want.bold && hnd.info.italic === !!want.italic) return { ...want, pdf: hnd.base, ext: null };
  }
  const e = matchExtFont({ ...want, ext: null });
  return { ...want, pdf: null, ext: e ? e.key : null };
}

function startTextEdit(o, { clientX, clientY } = {}) {
  ensureRuns(o);
  if (editing) finishTextEdit();
  if (S.tool !== 'select' && S.tool !== 'edittext') setTool('select');
  hoverBox?.remove(); hoverBox = null;
  S.sel = o;
  renderOverlay(o.page);
  renderProps();
  const pg = S.pages[o.page];
  const ov = pg.el.querySelector('.ov');
  const el = ov.querySelector(`.obj[data-id="${o.id}"]`);
  el?.classList.add('editing');
  $$('.handle', ov).forEach((x) => x.remove());
  const s = S.scale;
  const ed = h('div', { class: 'tx-editor', contenteditable: 'true', spellcheck: 'false', style: {
    left: o.x * s + 'px', width: o.nowrap ? 'max-content' : o.w * s + 'px', minWidth: '6px', whiteSpace: o.nowrap ? 'pre' : 'pre-wrap',
    textAlign: o.align === 'justify' ? 'justify' : o.align || 'left', textAlignLast: o.align === 'justify' ? 'left' : 'auto',
  } });
  edRender(ed, o);
  ov.append(ed);
  edAlign(ed, o);
  const bar = buildEditBar(o, ed);
  pg.el.append(bar);
  positionBar(bar, ed, pg);
  const before = JSON.stringify(o.runs);
  editing = { o, ed, bar, before, saved: null };
  ed.focus();
  let placed = false;
  if (clientX != null) {
    const pos = document.caretPositionFromPoint?.(clientX, clientY);
    const rng = pos ? (() => { const r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); return r; })() : document.caretRangeFromPoint?.(clientX, clientY);
    if (rng && ed.contains(rng.startContainer)) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rng); placed = true; }
  }
  if (!placed) {
    const r = document.createRange(); r.selectNodeContents(ed);
    if (textOf(o)) r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  ed.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); finishTextEdit(); }
    if (ev.key === 'Tab') { ev.preventDefault(); document.execCommand('insertText', false, '    '); }
    if ((ev.ctrlKey || ev.metaKey) && ['b', 'i'].includes(ev.key.toLowerCase())) { ev.preventDefault(); bar.querySelector(ev.key.toLowerCase() === 'b' ? '[data-a=bold]' : '[data-a=italic]').click(); }
  });
  ed.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, (ev.clipboardData.getData('text/plain') || '').replace(/\r/g, '')); });
  ed.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  ed.addEventListener('blur', () => setTimeout(() => {
    if (!editing || editing.ed !== ed) return;
    const a = document.activeElement;
    if (a && (ed.contains(a) || bar.contains(a))) return;
    finishTextEdit();
  }, 0));
  document.addEventListener('selectionchange', onEdSelection);
}
function onEdSelection() {
  if (!editing) return;
  const off = edGetOffsets(editing.ed);
  if (off) { editing.saved = off; syncBar(); }
}
function positionBar(bar, ed, pg) {
  const er = ed.getBoundingClientRect(), pr = pg.el.getBoundingClientRect();
  let top = er.top - pr.top - bar.offsetHeight - 8;
  if (top < 0) top = er.bottom - pr.top + 8;
  bar.style.top = top + 'px';
  bar.style.left = clamp(er.left - pr.left, 0, Math.max(0, pr.width - bar.offsetWidth)) + 'px';
}
// lee el editor, aplica un cambio de estilo y vuelve a dibujarlo conservando la selección
function edApply(fn) {
  const ed0 = editing; if (!ed0) return;
  const { o, ed } = ed0;
  o.runs = edReadRuns(ed, o);
  const [a, b] = ed0.saved || edGetOffsets(ed) || [0, 0];
  o.runs = styleRange(o.runs, a, b, fn);
  edRender(ed, o);
  ed.style.width = o.nowrap ? 'max-content' : o.w * S.scale + 'px';
  edAlign(ed, o);
  ed.focus();
  edSetSelection(ed, a, b);
  ed0.saved = [a, b];
  syncBar();
  positionBar(ed0.bar, ed, S.pages[o.page]);
}
function buildEditBar(o, ed) {
  const keep = (e) => e.preventDefault(); // los botones no le quitan el foco al editor
  const fontSel = h('select', { title: 'Fuente', class: 'fsel' });
  const fillFonts = () => {
    fontSel.innerHTML = '';
    const groups = {};
    for (const c of fontChoices(o.page)) (groups[c.group] ||= []).push(c);
    for (const [g, list] of Object.entries(groups)) fontSel.append(h('optgroup', { label: g }, ...list.map((c) => h('option', { value: JSON.stringify(c.fd) }, c.label))));
    fontSel.append(h('optgroup', { label: 'Más' }, h('option', { value: '__upload' }, 'Cargar fuente desde archivo…'), canQueryLocalFonts() && !S.localFonts ? h('option', { value: '__local' }, 'Usar fuentes instaladas en el equipo…') : null));
  };
  fillFonts();
  const size = h('input', { type: 'number', min: 2, max: 400, step: 0.5, title: 'Tamaño', class: 'fsize' });
  const color = h('input', { type: 'color', title: 'Color' });
  const btn = (a, label, title, style = {}) => h('button', { class: 'toggle', 'data-a': a, title, style, onmousedown: keep }, label);
  const bold = btn('bold', 'N', 'Negrita (Ctrl B)'), ital = btn('italic', 'C', 'Cursiva (Ctrl I)', { fontStyle: 'italic' });
  const align = h('select', { title: 'Alineación' }, ...[['left', 'Izq.'], ['center', 'Centro'], ['right', 'Der.'], ['justify', 'Justif.']].map(([v, l]) => h('option', { value: v }, l)));
  align.value = o.align || 'left';
  const info = h('span', { class: 'fx-info' });
  const bar = h('div', { class: 'tx-toolbar' }, fontSel, size, bold, ital, color, o.nowrap ? null : align,
    o.edit && o.nowrap ? h('button', { class: 'btn small', title: 'Editar el párrafo completo (el texto se reacomoda al escribir)', onmousedown: keep, onclick: () => expandToParagraph() }, '¶ Párrafo') : null,
    h('button', { class: 'btn small primary', onmousedown: keep, onclick: () => finishTextEdit() }, 'Listo'), info);
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') finishTextEdit(); });
  const saveSel = () => { const off = edGetOffsets(ed); if (off) editing.saved = off; };
  for (const c of [fontSel, size, color, align]) c.addEventListener('pointerdown', saveSel);
  fontSel.addEventListener('change', async () => {
    const v = fontSel.value;
    if (v === '__upload') { await uploadFonts(); fillFonts(); syncBar(); ed.focus(); return; }
    if (v === '__local') { await requestLocalFonts(); if (S.localFonts) { await prepareFonts(o); toast('Acceso a las fuentes instaladas concedido', 'ok'); } fillFonts(); syncBar(); ed.focus(); return; }
    const fd = JSON.parse(v);
    if (S.localFonts && !fd.pdf && !fd.ext) { const e = await loadLocalMatch(fd); if (e) fd.ext = e.key; }
    edApply((st) => ({ ...st, fd }));
  });
  size.addEventListener('change', () => { const v = parseFloat(size.value); if (v > 0) edApply((st) => ({ ...st, s: v })); });
  color.addEventListener('input', () => edApply((st) => ({ ...st, c: color.value })));
  bold.addEventListener('click', () => { const on = !bold.classList.contains('on'); edApply((st) => ({ ...st, fd: variantFd(st.fd, { bold: on }) })); });
  ital.addEventListener('click', () => { const on = !ital.classList.contains('on'); edApply((st) => ({ ...st, fd: variantFd(st.fd, { italic: on }) })); });
  align.addEventListener('change', () => { o.align = align.value; editing.ed.style.textAlign = align.value; editing.ed.style.textAlignLast = align.value === 'justify' ? 'left' : 'auto'; editing.ed.focus(); });
  bar._sync = () => {
    const off = editing?.saved || [0, 0];
    const r = styleAt(o, off[0] === off[1] ? Math.max(0, off[0]) : off[0] + 1);
    if (!r) return;
    const cur = JSON.stringify(r.fd);
    if (![...fontSel.options].some((op) => op.value === cur)) fontSel.append(h('option', { value: cur }, fdLabel(r.fd)));
    fontSel.value = cur;
    size.value = r.s;
    color.value = /^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#000000';
    bold.classList.toggle('on', !!r.fd.bold);
    ital.classList.toggle('on', !!r.fd.italic);
    // aviso si la fuente original no tiene todos los caracteres
    const h0 = r.fd.pdf && pdfFontFor(o.page, r.fd.pdf);
    info.textContent = r.fd.pdf ? (h0 ? (h0.embedded ? 'Fuente original del PDF' : 'Fuente original (no incrustada)') : '') : r.fd.ext ? 'Fuente ' + (S.extFonts.get(r.fd.ext)?.source === 'local' ? 'instalada' : 'cargada') : 'Fuente estándar similar';
  };
  return bar;
}
function syncBar() { editing?.bar?._sync?.(); }
async function expandToParagraph() {
  if (!editing) return;
  const { o } = editing;
  const runsNow = edReadRuns(editing.ed, o);
  const pi = o.page;
  const items = await pageItems(pi);
  const seed = items.find((it) => it.horiz && Math.abs(it.base - (o.y + o.asc)) < 1 && it.x >= o.regions[0].x - 1 && it.x <= o.regions[0].x + o.regions[0].w);
  if (!seed) return;
  const lines = paragraphOf(items, lineOf(items, seed));
  if (lines.length < 2) { toast('Esta línea no forma parte de un párrafo de varias líneas'); return; }
  const p = buildEditObject(pi, lines, true);
  // reemplaza la línea editada por su versión actual dentro del párrafo
  const k = lines.findIndex((ln) => ln.includes(seed));
  const lineRuns = lines.map((ln, j) => (j === k ? runsNow.map((r) => ({ ...r, kern: 0, ws: 0 })) : runsFromLine(pi, ln, { para: true })));
  let runs = [];
  lineRuns.forEach((lr, j) => {
    if (j < lineRuns.length - 1 && lr.length) { const last = lr[lr.length - 1]; if (!/\s$/.test(last.t)) last.t += ' '; }
    runs.push(...lr);
  });
  runs.forEach((r) => { r.kern = 0; r.ws = 0; });
  p.runs = mergeRuns(runs);
  // reemplaza también otros objetos de edición que cubrían líneas del párrafo
  editing.ed.remove(); editing.bar.remove();
  document.removeEventListener('selectionchange', onEdSelection);
  editing = null;
  pushUndo();
  const arr = S.objects[pi];
  arr.splice(arr.indexOf(o), 1);
  p.id = uid(); p.page = pi;
  arr.push(p);
  renderOverlay(pi);
  startTextEdit(p);
}
function finishTextEdit() {
  if (!editing) return;
  const { o, ed, bar, before } = editing;
  const runs = edReadRuns(ed, o);
  editing = null;
  document.removeEventListener('selectionchange', onEdSelection);
  ed.remove(); bar.remove();
  const after = JSON.stringify(runs);
  if (after !== before) {
    // deshacer debe volver al estado previo a la edición
    const cur = o.runs;
    o.runs = JSON.parse(before);
    pushUndo();
    o.runs = runs;
    void cur;
  }
  if (!o.edit && !textOf(o).trim()) { removeObject(o, { undoable: false }); return; }
  layoutText(o);
  changed(o);
  renderProps();
}

/* ---------- panel de propiedades para texto ---------- */
function textPropsPanel(p, o) {
  ensureRuns(o);
  const r = o.runs[0];
  const all = (fn) => { pushUndo(); o.runs = styleRange(o.runs, 0, 0, fn); changed(o); renderProps(); };
  const sel = h('select', {});
  const groups = {};
  for (const c of fontChoices(o.page)) (groups[c.group] ||= []).push(c);
  for (const [g, list] of Object.entries(groups)) sel.append(h('optgroup', { label: g }, ...list.map((c) => h('option', { value: JSON.stringify(c.fd) }, c.label))));
  const cur = JSON.stringify(r.fd);
  if (![...sel.options].some((x) => x.value === cur)) sel.prepend(h('option', { value: cur }, fdLabel(r.fd)));
  sel.value = cur;
  sel.addEventListener('change', () => { const fd = JSON.parse(sel.value); all((st) => ({ ...st, fd })); });
  p.append(h('button', { class: 'btn small primary', style: { marginBottom: '10px' }, onclick: () => startTextEdit(o) }, icon('edit'), 'Editar texto'));
  p.append(propRow('Fuente', sel));
  p.append(propRow('Tamaño', numInput(r.s, (v) => all((st) => ({ ...st, s: v })), { min: 2, max: 400, step: 0.5 })));
  p.append(propRow('Color', colorPicker(r.c, (v) => all((st) => ({ ...st, c: v })))));
  p.append(propRow('Estilo', h('div', { class: 'prop-row' },
    toggleBtn('N', !!r.fd.bold, (v) => all((st) => ({ ...st, fd: variantFd(st.fd, { bold: v }) })), 'Negrita'),
    h('span', { style: { fontStyle: 'italic' } }, toggleBtn('C', !!r.fd.italic, (v) => all((st) => ({ ...st, fd: variantFd(st.fd, { italic: v }) })), 'Cursiva')))));
  if (!o.nowrap || o.runs.some((x) => x.t.includes('\n'))) {
    const al = h('select', {}, ...[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha'], ['justify', 'Justificado']].map(([v, l]) => h('option', { value: v, selected: v === (o.align || 'left') }, l)));
    al.addEventListener('change', () => { pushUndo(); o.align = al.value; changed(o); });
    p.append(propRow('Alineación', al));
    p.append(propRow('Interlineado', numInput(o.lh, (v) => { pushUndo(); o.lh = v; changed(o); }, { min: 1, max: 400, step: 0.5 })));
  }
  p.append(propRow('Fondo', colorPicker(o.bg || null, (v) => { pushUndo(); o.bg = v; changed(o); }, { allowNone: true })));
  p.append(propRow('Opacidad', rangeInput(o.opacity ?? 1, (v) => { o.opacity = v; changed(o); }, { min: 0.05, max: 1 })));
  if (o.edit) p.append(propRow('Fondo tapado', colorPicker(o.coverColor || '#ffffff', (v) => { pushUndo(); o.coverColor = v; changed(o); })));
  // resumen de fuentes usadas
  const L = layoutText(o);
  const used = new Map();
  for (const ln of L.lines) for (const sg of ln.segs) {
    const k = sg.rf.kind === 'pdf' ? 'Original del PDF: ' + cleanFontName(sg.rf.h.base) : sg.rf.kind === 'ext' ? 'Instalada/cargada: ' + sg.rf.e.key : 'Estándar similar: ' + sg.rf.name.replace(/([a-z])([A-Z])/g, '$1 $2');
    used.set(k, (used.get(k) || 0) + 1);
  }
  if (used.size) p.append(h('div', { class: 'props-help', style: { margin: '4px 0 10px' } }, h('b', {}, 'Fuentes en uso'), ...[...used.keys()].map((k) => h('div', {}, '• ' + k))));
  const fallback = L.lines.some((ln) => ln.segs.some((sg) => sg.rf.kind === 'std' && sg.run.fd.pdf));
  if (fallback) {
    p.append(h('p', { class: 'props-help' }, 'Algunas letras no están incluidas en la fuente del PDF, así que se escriben con la fuente más parecida disponible. Para usar exactamente la misma fuente, permití el acceso a las fuentes instaladas o cargá el archivo de la fuente.'));
    const row = h('div', { class: 'prop-row', style: { marginBottom: '8px' } });
    if (canQueryLocalFonts() && !S.localFonts) row.append(h('button', { class: 'btn small', onclick: async () => { await requestLocalFonts(); await prepareFonts(o); changed(o); renderProps(); } }, 'Usar fuentes instaladas'));
    row.append(h('button', { class: 'btn small', onclick: async () => { if (await uploadFonts()) { changed(o); renderProps(); } } }, 'Cargar fuente…'));
    p.append(row);
  }
}

/* ---------- escritura en el PDF ---------- */
// Busca en los recursos de la página (y sus formularios XObject) la fuente con ese BaseFont
function findFontRef(doc, page, base) {
  const N = PDFName.of;
  const scan = (res, depth) => {
    if (!(res instanceof PDFDict) || depth > 3) return null;
    const fonts = res.lookup(N('Font'));
    if (fonts instanceof PDFDict) {
      for (const [key, val] of fonts.entries()) {
        const fdict = doc.context.lookup(val);
        if (!(fdict instanceof PDFDict)) continue;
        const bf = fdict.lookup(N('BaseFont'));
        const name = bf ? (bf.decodeText ? bf.decodeText() : bf.asString().replace(/^\//, '')) : '';
        if (name === base) return { key, ref: val instanceof PDFRef ? val : null, direct: depth === 0 };
      }
    }
    const xo = res.lookup(N('XObject'));
    if (xo instanceof PDFDict) for (const [, v] of xo.entries()) { const st = doc.context.lookup(v); const r2_ = st?.dict?.lookup?.(N('Resources')); const f = scan(r2_, depth + 1); if (f) return f; }
    return null;
  };
  let f = scan(page.node.Resources(), 0);
  if (f && f.direct) return f.key;
  if (!f) for (const p of doc.getPages()) { if (p === page) continue; f = scan(p.node.Resources(), 1); if (f) break; }
  if (f && f.ref) return page.node.newFontDictionary('Fo', f.ref);
  return null;
}
async function drawTextObject(doc, page, pi, o, H, cache) {
  const { beginText, endText, setFontAndSize, setTextMatrix, showText, setCharacterSpacing, setCharacterSqueeze, setFillingRgbColor, setGraphicsState } = PDFLib;
  const L = layoutText(o);
  const Y = (y) => H - y;
  if (o.bg) page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.bg), opacity: o.opacity ?? 1 });
  const ops = [pushGraphicsState()];
  const op = o.opacity ?? 1;
  if (op < 1) {
    const gs = page.node.newExtGState('GSt', doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: op, CA: op })));
    ops.push(setGraphicsState(gs));
  }
  for (const ln of L.lines) for (const seg of ln.segs) {
    const run = seg.run;
    let key, hex, hs = run.hs || 1, tc = (run.cs || 0) / hs;
    if (seg.rf.kind === 'pdf') {
      const ck = 'pdf:' + seg.rf.h.base;
      if (!cache.keys.has(ck)) cache.keys.set(ck, findFontRef(doc, page, seg.rf.h.base));
      key = cache.keys.get(ck);
      if (key) {
        const cb = seg.rf.h.codeBytes;
        hex = pdfEncode(seg.rf.h, seg.t).map((code) => code.toString(16).padStart(cb * 2, '0')).join('');
        hex = PDFHexString.of(hex);
      }
    }
    if (!key) {
      let pf;
      if (seg.rf.kind === 'ext') {
        const e = seg.rf.e;
        if (!cache.ext.has(e.key)) { doc.registerFontkit(fontkit); cache.ext.set(e.key, await doc.embedFont(e.bytes, e.ps ? { subset: true, postscriptName: e.ps } : { subset: true })); }
        pf = cache.ext.get(e.key);
        hex = pf.encodeText(seg.t);
      } else {
        const name = seg.rf.kind === 'std' ? seg.rf.name : stdName(run.fd);
        if (!cache.std.has(name)) cache.std.set(name, await doc.embedFont(StandardFonts[name]));
        pf = cache.std.get(name);
        hex = pf.encodeText(winAnsi(seg.t));
        if (seg.rf.kind === 'pdf') { const sw = pf.widthOfTextAtSize(winAnsi(seg.t), run.s); if (sw > 0) hs = seg.w / sw; tc = 0; }
      }
      const fk = 'f:' + pf.name;
      if (!cache.keys.has(fk)) cache.keys.set(fk, page.node.newFontDictionary(pf.name, pf.ref));
      key = cache.keys.get(fk);
    }
    const c = hexToRgb(run.c);
    ops.push(beginText(), setFontAndSize(key, run.s), setFillingRgbColor(c.red, c.green, c.blue));
    ops.push(setCharacterSqueeze(Math.round(hs * 100000) / 1000), setCharacterSpacing(Math.round(tc * 10000) / 10000));
    ops.push(setTextMatrix(1, 0, 0, 1, seg.x, Y(seg.base)), showText(hex), endText());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

/* ---------- eliminación del texto original del contenido de la página ---------- */
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
function tokenizeContent(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) { i++; continue; }
    const st = i;
    if (c === 37) { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; } // comentario
    if (c === 40) { // (cadena)
      let depth = 0, out = '';
      i++;
      while (i < n) {
        const ch = s[i];
        if (ch === '\\') {
          const nx = s[i + 1];
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (nx in map) { out += map[nx]; i += 2; }
          else if (/[0-7]/.test(nx)) { let oct = ''; i++; while (oct.length < 3 && /[0-7]/.test(s[i])) oct += s[i++]; out += String.fromCharCode(parseInt(oct, 8) & 255); }
          else if (nx === '\r') { i += s[i + 2] === '\n' ? 3 : 2; }
          else if (nx === '\n') { i += 2; }
          else { i++; }
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { if (depth === 0) { i++; break; } depth--; }
        out += ch; i++;
      }
      toks.push({ t: 'str', v: out, st, en: i });
      continue;
    }
    if (c === 60 && s[i + 1] === '<') { toks.push({ t: 'dopen', st, en: i + 2 }); i += 2; continue; }
    if (c === 62 && s[i + 1] === '>') { toks.push({ t: 'dclose', st, en: i + 2 }); i += 2; continue; }
    if (c === 60) { // <hex>
      const end = s.indexOf('>', i);
      let hx = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      if (hx.length % 2) hx += '0';
      let out = '';
      for (let k = 0; k < hx.length; k += 2) out += String.fromCharCode(parseInt(hx.slice(k, k + 2), 16));
      toks.push({ t: 'str', v: out, st, en: end + 1 });
      i = end + 1;
      continue;
    }
    if (c === 91) { toks.push({ t: 'aopen', st, en: i + 1 }); i++; continue; }
    if (c === 93) { toks.push({ t: 'aclose', st, en: i + 1 }); i++; continue; }
    if (c === 123 || c === 125) { i++; continue; }
    if (c === 47) { i++; while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++; toks.push({ t: 'name', v: s.slice(st + 1, i), st, en: i }); continue; }
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
    if (i === st) { i++; continue; }
    const word = s.slice(st, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) toks.push({ t: 'num', v: parseFloat(word), st, en: i });
    else if (word === 'true' || word === 'false' || word === 'null') toks.push({ t: 'kw', v: word, st, en: i });
    else {
      toks.push({ t: 'op', v: word, st, en: i });
      if (word === 'BI') { // imagen en línea: saltar los datos binarios
        const m = /\sID[\s]/g; m.lastIndex = i;
        const r = m.exec(s);
        if (!r) break;
        const e2 = /\sEI(?=[\s]|$)/g; e2.lastIndex = r.index + 4;
        const r2x = e2.exec(s);
        i = r2x ? r2x.index + 3 : n;
        toks.push({ t: 'op', v: 'EI', st: r.index, en: i, inline: true });
      }
    }
  }
  return toks;
}
// operaciones: {op, args:[valores], st, en}
function parseOps(toks) {
  const ops = [];
  let stack = [], start = null;
  const parseVal = (k) => {
    const t = toks[k];
    if (t.t === 'aopen') { const arr = []; let j = k + 1; while (j < toks.length && toks[j].t !== 'aclose') { const [v, nj] = parseVal(j); arr.push(v); j = nj; } return [{ arr }, j + 1]; }
    if (t.t === 'dopen') { let j = k + 1, depth = 1; while (j < toks.length && depth) { if (toks[j].t === 'dopen') depth++; if (toks[j].t === 'dclose') depth--; j++; } return [{ dict: true }, j]; }
    return [t, k + 1];
  };
  let k = 0;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'op') { ops.push({ op: t.v, args: stack, st: start ?? t.st, en: t.en }); stack = []; start = null; k++; continue; }
    if (start == null) start = t.st;
    const [v, nk] = parseVal(k);
    stack.push(v);
    k = nk;
  }
  return ops;
}
function fontMetricsFromDict(doc, fdict) {
  const N = PDFName.of;
  const num = (v) => (v && v.asNumber ? v.asNumber() : 0);
  const sub = String(fdict.lookup(N('Subtype')) || '');
  if (sub === '/Type0') {
    const enc = String(fdict.lookup(N('Encoding')) || '');
    if (!/Identity-[HV]/.test(enc)) return null;
    const desc = fdict.lookup(N('DescendantFonts'));
    const cid = desc instanceof PDFArray ? desc.lookup(0) : null;
    if (!(cid instanceof PDFDict)) return null;
    const dw = cid.lookup(N('DW')) ? num(cid.lookup(N('DW'))) : 1000;
    const W = new Map();
    const w = cid.lookup(N('W'));
    if (w instanceof PDFArray) {
      let i = 0;
      while (i < w.size()) {
        const a = num(w.lookup(i)); const b = w.lookup(i + 1);
        if (b instanceof PDFArray) { for (let j = 0; j < b.size(); j++) W.set(a + j, num(b.lookup(j))); i += 2; }
        else { const last = num(b), val = num(w.lookup(i + 2)); for (let c = a; c <= last; c++) W.set(c, val); i += 3; }
      }
    }
    return { bytes: 2, width: (code) => (W.has(code) ? W.get(code) : dw) / 1000 };
  }
  const first = num(fdict.lookup(N('FirstChar')));
  const widths = fdict.lookup(N('Widths'));
  let fm = 0.001;
  if (sub === '/Type3') { const m = fdict.lookup(N('FontMatrix')); fm = m instanceof PDFArray ? num(m.lookup(0)) : 0.001; }
  if (widths instanceof PDFArray) {
    const arr = []; for (let j = 0; j < widths.size(); j++) arr.push(num(widths.lookup(j)));
    let missing = 0;
    const fdesc = fdict.lookup(N('FontDescriptor'));
    if (fdesc instanceof PDFDict && fdesc.lookup(N('MissingWidth'))) missing = num(fdesc.lookup(N('MissingWidth')));
    return { bytes: 1, width: (code) => ((code >= first && code - first < arr.length ? arr[code - first] : missing) * fm) };
  }
  // fuentes estándar sin /Widths
  const bf = String(fdict.lookup(N('BaseFont')) || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
  const std = { Helvetica: 'Helvetica', 'Helvetica-Bold': 'HelveticaBold', 'Helvetica-Oblique': 'HelveticaOblique', 'Helvetica-BoldOblique': 'HelveticaBoldOblique',
    'Times-Roman': 'TimesRoman', 'Times-Bold': 'TimesRomanBold', 'Times-Italic': 'TimesRomanItalic', 'Times-BoldItalic': 'TimesRomanBoldItalic',
    Courier: 'Courier', 'Courier-Bold': 'CourierBold', 'Courier-Oblique': 'CourierOblique', 'Courier-BoldOblique': 'CourierBoldOblique',
    Arial: 'Helvetica', 'Arial,Bold': 'HelveticaBold', 'Arial-BoldMT': 'HelveticaBold', ArialMT: 'Helvetica', TimesNewRoman: 'TimesRoman', 'TimesNewRoman,Bold': 'TimesRomanBold' }[bf];
  if (std) { const emb = stdEmbedder(std); return { bytes: 1, width: (code) => emb.widthOfTextAtSize(String.fromCharCode(code), 1) } }
  return null;
}
// Quita los glifos cuyo centro cae dentro de alguna de las regiones (coordenadas de pantalla a escala 1).
// Devuelve un arreglo con la cantidad de glifos eliminados por región, o null si no se pudo procesar.
function removeOriginalText(doc, page, pi, regions) {
  const N = PDFName.of;
  const ctx = doc.context;
  const contents = page.node.Contents();
  if (!contents) return null;
  const streams = contents instanceof PDFArray ? [...Array(contents.size()).keys()].map((k) => contents.lookup(k)) : [contents];
  let src = '';
  try {
    for (const st of streams) {
      let bytes;
      if (st instanceof PDFRawStream) bytes = PDFLib.decodePDFRawStream(st).decode();
      else if (st?.getUnencodedContents) bytes = st.getUnencodedContents();
      else if (st?.getContents) bytes = st.getContents();
      else return null;
      let chunk = '';
      for (let k = 0; k < bytes.length; k += 8192) chunk += String.fromCharCode.apply(null, bytes.subarray(k, k + 8192));
      src += chunk + '\n';
    }
  } catch (e) { console.warn('contenido no decodificable', e); return null; }
  const ops = parseOps(tokenizeContent(src));
  const vt = S.pages[pi].vt;
  const res = page.node.Resources();
  const fontDict = res?.lookup(N('Font'));
  const metricsCache = new Map();
  const metricsOf = (name) => {
    if (metricsCache.has(name)) return metricsCache.get(name);
    let m = null;
    const f = fontDict instanceof PDFDict ? fontDict.lookup(N(name)) : null;
    if (f instanceof PDFDict) m = fontMetricsFromDict(doc, f);
    metricsCache.set(name, m);
    return m;
  };
  const counts = regions.map(() => 0);
  const inRegion = (x, y) => regions.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  let gs = { ctm: [1, 0, 0, 1, 0, 0], font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
  const edits = [];
  let failed = false;
  const numA = (a) => (a && a.t === 'num' ? a.v : 0);
  const showGlyphs = (strTok) => {
    // devuelve [{code, bytes, removed, adv}] y avanza tm
    const m = metricsOf(gs.font);
    if (!m) { failed = true; return null; }
    const s = strTok.v;
    const out = [];
    for (let k = 0; k + m.bytes <= s.length; k += m.bytes) {
      let code = 0;
      for (let b = 0; b < m.bytes; b++) code = code * 256 + s.charCodeAt(k + b);
      const w0 = m.width(code);
      const tw = m.bytes === 1 && code === 32 ? gs.tw : 0;
      const adv = (w0 * gs.size + gs.tc + tw) * gs.th;
      const trm = M.then(M.then(tm, gs.ctm), vt);
      const [mx, my] = M.apply(trm, (w0 * gs.size * gs.th) / 2, gs.rise);
      const ri = inRegion(mx, my);
      if (ri >= 0) counts[ri]++;
      out.push({ raw: s.substr(k, m.bytes), removed: ri >= 0, w0, tw });
      tm = M.then([1, 0, 0, 1, adv, 0], tm);
    }
    return out;
  };
  const tjFromGlyphs = (parts) => {
    // parts: lista de {glyphs} o {num}
    let outStr = '[';
    let cur = '';
    const flush = () => { if (cur) { outStr += '<' + [...cur].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>'; cur = ''; } };
    for (const p of parts) {
      if (p.num != null) { flush(); outStr += ' ' + p.num + ' '; continue; }
      for (const g of p.glyphs) {
        if (!g.removed) { cur += g.raw; continue; }
        flush();
        const adjust = gs.size ? -((g.w0 * gs.size + gs.tc + g.tw) * 1000) / gs.size : 0;
        outStr += ' ' + adjust.toFixed(3) + ' ';
      }
    }
    flush();
    return outStr + ']';
  };
  for (const o of ops) {
    if (failed) break;
    const a = o.args;
    switch (o.op) {
      case 'q': stack.push({ ...gs }); break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': gs.ctm = M.then(a.map(numA), gs.ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': gs.font = a[0]?.v; gs.size = numA(a[1]); break;
      case 'Tc': gs.tc = numA(a[0]); break;
      case 'Tw': gs.tw = numA(a[0]); break;
      case 'Tz': gs.th = numA(a[0]) / 100; break;
      case 'TL': gs.tl = numA(a[0]); break;
      case 'Ts': gs.rise = numA(a[0]); break;
      case 'Td': tlm = M.then([1, 0, 0, 1, numA(a[0]), numA(a[1])], tlm); tm = tlm; break;
      case 'TD': gs.tl = -numA(a[1]); tlm = M.then([1, 0, 0, 1, numA(a[0]), numA(a[1])], tlm); tm = tlm; break;
      case 'Tm': tlm = a.map(numA); tm = tlm; break;
      case 'T*': tlm = M.then([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
      case 'Tj': case "'": case '"': {
        let prefix = '';
        if (o.op === '"') { gs.tw = numA(a[0]); gs.tc = numA(a[1]); prefix = `${numA(a[0])} Tw ${numA(a[1])} Tc `; }
        if (o.op !== 'Tj') { tlm = M.then([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; prefix += 'T* '; }
        const strTok = a[a.length - 1];
        if (!strTok || strTok.t !== 'str') break;
        const glyphs = showGlyphs(strTok);
        if (glyphs && glyphs.some((g) => g.removed)) edits.push({ st: o.st, en: o.en, text: prefix + tjFromGlyphs([{ glyphs }]) + ' TJ' });
        break;
      }
      case 'TJ': {
        const arr = a[0]?.arr;
        if (!arr) break;
        const parts = [];
        let any = false;
        for (const el of arr) {
          if (el.t === 'num') { tm = M.then([1, 0, 0, 1, (-el.v / 1000) * gs.size * gs.th, 0], tm); parts.push({ num: el.v }); }
          else if (el.t === 'str') { const g = showGlyphs(el); if (!g) break; if (g.some((x) => x.removed)) any = true; parts.push({ glyphs: g }); }
        }
        if (any) edits.push({ st: o.st, en: o.en, text: tjFromGlyphs(parts) + ' TJ' });
        break;
      }
      default: break;
    }
  }
  if (failed) { console.warn('No se pudo interpretar una fuente; se usa el método de cubrir'); return null; }
  if (!edits.length) return counts;
  let out = '', pos = 0;
  for (const e of edits) { out += src.slice(pos, e.st) + e.text; pos = e.en; }
  out += src.slice(pos);
  const bytes = new Uint8Array(out.length);
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 255;
  const ref = ctx.register(ctx.flateStream(bytes));
  page.node.set(N('Contents'), ref);
  return counts;
}
