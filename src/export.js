/* Guardado (aplana las ediciones en el PDF), impresión, conversión, creación, comparación y lectura en voz alta. */
const { rgb, BlendMode, LineCapStyle, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
S.flattenComments = lsGet('ma.flattenComments', false);

function commitTextEditing() { if (editing) finishTextEdit(); $$('.note-pop').forEach((p) => p.querySelector('.btn')?.click()); }

function wrapText(text, font, size, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const trial = line + w;
      if (line && font.widthOfTextAtSize(trial.trimEnd(), size) > maxW + 0.5) {
        out.push(line.trimEnd());
        line = w.trimStart();
        while (line && font.widthOfTextAtSize(line, size) > maxW) { // palabra más larga que el ancho
          let k = line.length; while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > maxW) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      } else line = trial;
    }
    out.push(line.trimEnd());
  }
  return out;
}
function addAnnot(doc, page, dict) {
  const ref = doc.context.register(doc.context.obj(dict));
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  return ref;
}
const pdfDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function colorArr(hex) { const c = hexToRgb(hex || '#000000'); return [c.red, c.green, c.blue]; }
function apStream(doc, bbox, content, resources = {}) {
  const ctx = doc.context;
  const stream = ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: resources });
  return ctx.register(stream);
}
const userPt = (pi, x, y) => M.apply(M.inv(S.pages[pi].vt), x, y);
const f2 = (n) => (Math.round(n * 1000) / 1000).toString();

