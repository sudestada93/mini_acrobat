/* Fuentes: análisis de las fuentes del PDF, fuentes instaladas o cargadas y fuentes estándar equivalentes. */
const fontkit = window.fontkit?.create ? window.fontkit : window.fontkit?.default;
const STD_FONT = {
  helv: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  cour: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
const CAT_STD = { sans: 'helv', serif: 'times', mono: 'cour' };
const GENERIC_CSS = {
  sans: 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", Tinos, serif',
  mono: '"Courier New", Courier, "Liberation Mono", Cousine, monospace',
};
// familias conocidas: [patrón sobre el nombre compacto, nombre visible, categoría, alternativas compatibles]
const FAMILY_DB = [
  [/^(arial|helvetica|arimo|liberationsans|nimbussans|freesans)/, 'Arial', 'sans', ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'Nimbus Sans']],
  [/^(timesnewroman|times|tinos|liberationserif|nimbusrom|freeserif)/, 'Times New Roman', 'serif', ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'Nimbus Roman']],
  [/^(couriernew|courier|cousine|liberationmono|nimbusmono|freemono)/, 'Courier New', 'mono', ['Courier New', 'Courier', 'Liberation Mono', 'Cousine', 'Nimbus Mono PS']],
  [/^(calibri|carlito)/, 'Calibri', 'sans', ['Calibri', 'Carlito']],
  [/^(cambria|caladea)/, 'Cambria', 'serif', ['Cambria', 'Caladea']],
  [/^(georgia|gelasio)/, 'Georgia', 'serif', ['Georgia', 'Gelasio']],
  [/^(dejavusansmono|consolas|menlo|monaco|lucidaconsole|sourcecode|robotomono|notosansmono|inconsolata|firacode|ibmplexmono|plexmono|ubuntumono|jetbrainsmono|sfmono|andalemono)/, null, 'mono', []],
  [/^(garamond|ebgaramond|palatino|palatinolinotype|bookantiqua|bookman|baskerville|minion|caslon|centuryschoolbook|constantia|notoserif|sourceserif|dejavuserif|charter|bitstreamcharter|ibmplexserif|plexserif|crimson|merriweather|playfair|lora|ptserif|libre ?baskerville|cormorant|didot|bodoni|rockwell|courierprime)/, null, 'serif', []],
  [/^(verdana|tahoma|segoe|opensans|roboto|lato|sourcesans|notosans|inter|montserrat|ubuntu|trebuchet|gillsans|futura|avenir|myriad|frutiger|univers|franklin|centurygothic|lucidasans|dejavusans|candara|corbel|calibrilight|aptos|helveticaneue|sfpro|poppins|raleway|nunito|ptsans|worksans|barlow|oswald|arialnarrow)/, null, 'sans', []],
];
const SYMBOL_FONT = /^(symbol|zapfdingbats|dingbats|wingdings|webdings|marlett)/;