// Dibuja los objetos de edición dentro de las páginas del documento pdf-lib
async function drawObjectsIntoDoc(doc, { flattenComments = S.flattenComments } = {}) {
  const fonts = {};
  const font = async (fam, bold, italic) => {
    const name = STD_FONT[fam || 'helv'][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!fonts[name]) fonts[name] = await doc.embedFont(StandardFonts[name]);
    return fonts[name];
  };
  const images = {};
  const image = async (src) => {
    if (!images[src]) {
      const im = await normalizeImage(src);
      const bytes = dataURLtoBytes(im.src);
      images[src] = /^data:image\/png/.test(im.src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    }
    return images[src];
  };
  let form = null;
  const getForm = () => (form ||= doc.getForm());
  const pages = doc.getPages();
  await preloadTextFonts();
  const fontCache = { std: new Map(), ext: new Map() };
  for (let pi = 0; pi < S.objects.length; pi++) {
    const list = (S.objects[pi] || []).filter((o) => o.type !== 'redact');
    if (!list.length || !pages[pi]) continue;
    const page = pages[pi];
    const pg = S.pages[pi];
    const H = pg.h;
    const tcache = { ...fontCache, keys: new Map() };
    // texto reemplazado: se elimina del contenido original; si no se puede, se tapa
    const edits = list.filter((o) => o.type === 'text' && o.edit && o.regions?.length);
    let uncovered = [];
    if (edits.length) {
      const regions = edits.flatMap((o) => o.regions.map((r) => ({ ...r, o })));
      let counts = null;
      try { counts = removeOriginalText(doc, page, pi, regions); } catch (e) { console.warn('eliminación de texto', e); }
      uncovered = regions.filter((r, k) => !counts || !counts[k]);
    }
    const Mx = M.then([1, 0, 0, -1, 0, H], M.inv(pg.vt));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...Mx));
    for (const r of uncovered) page.drawRectangle({ x: r.x, y: H - r.y - r.h, width: r.w, height: r.h, color: hexToRgb(r.o.coverColor || '#ffffff') });
    const Y = (y) => H - y;
    const svgOpt = { x: 0, y: H };
    for (const o of list) {
      const op = o.opacity ?? 1;
      const dash = o.dash ? [o.width * 3, o.width * 2] : undefined;
      switch (o.type) {
        case 'rect': {
          const sw = o.stroke ? o.width : 0;
          page.drawRectangle({
            x: o.x + sw / 2, y: Y(o.y + o.h) + sw / 2, width: Math.max(0, o.w - sw), height: Math.max(0, o.h - sw),
            color: o.fill ? hexToRgb(o.fill) : undefined, opacity: op, borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
            borderWidth: sw, borderOpacity: op, borderDashArray: dash, blendMode: o.blend ? BlendMode.Multiply : undefined,
          });
          break;
        }
        case 'ellipse': {
          const sw = o.stroke ? o.width : 0;
          page.drawEllipse({
            x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: Math.max(0.1, (o.w - sw) / 2), yScale: Math.max(0.1, (o.h - sw) / 2),
            color: o.fill ? hexToRgb(o.fill) : undefined, opacity: op, borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
            borderWidth: sw, borderOpacity: op, borderDashArray: dash,
          });
          break;
        }
        case 'line': case 'arrow': case 'measure': {
          const c = hexToRgb(o.stroke);
          page.drawLine({ start: { x: o.x1, y: Y(o.y1) }, end: { x: o.x2, y: Y(o.y2) }, thickness: o.width, color: c, opacity: op, lineCap: LineCapStyle.Round, dashArray: dash });
          if (o.type === 'arrow') {
            const pts = arrowHeadPts(o.x1, o.y1, o.x2, o.y2, o.width);
            page.drawSvgPath(`M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]} L${pts[2][0]} ${pts[2][1]} Z`, { ...svgOpt, color: c, opacity: op, borderWidth: 0 });
          }
          if (o.type === 'measure') {
            const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), t = 6, nx = -Math.sin(ang) * t, ny = Math.cos(ang) * t;
            for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]]) page.drawLine({ start: { x: x + nx, y: Y(y + ny) }, end: { x: x - nx, y: Y(y - ny) }, thickness: o.width, color: c });
            const f = await font('helv');
            const label = winAnsi(measureLabel(o));
            const tw = f.widthOfTextAtSize(label, 10);
            const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2;
            page.drawRectangle({ x: mx - tw / 2 - 2, y: Y(my - 5) - 1, width: tw + 4, height: 10, color: rgb(1, 1, 1), opacity: 0.85 });
            page.drawText(label, { x: mx - tw / 2, y: Y(my - 5) + 1.5, size: 10, font: f, color: c });
          }
          break;
        }
        case 'ink': {
          for (const st of o.strokes) {
            page.drawSvgPath(inkPath(st), { ...svgOpt, borderColor: hexToRgb(o.stroke), borderWidth: o.width, borderOpacity: op, borderLineCap: LineCapStyle.Round, blendMode: o.blend ? BlendMode.Multiply : undefined });
          }
          break;
        }
        case 'text': await drawTextObject(doc, page, pi, o, H, tcache); break;
        case 'image': {
          const img = await image(o.src);
          page.drawImage(img, { x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, opacity: op });
          break;
        }
        case 'stamp': {
          const c = hexToRgb(o.color);
          const bw = Math.max(1.5, o.h * 0.06);
          page.drawRectangle({ x: o.x + bw / 2, y: Y(o.y + o.h) + bw / 2, width: o.w - bw, height: o.h - bw, borderColor: c, borderWidth: bw, borderOpacity: op });
          const f = await font('helv', true);
          const fs = o.sub ? o.h * 0.38 : o.h * 0.5;
          const main = winAnsi(o.text);
          let mw = f.widthOfTextAtSize(main, fs), mfs = fs;
          if (mw > o.w - bw * 3) { mfs = fs * (o.w - bw * 3) / mw; mw = f.widthOfTextAtSize(main, mfs); }
          const subFs = fs * 0.45;
          const block = mfs * 1.05 + (o.sub ? subFs * 1.05 + o.h * 0.04 : 0);
          const top = o.y + (o.h - block) / 2;
          page.drawText(main, { x: o.x + (o.w - mw) / 2, y: Y(top + mfs * 0.87), size: mfs, font: f, color: c, opacity: op });
          if (o.sub) {
            const fsub = await font('helv', true);
            const sub = winAnsi(o.sub);
            const sw2 = fsub.widthOfTextAtSize(sub, subFs);
            page.drawText(sub, { x: o.x + (o.w - sw2) / 2, y: Y(top + mfs * 1.05 + o.h * 0.04 + subFs * 0.87), size: subFs, font: fsub, color: c, opacity: op });
          }
          break;
        }
        case 'mark': {
          const c = hexToRgb(o.stroke);
          const P = (X, Yv) => `${o.x + X / 22 * o.w} ${o.y + Yv / 22 * o.h}`;
          if (o.kind === 'dot') page.drawEllipse({ x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: o.w * 7 / 22, yScale: o.h * 7 / 22, color: c, opacity: op });
          else {
            const d = o.kind === 'check' ? `M${P(2, 11)} L${P(8, 17)} L${P(20, 4)}` : `M${P(3, 3)} L${P(19, 19)} M${P(19, 3)} L${P(3, 19)}`;
            page.drawSvgPath(d, { ...svgOpt, borderColor: c, borderWidth: 2.6 * o.w / 22, borderOpacity: op, borderLineCap: LineCapStyle.Round });
          }
          break;
        }
        case 'markup': {
          if (!flattenComments) break;
          const c = hexToRgb(o.color);
          for (const r of o.rects) {
            if (o.kind === 'highlight') page.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: c, opacity: o.opacity ?? 0.45, blendMode: BlendMode.Multiply });
            else {
              const th = Math.max(1, r.h * 0.08);
              const top = o.kind === 'underline' ? r.y + r.h * 0.86 : r.y + r.h * 0.52;
              page.drawRectangle({ x: r.x, y: Y(top + th / 2), width: r.w, height: th, color: c, opacity: o.opacity ?? 1 });
            }
          }
          break;
        }
        case 'note': {
          if (!flattenComments) break;
          page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.color || '#ffd84d'), borderColor: rgb(0.55, 0.45, 0), borderWidth: 0.8 });
          const f = await font('helv', true);
          page.drawText('i', { x: o.x + o.w / 2 - 1.5, y: Y(o.y + o.h * 0.75), size: o.h * 0.6, font: f, color: rgb(0.35, 0.28, 0) });
          break;
        }
        default: break;
      }
    }
    page.pushOperators(popGraphicsState());

    // anotaciones reales: notas, marcados, enlaces y campos
    for (const o of list) {
      if (o.type === 'note' && !flattenComments) {
        const [x0, y0, w, hh] = boxToUser(pi, objBox(o));
        const col = colorArr(o.color || '#ffd84d');
        const ap = apStream(doc, [0, 0, w, hh], `q ${col.join(' ')} rg 0.55 0.45 0 RG 0.8 w 0.4 0.4 ${f2(w - 0.8)} ${f2(hh - 0.8)} re B 0.35 0.28 0 RG 1.2 w ${f2(w * 0.25)} ${f2(hh * 0.65)} m ${f2(w * 0.75)} ${f2(hh * 0.65)} l ${f2(w * 0.25)} ${f2(hh * 0.45)} m ${f2(w * 0.65)} ${f2(hh * 0.45)} l S Q`);
        addAnnot(doc, page, {
          Type: 'Annot', Subtype: 'Text', Rect: [x0, y0, x0 + w, y0 + hh], Contents: PDFHexString.fromText(o.text || ''), T: PDFHexString.fromText(o.author || S.author),
          Name: 'Comment', C: col, F: 4, M: PDFString.of(pdfDate()), Open: false, AP: { N: ap },
        });
      } else if (o.type === 'markup' && !flattenComments) {
        const sub = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut' }[o.kind];
        const quads = [];
        let content = 'q ';
        const res = {};
        if (o.kind === 'highlight') { res.ExtGState = { GS0: { Type: 'ExtGState', BM: 'Multiply', ca: o.opacity ?? 0.45, CA: o.opacity ?? 0.45 } }; content += '/GS0 gs '; }
        content += colorArr(o.color).join(' ') + ' rg ';
        const all = [];
        for (const r of o.rects) {
          const ul = userPt(pi, r.x, r.y), ur = userPt(pi, r.x + r.w, r.y), ll = userPt(pi, r.x, r.y + r.h), lr = userPt(pi, r.x + r.w, r.y + r.h);
          quads.push(...ul, ...ur, ...ll, ...lr);
          all.push(ul, ur, ll, lr);
          let poly;
          if (o.kind === 'highlight') poly = [ul, ur, lr, ll];
          else {
            const a = o.kind === 'underline' ? 0.82 : 0.48, b = o.kind === 'underline' ? 0.9 : 0.56;
            const pt = (fx, fy) => userPt(pi, r.x + r.w * fx, r.y + r.h * fy);
            poly = [pt(0, a), pt(1, a), pt(1, b), pt(0, b)];
          }
          content += `${f2(poly[0][0])} ${f2(poly[0][1])} m ` + poly.slice(1).map((p) => `${f2(p[0])} ${f2(p[1])} l`).join(' ') + ' h f ';
        }
        content += 'Q';
        const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
        const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        const ap = apStream(doc, rect, content, res);
        addAnnot(doc, page, {
          Type: 'Annot', Subtype: sub, Rect: rect, QuadPoints: quads, C: colorArr(o.color), CA: o.kind === 'highlight' ? (o.opacity ?? 0.45) : 1, F: 4,
          Contents: PDFHexString.fromText(o.comment || ''), T: PDFHexString.fromText(o.author || S.author), M: PDFString.of(pdfDate()), AP: { N: ap },
        });
      } else if (o.type === 'link' && (o.url || o.dest != null)) {
        const [x0, y0, w, hh] = boxToUser(pi, o);
        const d = { Type: 'Annot', Subtype: 'Link', Rect: [x0, y0, x0 + w, y0 + hh], Border: [0, 0, 0], F: 4 };
        if (o.url) d.A = { Type: 'Action', S: 'URI', URI: PDFString.of(/^[a-z]+:/i.test(o.url) ? o.url : 'https://' + o.url) };
        else if (pages[o.dest]) d.Dest = [pages[o.dest].ref, 'Fit'];
        addAnnot(doc, page, d);
      } else if (o.type === 'field') {
        const [x, y, width, height] = boxToUser(pi, o);
        const f = getForm();
        const opts = { x, y, width, height, rotate: degrees(pg.rot || 0), borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 1, backgroundColor: rgb(1, 1, 1) };
        const uniq = (n) => { let k = n, i = 2; const names = new Set(f.getFields().map((x) => x.getName())); while (names.has(k)) k = n + '_' + i++; return k; };
        try {
          let fld;
          if (o.ftype === 'text') {
            fld = f.createTextField(uniq(o.name));
            if (o.multiline) fld.enableMultiline();
            if (o.value) fld.setText(winAnsi(o.value));
            fld.addToPage(page, opts);
            if (o.fontSize) fld.setFontSize(o.fontSize);
          } else if (o.ftype === 'check') { fld = f.createCheckBox(uniq(o.name)); fld.addToPage(page, opts); }
          else if (o.ftype === 'radio') {
            let grp;
            try { grp = f.getRadioGroup(o.name); } catch { grp = f.createRadioGroup(o.name); }
            grp.addOptionToPage(winAnsi(o.value || ('Opcion' + uid())), page, opts);
            fld = grp;
          } else if (o.ftype === 'dropdown') { fld = f.createDropdown(uniq(o.name)); fld.setOptions((o.options || []).map(winAnsi)); fld.addToPage(page, opts); }
          else if (o.ftype === 'list') { fld = f.createOptionList(uniq(o.name)); fld.setOptions((o.options || []).map(winAnsi)); fld.addToPage(page, opts); }
          if (o.required && fld) fld.enableRequired();
        } catch (e) { console.warn('campo', e); toast('No se pudo crear el campo "' + o.name + '": ' + e.message, 'err'); }
      }
    }
  }
  if (form) { try { form.updateFieldAppearances(await font('helv')); } catch (e) { console.warn(e); } }
}

// Escribe el árbol de marcadores [{title, page, children}]
function writeOutline(doc, tree) {
  const ctx = doc.context;
  const pages = doc.getPages();
  if (!tree.length) { doc.catalog.delete(PDFName.of('Outlines')); return; }
  const rootRef = ctx.nextRef();
  const build = (items, parentRef) => {
    const refs = items.map(() => ctx.nextRef());
    let count = 0;
    items.forEach((it, i) => {
      const d = { Title: PDFHexString.fromText(it.title || 'Sin título'), Parent: parentRef };
      if (it.page != null && pages[it.page]) d.Dest = [pages[it.page].ref, 'XYZ', null, null, null];
      if (i > 0) d.Prev = refs[i - 1];
      if (i < items.length - 1) d.Next = refs[i + 1];
      if (it.children?.length) {
        const c = build(it.children, refs[i]);
        d.First = c.first; d.Last = c.last; d.Count = it.open === false ? -c.count : c.count;
        if (it.open !== false) count += c.count;
      }
      ctx.assign(refs[i], ctx.obj(d));
      count++;
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  };
  const top = build(tree, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

// Genera los bytes finales del documento con todas las ediciones
async function buildOutput({ encrypt = true, flattenComments = S.flattenComments } = {}) {
  commitTextEditing();
  const base = await getBaseBytes();
  const hasEdits = S.objects.some((a) => a.some((o) => o.type !== 'redact')) || S.outline || (encrypt && S.encryption);
  if (!hasEdits) return base;
  const doc = await loadLib(base);
  await drawObjectsIntoDoc(doc, { flattenComments });
  if (S.outline) writeOutline(doc, S.outline);
  if (encrypt && S.encryption) doc.encrypt(S.encryption);
  return doc.save();
}

async function saveDoc({ as = false } = {}) {
  if (!S.bytes) { toast('No hay ningún documento abierto', 'err'); return; }
  commitTextEditing();
  if (S.objects.some((a) => a.some((o) => o.type === 'redact'))) {
    const r = await modal({ title: 'Redacciones pendientes', body: 'Hay áreas marcadas para redactar que todavía no se aplicaron. Si guardás sin aplicarlas, el contenido seguirá visible.',
      buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar sin aplicar', value: 'skip' }, { label: 'Aplicar y guardar', primary: true, value: 'apply' }] });
    if (!r) return;
    if (r === 'apply') await applyRedactions({ confirm: false });
  }
  let name = S.fileName.replace(/\.pdf$/i, '') + '.pdf';
  let flatten = S.flattenComments;
  if (as) {
    const v = await formDialog('Guardar como', [
      { name: 'name', label: 'Nombre del archivo', value: name },
      { name: 'flatten', label: 'Aplanar comentarios (notas y resaltados dejan de ser editables en otros programas)', type: 'checkbox', value: flatten },
      { name: 'encrypt', label: 'Proteger con contraseña…', type: 'checkbox', value: !!S.encryption },
    ], { ok: 'Guardar' });
    if (!v) return;
    name = v.name.trim() || name;
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    flatten = v.flatten;
    S.flattenComments = flatten; lsSet('ma.flattenComments', flatten);
    if (v.encrypt && !S.encryption) { await encryptDialog(); }
    if (!v.encrypt) S.encryption = null;
  }
  const bytes = await withBusy('Guardando…', () => buildOutput({ flattenComments: flatten }));
  if (!bytes) return;
  if (window.showSaveFilePicker && as) {
    try {
      const fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const w = await fh.createWritable(); await w.write(bytes); await w.close();
      name = fh.name;
    } catch (e) { if (e.name === 'AbortError') return; download(bytes, name); }
  } else download(bytes, name);
  S.fileName = name;
  S.dirty = false;
  document.title = name + ' — Mini Acrobat';
  toast(`Guardado: ${name} (${fmtBytes(bytes.length)})`, 'ok');
}

/* ---------- renderizado de un PDF arbitrario ---------- */
async function openTempPdf(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice ? bytes.slice() : bytes, isEvalSupported: false, cMapUrl: PDFJS_CDN + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_CDN + 'standard_fonts/' }).promise;
}
async function renderToCanvas(page, scale, { forms = true } = {}) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: forms ? pdfjsLib.AnnotationMode.ENABLE_FORMS : pdfjsLib.AnnotationMode.DISABLE }).promise;
  return c;
}
function linesFromTC(tc, vt) {
  const items = tc.items.filter((it) => it.str && it.str.trim() !== '').map((it) => {
    const [x, y] = M.apply(vt, it.transform[4], it.transform[5]);
    return { x, y, fs: Math.hypot(it.transform[2], it.transform[3]) || 10, w: it.width, str: it.str };
  });
  items.sort((a, b) => (Math.abs(a.y - b.y) < Math.max(2, Math.min(a.fs, b.fs) * 0.45) ? a.x - b.x : a.y - b.y));
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, Math.min(last.fs, it.fs) * 0.45)) {
      const gap = it.x - last.xEnd;
      last.parts.push({ x: it.x, gap, str: it.str });
      last.text += (gap > it.fs * 0.2 && !/\s$/.test(last.text) ? ' ' : '') + it.str;
      last.xEnd = it.x + it.w;
    } else lines.push({ y: it.y, x: it.x, fs: it.fs, text: it.str, xEnd: it.x + it.w, parts: [{ x: it.x, gap: 0, str: it.str }] });
  }
  return lines;
}
async function docTextLines(pdf, i) {
  const page = await pdf.getPage(i + 1);
  const vt = page.getViewport({ scale: 1 }).transform;
  return { lines: linesFromTC(await page.getTextContent(), vt), page };
}
function linesToParagraphs(lines) {
  const paras = [];
  lines.forEach((l, k) => {
    const prev = lines[k - 1];
    const p = paras[paras.length - 1];
    if (p && prev && l.y - prev.y < prev.fs * 1.6 && Math.abs(l.fs - prev.fs) < 1.5) p.text += (/-$/.test(p.text) ? '' : ' ') + l.text;
    else paras.push({ text: l.text, fs: l.fs, x: l.x });
  });
  return paras;
}