function cleanFontName(name) { return String(name || '').replace(/^[A-Z]{6}\+/, ''); }
// "TimesNewRomanPS-BoldItalicMT" -> {family:'Times New Roman', bold, italic, cat}
function parseFontName(name, hints = {}) {
  const base = cleanFontName(name);
  let fam = base, style = '';
  const m = base.match(/^(.*?)[-,_](.+)$/) || base.match(/^(.*?)\s+(Bold|Italic|Oblique|Black|Semibold|SemiBold|Medium|Light|Regular|Heavy|Book|Roman).*$/i);
  if (m) { fam = m[1]; style = m[2]; }
  const s = (style + ' ' + (m ? '' : base)).toLowerCase();
  const bold = !!hints.bold || !!hints.black || /(bold|black|heavy|semibd|demi|extrab|ultrab|\bsb\b|w[6-9]\b)/.test(s) || /(bold|black|heavy)$/i.test(fam);
  const italic = !!hints.italic || /(italic|oblique|ital|kursiv|slanted|inclined)/.test(s) || /(^|[a-z])it$/i.test(style) || /(italic|oblique)$/i.test(fam);
  // nombre de familia legible
  let family = fam.replace(/(PSMT|PS|MT|Std|LT|Com)$/, '').replace(/(Bold|Italic|Oblique|Regular)$/i, '');
  const compact = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  let cat = null, alts = [];
  for (const [re, nice, c, a] of FAMILY_DB) if (re.test(compact)) { if (nice) family = nice; cat = c; alts = a; break; }
  if (!FAMILY_DB.some(([re, nice]) => nice && re.test(compact))) family = family.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
  // nombre visible tal como figura en el PDF ("Liberation Serif", "Times New Roman", "Open Sans")
  const nice = prettyFamily(fam);
  if (!cat) cat = hints.mono ? 'mono' : hints.serif ? 'serif' : hints.generic === 'serif' ? 'serif' : hints.generic === 'monospace' ? 'mono' : 'sans';
  return { family: family || 'Arial', name: nice || family, bold, italic, cat, alts, symbol: SYMBOL_FONT.test(compact), ps: base };
}
function prettyFamily(fam) {
  return String(fam || '').replace(/(PSMT|PS|MT|Std|LT|Com)$/, '').replace(/(Bold|Italic|Oblique|Regular)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/Deja Vu/g, 'DejaVu').replace(/\s+/g, ' ').trim();
}
// descriptor de fuente guardado en cada fragmento de texto (serializable)
function stdFd(key = 'helv', bold = false, italic = false) {
  const fam = { helv: 'Arial', times: 'Times New Roman', cour: 'Courier New' }[key] || 'Arial';
  const cat = { helv: 'sans', times: 'serif', cour: 'mono' }[key] || 'sans';
  return { family: fam, bold, italic, cat, pdf: null, ext: null };
}
function fdLabel(fd) { return (fd.name || fd.family) + (fd.bold && fd.italic ? ' (negrita cursiva)' : fd.bold ? ' (negrita)' : fd.italic ? ' (cursiva)' : ''); }
function fdAlts(fd) { for (const [re, nice, , alts] of FAMILY_DB) if (nice === fd.family || re.test(fd.family.toLowerCase().replace(/[^a-z0-9]/g, ''))) return alts; return []; }
function cssFamily(fd) {
  const names = [...new Set([fd.ext && S.extFonts.get(fd.ext)?.css, fd.name, fd.family, ...fdAlts(fd)].filter(Boolean))];
  return names.map((n) => `"${n}"`).join(', ') + ', ' + GENERIC_CSS[fd.cat || 'sans'];
}
const stdName = (fd) => STD_FONT[CAT_STD[fd.cat] || 'helv'][(fd.bold ? 1 : 0) + (fd.italic ? 2 : 0)];
const stdEmbedders = new Map();
function stdEmbedder(name) {
  if (!stdEmbedders.has(name)) stdEmbedders.set(name, PDFLib.StandardFontEmbedder.for(PDFLib.StandardFonts[name]));
  return stdEmbedders.get(name);
}

/* ---------- fuentes del PDF (vía pdf.js) ---------- */
S.pdfFontsByPage = [];     // por página: Map(BaseFont -> handle)
S.pdfFontsAll = new Map(); // BaseFont -> handle (primera aparición)
function resetPdfFonts() { S.pdfFontsByPage = []; S.pdfFontsAll = new Map(); }
function makePdfFontHandle(fo, style) {
  const uni2code = new Map();
  const ligs = new Map(); // secuencias de varios caracteres representadas por un solo glifo (fi, fl, ...)
  const tu = fo.toUnicode;
  const addMap = (u, code) => {
    if (typeof u !== 'string' || !u) return;
    const forms = new Set([u, u.normalize('NFKC')]);
    for (const f of forms) {
      if ([...f].length === 1) { if (!uni2code.has(f)) uni2code.set(f, code); }
      else if ([...f].length <= 4 && !ligs.has(f)) ligs.set(f, code);
    }
  };
  if (tu && Array.isArray(tu._map)) tu._map.forEach((u, code) => addMap(u, code));
  else if (tu && Number.isInteger(tu.firstChar)) for (let c = tu.firstChar; c <= tu.lastChar; c++) uni2code.set(String.fromCharCode(c), c);
  let codeBytes = 1;
  if (fo.composite) {
    codeBytes = 2;
    const ranges = fo.cMap?.codespaceRanges;
    if (Array.isArray(ranges)) { const k = ranges.findIndex((r) => r && r.length); if (k >= 0) codeBytes = k + 1; }
  }
  const info = parseFontName(fo.name, { bold: fo.bold, black: fo.black, italic: fo.italic, serif: fo.isSerifFont, mono: fo.isMonospace, generic: fo.fallbackName });
  const h = {
    ln: fo.loadedName, base: fo.name, info, embedded: !fo.missingFile && !!fo.data, type3: !!fo.isType3Font,
    asc: fo.ascent || style?.ascent || 0.8, desc: Math.abs(fo.descent || style?.descent || 0.2),
    uni2code, ligs, widths: fo.widths || [], dw: fo.defaultWidth || 0, toFontChar: fo.toFontChar || null, codeBytes,
    usable: !fo.isType3Font && !info.symbol && uni2code.size > 0,
  };
  return h;
}
function pdfFontCode(h, ch) {
  if (!h.usable) return undefined;
  const code = h.uni2code.get(ch);
  if (code == null) return undefined;
  if (h.embedded && h.toFontChar && h.toFontChar[code] == null) return undefined;
  return code;
}
const pdfCodeWidth = (h, code) => (h.widths[code] ?? h.dw ?? 0) / 1000;
// Codifica un texto con la fuente del PDF; null si falta algún glifo
function pdfEncode(h, text) {
  if (!h.usable) return null;
  const chars = [...text];
  const codes = [];
  for (let i = 0; i < chars.length;) {
    let done = false;
    if (h.ligs.size) {
      for (let L = Math.min(4, chars.length - i); L >= 2; L--) {
        const seq = chars.slice(i, i + L).join('');
        const c = h.ligs.get(seq);
        if (c != null && pdfFontCode(h, chars[i]) == null && (!h.embedded || !h.toFontChar || h.toFontChar[c] != null)) { codes.push(c); i += L; done = true; break; }
      }
    }
    if (done) continue;
    const c = pdfFontCode(h, chars[i]);
    if (c == null) return null;
    codes.push(c); i++;
  }
  return codes;
}
// carga las fuentes de una página (necesario para editar con la fuente original)
async function loadPageFonts(pi) {
  if (S.pdfFontsByPage[pi]) return S.pdfFontsByPage[pi];
  const pg = S.pages[pi];
  const map = new Map();
  try {
    await pg.proxy.getOperatorList();
    const tc = await getText(pi);
    for (const it of tc.items) {
      if (!it.fontName || map.has(it.fontName)) continue;
      if (!pg.proxy.commonObjs.has(it.fontName)) continue;
      const fo = pg.proxy.commonObjs.get(it.fontName);
      const hnd = makePdfFontHandle(fo, tc.styles[it.fontName]);
      map.set(it.fontName, hnd);
      if (!S.pdfFontsAll.has(hnd.base)) S.pdfFontsAll.set(hnd.base, hnd);
    }
  } catch (e) { console.warn('fuentes de la página', e); }
  const byBase = new Map([...map.values()].map((x) => [x.base, x]));
  byBase.byLoaded = map;
  S.pdfFontsByPage[pi] = byBase;
  return byBase;
}
function pdfFontFor(pi, base) {
  if (!base) return null;
  return S.pdfFontsByPage[pi]?.get(base) || S.pdfFontsAll.get(base) || null;
}