/* ---------- impresión ---------- */
async function printDoc() {
  if (!S.bytes) return;
  await withBusy('Preparando impresión…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false }));
    const area = $('#printArea');
    area.innerHTML = '';
    for (let i = 0; i < pdf.numPages; i++) {
      progress(i / pdf.numPages, `Preparando página ${i + 1} de ${pdf.numPages}…`);
      const c = await renderToCanvas(await pdf.getPage(i + 1), 150 / 72);
      area.append(h('img', { src: c.toDataURL('image/jpeg', 0.92), alt: '' }));
    }
    await pdf.destroy();
  });
  await sleep(100);
  window.print();
  setTimeout(() => ($('#printArea').innerHTML = ''), 1000);
}

/* ---------- exportar ---------- */
async function exportImagesDialog() {
  const v = await formDialog('Exportar a imágenes', [
    { name: 'fmt', label: 'Formato', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
    { name: 'dpi', label: 'Resolución (ppp)', type: 'select', value: '150', options: ['72', '96', '150', '200', '300', '600'] },
    { name: 'q', label: 'Calidad JPG/WebP (%)', type: 'number', value: 90, min: 10, max: 100, show: (x) => x.fmt !== 'png' },
    { name: 'range', label: 'Páginas', value: '', help: rangeHelp },
  ], { ok: 'Exportar' });
  if (!v) return;
  await withBusy('Exportando imágenes…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    const idx = parseRange(v.range, pdf.numPages);
    const files = [];
    const ext = v.fmt === 'jpeg' ? 'jpg' : v.fmt;
    for (const [k, i] of idx.entries()) {
      progress(k / idx.length, `Página ${i + 1}…`);
      const c = await renderToCanvas(await pdf.getPage(i + 1), +v.dpi / 72);
      files.push({ name: `${baseName(S.fileName)}_pag${String(i + 1).padStart(3, '0')}.${ext}`, data: await canvasToBytes(c, 'image/' + v.fmt, (v.q || 90) / 100), type: 'image/' + v.fmt });
    }
    await pdf.destroy();
    downloadMany(files, baseName(S.fileName) + '_imagenes.zip');
  });
}
async function exportTextFile() {
  await withBusy('Extrayendo texto…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    let out = '';
    for (let i = 0; i < pdf.numPages; i++) {
      const { lines } = await docTextLines(pdf, i);
      out += (i ? '\n\f\n' : '') + linesToParagraphs(lines).map((p) => p.text).join('\n\n') + '\n';
    }
    await pdf.destroy();
    if (!out.trim()) toast('El documento no tiene texto seleccionable. Probá primero con "Reconocer texto (OCR)".', 'err', 6000);
    download(new Blob([out], { type: 'text/plain;charset=utf-8' }), baseName(S.fileName) + '.txt');
  });
}
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
async function exportWord() {
  await withBusy('Convirtiendo a Word…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    let body = '';
    let pw = 595, ph = 842;
    for (let i = 0; i < pdf.numPages; i++) {
      progress(i / pdf.numPages);
      const { lines, page } = await docTextLines(pdf, i);
      if (i === 0) { const vp = page.getViewport({ scale: 1 }); pw = vp.width; ph = vp.height; }
      const paras = linesToParagraphs(lines);
      const sizes = paras.map((p) => p.fs).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)] || 11;
      paras.forEach((p, k) => {
        const sz = Math.round(clamp(p.fs, 6, 72) * 2);
        const head = p.fs > median * 1.25;
        const pb = i > 0 && k === 0 ? '<w:pageBreakBefore/>' : '';
        body += `<w:p><w:pPr>${pb}<w:spacing w:after="120"/></w:pPr><w:r><w:rPr>${head ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
      });
      if (!paras.length && i > 0) body += '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>';
    }
    await pdf.destroy();
    const tw = (v) => Math.round(v * 20);
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${tw(pw)}" w:h="${tw(ph)}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const enc = new TextEncoder();
    const files = [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/document.xml', data: enc.encode(doc) },
    ];
    download(makeZip(files), baseName(S.fileName) + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
}
async function exportCsv() {
  await withBusy('Convirtiendo a tabla…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    const rows = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const { lines } = await docTextLines(pdf, i);
      for (const l of lines) {
        const cells = [''];
        for (const p of l.parts) {
          if (p.gap > l.fs * 1.2 && cells[cells.length - 1] !== '') cells.push(p.str);
          else cells[cells.length - 1] += (cells[cells.length - 1] && p.gap > l.fs * 0.2 ? ' ' : '') + p.str;
        }
        rows.push(cells.map((c) => c.trim()));
      }
      rows.push([]);
    }
    await pdf.destroy();
    const csv = '﻿' + rows.map((r) => r.map((c) => (/[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(';')).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), baseName(S.fileName) + '.csv');
  });
}
async function exportHtml() {
  await withBusy('Convirtiendo a HTML…', async () => {
    const pdf = await openTempPdf(await buildOutput({ encrypt: false, flattenComments: true }));
    let pagesHtml = '';
    for (let i = 0; i < pdf.numPages; i++) {
      progress(i / pdf.numPages);
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const img = (await renderToCanvas(page, 1.5)).toDataURL('image/jpeg', 0.85);
      const tc = await page.getTextContent();
      let spans = '';
      for (const it of tc.items) {
        if (!it.str?.trim()) continue;
        const [x, y] = M.apply(vp.transform, it.transform[4], it.transform[5]);
        const fs = Math.hypot(it.transform[2], it.transform[3]);
        spans += `<span style="left:${(x / vp.width * 100).toFixed(3)}%;top:${((y - fs * 0.85) / vp.height * 100).toFixed(3)}%;font-size:${(fs / vp.width * 100).toFixed(3)}cqw">${esc(it.str)}</span>`;
      }
      pagesHtml += `<section class="pg" style="aspect-ratio:${vp.width}/${vp.height}"><img src="${img}" alt="Página ${i + 1}">${spans}</section>\n`;
    }
    await pdf.destroy();
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(baseName(S.fileName))}</title>
<style>body{margin:0;background:#e9e9ec;font-family:Arial,sans-serif}.pg{position:relative;container-type:inline-size;max-width:900px;margin:16px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}.pg img{width:100%;height:100%;display:block}.pg span{position:absolute;color:transparent;white-space:pre;line-height:1}.pg span::selection{background:rgba(20,115,230,.35)}</style></head><body>
${pagesHtml}</body></html>`;
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName(S.fileName) + '.html');
  });
}