/* ---------- fuentes externas: instaladas en el equipo o cargadas por el usuario ---------- */
S.extFonts = new Map();   // clave (nombre PostScript) -> {key, family, bold, italic, cat, bytes, fk, css}
S.localFonts = null;      // lista de FontData de queryLocalFonts()
S.localFontsState = 'unknown';
let extCounter = 0;
function fkHasAll(fk, text) {
  for (const ch of text) { if (/\s/.test(ch)) continue; if (!fk.hasGlyphForCodePoint(ch.codePointAt(0))) return false; }
  return true;
}
async function registerExtFont(bytes, source, wantPs) {
  let fk = fontkit.create(bytes);
  const collection = !!fk.fonts;
  if (collection) fk = fk.fonts.find((f) => f.postscriptName === wantPs) || fk.fonts[0];
  if (!fk || !fk.postscriptName) throw new Error('Fuente no válida');
  const key = fk.postscriptName;
  if (S.extFonts.has(key)) return S.extFonts.get(key);
  const os2 = fk['OS/2'];
  const info = parseFontName(key, { bold: (os2?.usWeightClass || 400) >= 600, italic: !!(fk.italicAngle) || /italic|oblique/i.test(fk.subfamilyName || '') });
  const family = fk.familyName || info.family;
  const fam = parseFontName(family.replace(/\s/g, '') + (info.bold ? '-Bold' : '') + (info.italic ? 'Italic' : ''));
  const css = 'ma_ext_' + (++extCounter);
  const e = { key, family, bold: info.bold, italic: info.italic, cat: fam.cat || info.cat, bytes, fk, css, source, ps: collection ? key : undefined };
  try { const face = new FontFace(css, bytes); await face.load(); document.fonts.add(face); } catch { /* las colecciones .ttc no se pueden mostrar; se usa la fuente local */ e.css = null; }
  S.extFonts.set(key, e);
  return e;
}
function canQueryLocalFonts() { return typeof window.queryLocalFonts === 'function'; }
// Pide acceso a las fuentes instaladas (Chrome/Edge). Debe llamarse durante un gesto del usuario.
function requestLocalFonts() {
  if (!canQueryLocalFonts() || S.localFonts || S.localFontsState === 'denied' || !lsGet('ma.localFonts', true)) return Promise.resolve(S.localFonts);
  const p = window.queryLocalFonts().then((list) => { S.localFonts = list; S.localFontsState = 'granted'; return list; })
    .catch(() => { S.localFontsState = 'denied'; return null; });
  return p;
}
const famKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Busca en las fuentes instaladas la misma familia (o una compatible) con el estilo pedido y la carga
async function loadLocalMatch(fd) {
  if (!S.localFonts) return null;
  const wanted = [...new Set([fd.name, fd.family, ...fdAlts(fd)].filter(Boolean).map(famKey))];
  const styleOk = (f) => {
    const st = (f.style || '').toLowerCase();
    const b = /bold|black|heavy|semibold|demi/.test(st), it = /italic|oblique/.test(st);
    return b === !!fd.bold && it === !!fd.italic;
  };
  for (const w of wanted) {
    const cand = S.localFonts.filter((f) => famKey(f.family) === w);
    const pick = cand.find(styleOk) || null;
    if (!pick) continue;
    if (S.extFonts.has(pick.postscriptName)) return S.extFonts.get(pick.postscriptName);
    try { const bytes = new Uint8Array(await (await pick.blob()).arrayBuffer()); return await registerExtFont(bytes, 'local', pick.postscriptName); }
    catch (e) { console.warn('fuente local', e); }
  }
  return null;
}
// Fuente externa ya cargada que coincide con la familia y estilo del descriptor
function matchExtFont(fd) {
  if (fd.ext && S.extFonts.has(fd.ext)) return S.extFonts.get(fd.ext);
  const wanted = [...new Set([fd.name, fd.family, ...fdAlts(fd)].filter(Boolean).map(famKey))];
  for (const w of wanted) for (const e of S.extFonts.values()) if (famKey(e.family) === w && e.bold === !!fd.bold && e.italic === !!fd.italic) return e;
  return null;
}
// Fuentes cargadas por el usuario: se guardan en IndexedDB para la próxima vez
function fontDb() {
  return new Promise((res, rej) => { const r = indexedDB.open('mini-acrobat', 1); r.onupgradeneeded = () => r.result.createObjectStore('fonts'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function saveUserFont(key, bytes) {
  try { const db = await fontDb(); db.transaction('fonts', 'readwrite').objectStore('fonts').put(bytes, key); } catch { /* sin almacenamiento */ }
}
async function loadUserFonts() {
  try {
    const db = await fontDb();
    const store = db.transaction('fonts').objectStore('fonts');
    const keys = await new Promise((r) => { const q = store.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
    for (const k of keys) {
      const bytes = await new Promise((r) => { const q = db.transaction('fonts').objectStore('fonts').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
      if (bytes) await registerExtFont(new Uint8Array(bytes), 'upload', k).catch(() => {});
    }
  } catch { /* sin IndexedDB */ }
}
async function uploadFonts() {
  const files = await pickFiles({ accept: '.ttf,.otf,.ttc,font/ttf,font/otf', multiple: true });
  const added = [];
  for (const f of files) {
    try { const e = await registerExtFont(await readBytes(f), 'upload'); await saveUserFont(e.key, e.bytes); added.push(e.family + (e.bold ? ' negrita' : '') + (e.italic ? ' cursiva' : '')); }
    catch (err) { toast(`No se pudo cargar ${f.name}: ${err.message}`, 'err'); }
  }
  if (added.length) toast('Fuentes cargadas: ' + added.join(', '), 'ok', 5000);
  return added.length;
}

/* ---------- resolución de cada palabra a una fuente concreta ---------- */
// Devuelve {kind:'pdf'|'ext'|'std', h|e|name}
function resolveFont(pi, fd, word) {
  if (fd.pdf) {
    const h = pdfFontFor(pi, fd.pdf);
    if (h) { const codes = pdfEncode(h, word); if (codes) return { kind: 'pdf', h, codes }; }
  }
  const e = matchExtFont(fd);
  if (e && fkHasAll(e.fk, word)) return { kind: 'ext', e };
  return { kind: 'std', name: stdName(fd) };
}
function measureWith(rf, text, size) {
  if (!text) return 0;
  if (rf.kind === 'pdf') { const codes = pdfEncode(rf.h, text) || []; let w = 0; for (const c of codes) w += pdfCodeWidth(rf.h, c); return w * size; }
  if (rf.kind === 'ext') return (rf.e.fk.layout(text).advanceWidth / rf.e.fk.unitsPerEm) * size;
  return stdEmbedder(rf.name).widthOfTextAtSize(winAnsi(text), size);
}
// ancho de un espacio en la fuente del fragmento
function spaceWidth(pi, fd, size) {
  if (fd.pdf) { const h = pdfFontFor(pi, fd.pdf); const c = h && h.uni2code.get(' '); if (c != null && pdfCodeWidth(h, c) > 0) return pdfCodeWidth(h, c) * size; }
  const e = matchExtFont(fd);
  if (e) return measureWith({ kind: 'ext', e }, ' ', size);
  return measureWith({ kind: 'std', name: stdName(fd) }, ' ', size);
}
// métricas verticales (proporción del tamaño)
function fdMetrics(pi, fd) {
  const h = fd.pdf && pdfFontFor(pi, fd.pdf);
  if (h) return { asc: clamp(h.asc, 0.5, 1.2), desc: clamp(h.desc, 0.05, 0.5) };
  const e = matchExtFont(fd);
  if (e) return { asc: e.fk.ascent / e.fk.unitsPerEm, desc: Math.abs(e.fk.descent) / e.fk.unitsPerEm };
  return { sans: { asc: 0.905, desc: 0.212 }, serif: { asc: 0.891, desc: 0.216 }, mono: { asc: 0.833, desc: 0.3 } }[fd.cat || 'sans'];
}
// texto para mostrar con la fuente cargada por pdf.js (usa códigos internos)
function pdfDisplayString(h, text) {
  const codes = pdfEncode(h, text);
  if (!codes) return text;
  return codes.map((c) => String.fromCodePoint(h.toFontChar[c])).join('');
}
// Lista de fuentes para los selectores: las del documento, las cargadas/instaladas y las estándar
function fontChoices(pi) {
  const out = [];
  const seen = new Set();
  const add = (fd, label, group) => { const k = JSON.stringify([fd.family, fd.pdf, fd.ext, fd.bold, fd.italic]); if (seen.has(k)) return; seen.add(k); out.push({ fd, label, group }); };
  const pageFonts = S.pdfFontsByPage[pi];
  for (const h of [...(pageFonts?.values() || []), ...S.pdfFontsAll.values()]) {
    if (!h.usable) continue;
    add({ family: h.info.family, name: h.info.name, bold: h.info.bold, italic: h.info.italic, cat: h.info.cat, pdf: h.base, ext: null }, fdLabel(h.info), 'Del documento');
  }
  for (const e of S.extFonts.values()) add({ family: e.family, name: e.family, bold: e.bold, italic: e.italic, cat: e.cat, pdf: null, ext: e.key }, fdLabel(e), e.source === 'local' ? 'Instaladas' : 'Cargadas');
  for (const k of ['helv', 'times', 'cour']) for (const [b, i] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const fd = stdFd(k, !!b, !!i); add(fd, fdLabel(fd), 'Estándar'); }
  return out;
}
loadUserFonts();