/* ---------- crear ---------- */
async function newBlankDialog() {
  const v = await formDialog('Nuevo documento en blanco', [
    { name: 'size', label: 'Tamaño', type: 'select', value: 'A4', options: Object.keys(PAGE_SIZES).filter((k) => k !== 'Legal') },
    { name: 'orient', label: 'Orientación', type: 'select', value: 'portrait', options: [['portrait', 'Vertical'], ['landscape', 'Horizontal']] },
    { name: 'count', label: 'Páginas', type: 'number', value: 1, min: 1, max: 500 },
  ], { ok: 'Crear' });
  if (!v) return;
  if (S.dirty && !(await confirmBox('Nuevo documento', 'Hay cambios sin guardar. ¿Descartarlos?', 'Descartar'))) return;
  let size = PAGE_SIZES[v.size];
  if (v.orient === 'landscape') size = [size[1], size[0]];
  const doc = await PDFDocument.create();
  for (let i = 0; i < (v.count || 1); i++) doc.addPage(size);
  await openBytes(await doc.save(), 'nuevo.pdf');
}
async function createFromImages(preset) {
  const files = preset || await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  const v = await formDialog('Crear PDF desde imágenes', [
    { name: 'info', type: 'html', html: `<p class="props-help">${files.length} imagen(es) seleccionada(s). Cada imagen será una página.</p>` },
    { name: 'fit', label: 'Tamaño de página', type: 'select', value: 'image', options: [['image', 'Igual a cada imagen'], ['A4', 'A4'], ['Carta', 'Carta']] },
    { name: 'margin', label: 'Margen (mm)', type: 'number', value: 0, min: 0, max: 50, show: (x) => x.fit !== 'image' },
  ], { ok: 'Crear' });
  if (!v) return;
  if (S.dirty && !(await confirmBox('Crear documento', 'Hay cambios sin guardar. ¿Descartarlos?', 'Descartar'))) return;
  const bytes = await withBusy('Creando PDF…', async () => {
    const doc = await PDFDocument.create();
    for (const [k, f] of files.entries()) { progress(k / files.length); await addImagePage(doc, await readDataURL(f), v.fit, (v.margin || 0) * 72 / 25.4); }
    return doc.save();
  });
  if (bytes) await openBytes(bytes, baseName(files[0].name) + '.pdf');
}
async function createFromTextDialog() {
  const v = await formDialog('Crear PDF desde texto', [
    { name: 'file', label: 'Archivo de texto (opcional)', type: 'file', accept: '.txt,.md,.csv,text/*' },
    { name: 'text', label: 'O escribí/pegá el texto', type: 'textarea', value: '' },
    { name: 'font', label: 'Fuente', type: 'select', value: 'helv', options: FONT_NAMES },
    { name: 'size', label: 'Tamaño de letra', type: 'number', value: 11, min: 6, max: 48 },
    { name: 'page', label: 'Tamaño de página', type: 'select', value: 'A4', options: ['A4', 'Carta', 'Oficio'] },
    { name: 'margin', label: 'Márgenes (mm)', type: 'number', value: 20, min: 5, max: 60 },
  ], { ok: 'Crear', wide: true });
  if (!v) return;
  let text = v.text;
  if (v.file?.length) text = await v.file[0].text();
  if (!text.trim()) { toast('No hay texto', 'err'); return; }
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts[STD_FONT[v.font][0]]);
  const [pw, ph] = PAGE_SIZES[v.page];
  const m = v.margin * 72 / 25.4, size = v.size, lh = size * 1.35;
  const lines = wrapText(winAnsi(text.replace(/\r/g, '')), f, size, pw - m * 2);
  let page = null, y = 0;
  for (const ln of lines) {
    if (!page || y < m + size) { page = doc.addPage([pw, ph]); y = ph - m - size; }
    if (ln) page.drawText(ln, { x: m, y, size, font: f, color: rgb(0, 0, 0) });
    y -= lh;
  }
  await openBytes(await doc.save(), (v.file?.[0] ? baseName(v.file[0].name) : 'texto') + '.pdf');
}

/* ---------- comparar ---------- */
function diffWords(a, b) {
  const A = a.split(/(\s+)/).filter((x) => x !== ''), B = b.split(/(\s+)/).filter((x) => x !== '');
  const n = A.length, m = B.length;
  if (n * m > 4e6) return [{ t: '=', s: '(página demasiado extensa para comparar en detalle)' }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  const push = (t, s) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }); };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('-', A[i]); i++; }
    else { push('+', B[j]); j++; }
  }
  while (i < n) push('-', A[i++]);
  while (j < m) push('+', B[j++]);
  return out;
}
async function compareDialog() {
  if (!S.pdf) { toast('Abrí el documento original primero', 'err'); return; }
  const [file] = await pickFiles();
  if (!file) return;
  const res = await withBusy('Comparando documentos…', async () => {
    const other = await openTempPdf(await readBytes(file));
    const n = Math.max(S.pdf.numPages, other.numPages);
    const pages = [];
    let adds = 0, dels = 0;
    for (let i = 0; i < n; i++) {
      progress(i / n, `Comparando página ${i + 1} de ${n}…`);
      const ta = i < S.pdf.numPages ? linesToParagraphs((await docTextLines(S.pdf, i)).lines).map((p) => p.text).join('\n') : '';
      const tb = i < other.numPages ? linesToParagraphs((await docTextLines(other, i)).lines).map((p) => p.text).join('\n') : '';
      if (ta === tb) { pages.push({ i, same: true }); continue; }
      const d = diffWords(ta, tb);
      d.forEach((x) => { if (x.t === '+') adds++; if (x.t === '-') dels++; });
      pages.push({ i, diff: d });
    }
    await other.destroy();
    return { pages, adds, dels, n };
  });
  if (!res) return;
  const changed = res.pages.filter((p) => !p.same);
  const body = h('div', {},
    h('p', {}, `Comparando "${S.fileName}" (original) con "${file.name}" (revisado): `, h('b', {}, `${changed.length} de ${res.n} página(s) con cambios`), ` · ${res.adds} inserción(es) · ${res.dels} eliminación(es).`),
    h('p', { class: 'props-help' }, h('del', {}, 'texto eliminado'), ' · ', h('ins', { style: { background: 'rgba(30,160,70,.2)', textDecoration: 'none' } }, 'texto agregado')));
  if (!changed.length) body.append(h('p', {}, '✔ No se encontraron diferencias de texto.'));
  for (const p of changed) {
    const div = h('div', { class: 'diff' });
    for (const x of p.diff) div.append(x.t === '=' ? document.createTextNode(x.s) : h(x.t === '+' ? 'ins' : 'del', {}, x.s));
    body.append(h('div', { class: 'diff-page' }, h('h4', {}, 'Página ' + (p.i + 1)), div));
  }
  await modal({ title: 'Resultado de la comparación', body, wide: true });
}

/* ---------- leer en voz alta ---------- */
let reading = null;
async function readAloud(fromHere = false) {
  if (!('speechSynthesis' in window)) { toast('Tu navegador no admite lectura en voz alta', 'err'); return; }
  if (reading) { speechSynthesis.cancel(); reading = null; toast('Lectura detenida'); return; }
  const start = S.current, end = fromHere ? S.pages.length - 1 : S.current;
  reading = { stop: false };
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => /^es/i.test(v.lang)) || null;
  toast(fromHere ? 'Leyendo desde esta página… (volvé a pulsar para detener)' : 'Leyendo la página… (volvé a pulsar para detener)');
  for (let i = start; i <= end && reading; i++) {
    goToPage(i);
    const text = (await pageText(i)).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const chunks = text.match(/[^.!?;:]{1,220}[.!?;:]?/g) || [text];
    for (const ch of chunks) {
      if (!reading) break;
      await new Promise((res) => {
        const u = new SpeechSynthesisUtterance(ch);
        u.lang = voice?.lang || 'es-ES'; if (voice) u.voice = voice;
        u.onend = res; u.onerror = res;
        speechSynthesis.speak(u);
      });
    }
  }
  reading = null;
}

/* ---------- presentación ---------- */
async function presentation() {
  if (!S.pdf) return;
  const bytes = await withBusy('Preparando presentación…', () => buildOutput({ encrypt: false, flattenComments: true }));
  const pdf = await openTempPdf(bytes);
  let i = S.current;
  const root = h('div', { id: 'present', tabindex: '0' });
  const info = h('div', { class: 'pinfo' });
  document.body.append(root);
  let canvas = null;
  const show = async () => {
    const page = await pdf.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const sc = Math.min(window.innerWidth / vp1.width, window.innerHeight / vp1.height) * (window.devicePixelRatio || 1);
    const c = await renderToCanvas(page, sc);
    c.style.width = c.width / (window.devicePixelRatio || 1) + 'px';
    canvas?.remove(); canvas = c; root.prepend(c);
    info.textContent = `${i + 1} / ${pdf.numPages}`;
  };
  root.append(info);
  const close = async () => { document.removeEventListener('keydown', key, true); root.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); await pdf.destroy(); goToPage(i); };
  const key = (e) => {
    e.stopPropagation();
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); if (i < pdf.numPages - 1) { i++; show(); } }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); if (i > 0) { i--; show(); } }
    else if (e.key === 'Home') { i = 0; show(); } else if (e.key === 'End') { i = pdf.numPages - 1; show(); }
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', key, true);
  root.addEventListener('click', (e) => { if (e.clientX < window.innerWidth / 3) { if (i > 0) { i--; show(); } } else if (i < pdf.numPages - 1) { i++; show(); } });
  document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement && root.isConnected) { document.removeEventListener('fullscreenchange', fc); close(); } });
  try { await root.requestFullscreen(); } catch { /* sin pantalla completa */ }
  await show();
}
