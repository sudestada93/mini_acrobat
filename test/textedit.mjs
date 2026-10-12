// Prueba del editor de texto: fuentes originales, negritas, alineación y eliminación del texto reemplazado.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch { /* siguiente */ } }
const out = path.join(root, 'test-output');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

// PDF realista: fuentes incrustadas en subconjunto (como Word/Chrome), negrita, cursiva y párrafo justificado
const gen = await browser.newPage();
await gen.setContent(`<html><body style="margin:60px;font-size:14px">
  <h1 style="font-family:Carlito">Informe anual de ventas</h1>
  <p style="font-family:Carlito">El cliente <b>Juan Pérez</b> firmó el contrato el día <i>12 de marzo</i>. Texto normal después.</p>
  <p style="font-family:'Liberation Serif';text-align:justify;width:420px">Este es un párrafo justificado de ejemplo con varias líneas de texto para comprobar que la edición mantiene la alineación del resto del documento sin descuadrar las palabras vecinas ni los márgenes.</p>
  </body></html>`);
const pdfBytes = await gen.pdf({ format: 'A4' });
writeFileSync(path.join(out, 'texto.pdf'), pdfBytes);
await gen.close();

const errors = [];
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [' + m.type() + '] ' + m.text().slice(0, 300)); if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(root, 'mini_acrobat.html')).href);
await page.waitForFunction(() => window.miniAcrobat);
await page.setInputFiles('#fileInput', path.join(out, 'texto.pdf'));
await page.waitForSelector('.page canvas[width]:not([width="0"])');
await page.waitForTimeout(800);
const check = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push('FALLO: ' + m); };

const items = await page.evaluate(async () => (await window.miniAcrobat.pageItems(0)).map((i) => ({ str: i.str, x: i.x, base: i.base, w: i.w, fs: i.fs, font: i.h?.base, bold: i.h?.info.bold })));
console.log(items.map((i) => `${JSON.stringify(i.str)} @${i.x.toFixed(1)},${i.base.toFixed(1)} w${i.w.toFixed(1)} ${i.font} b=${i.bold}`).join('\n'));
const clickAt = async (x, y, mods = []) => {
  const b = await page.locator('.page').first().boundingBox();
  const sc = await page.evaluate(() => window.miniAcrobat.S.scale);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(b.x + x * sc, b.y + y * sc);
  for (const m of mods) await page.keyboard.up(m);
};
await page.evaluate(() => window.miniAcrobat.setTool('edittext'));
const juan = items.find((i) => i.str.includes('Juan'));
await clickAt(juan.x + juan.w - 1, juan.base - juan.fs * 0.3);
await page.waitForSelector('.tx-editor');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, '20-editando.png') });
const obj = await page.evaluate(() => { const o = window.miniAcrobat.S.sel; return { runs: o.runs.map((r) => ({ t: r.t, fam: r.fd.family, bold: r.fd.bold, italic: r.fd.italic, pdf: r.fd.pdf, s: r.s, c: r.c, cs: r.cs, kern: r.kern })), x: o.x, y: o.y, asc: o.asc }; });
console.log(JSON.stringify(obj, null, 1));
check(obj.runs.some((r) => r.bold && /Juan/.test(r.t) && /Carlito-Bold/.test(r.pdf)), 'detecta negrita con la fuente original Carlito-Bold');
check(obj.runs.some((r) => r.italic && /marzo/.test(r.t)), 'detecta cursiva');
check(obj.runs.every((r) => r.fam === 'Calibri'), 'reconoce la familia (Carlito ≈ Calibri)');
// escribir: el cursor queda al final de "Pérez"
await page.keyboard.type(' Gómez');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, '21-editado.png') });

// párrafo justificado: Mayús+clic edita el párrafo completo
const para = items.find((i) => i.str.startsWith('Este es'));
await clickAt(para.x + 30, para.base - para.fs * 0.3, ['Shift']);
await page.waitForSelector('.tx-editor');
const pobj = await page.evaluate(() => { const o = window.miniAcrobat.S.sel; return { align: o.align, nowrap: o.nowrap, w: o.w, lines: o.regions.length, text: o.runs.map((r) => r.t).join('') }; });
console.log(JSON.stringify(pobj));
check(pobj.align === 'justify' && !pobj.nowrap && pobj.lines >= 3, 'detecta párrafo justificado de varias líneas');
await page.keyboard.press('Home');
await page.keyboard.type('NUEVO ');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, '22-parrafo.png') });

// negrita aplicada a una sola palabra con Ctrl+B
{
  const o = await page.evaluate(() => { const o = window.miniAcrobat.S.objects[0].find((x) => x.runs.some((r) => /normal/.test(r.t))); return { x: o.x, y: o.y, h: o.h }; });
  await clickAt(o.x + 5, o.y + o.h / 2);
  await page.waitForSelector('.tx-editor');
  const span = page.locator('.tx-editor span', { hasText: 'normal' }).first();
  const sb = await span.boundingBox();
  const txt = await span.textContent();
  const k = txt.indexOf('normal');
  // posición aproximada de la palabra dentro del fragmento
  const cx = sb.x + sb.width * ((k + 3) / txt.length);
  await page.mouse.dblclick(cx, sb.y + sb.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  const runs = await page.evaluate(() => window.miniAcrobat.S.objects[0].find((x) => x.runs.some((r) => /normal/.test(r.t))).runs.map((r) => [r.t, r.fd.bold, r.fd.pdf]));
  const nb = runs.find((r) => r[0].includes('normal'));
  check(nb && nb[1] && nb[0].trim() === 'normal', 'Ctrl+B aplica negrita solo a la palabra seleccionada (' + JSON.stringify(nb) + ')');
  check(nb && /Carlito-Bold/.test(nb[2] || ''), 'la negrita usa la variante negrita de la fuente original del documento');
  await page.evaluate(() => window.miniAcrobat.undo());
  const back = await page.evaluate(() => window.miniAcrobat.S.objects[0].find((x) => x.runs.some((r) => /normal/.test(r.t))).runs.find((r) => /normal/.test(r.t)).fd.bold);
  check(back === false, 'deshacer revierte el cambio de formato');
  await page.evaluate(() => window.miniAcrobat.redo());
}
const res = await page.evaluate(async () => {
  const A = window.miniAcrobat;
  const bytes = await A.buildOutput();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), fontExtraProperties: true }).promise;
  const p = await pdf.getPage(1);
  await p.getOperatorList();
  const tc = await p.getTextContent();
  const vt = p.getViewport({ scale: 1 }).transform;
  const its = tc.items.filter((i) => i.str.trim()).map((i) => { const [x, y] = pdfjsLib.Util.applyTransform([i.transform[4], i.transform[5]], vt); return { s: i.str, x, y, w: i.width, f: p.commonObjs.get(i.fontName).name }; });
  const all = tc.items.map((i) => i.str).join('|');
  return { its, all, size: bytes.length };
});
writeFileSync(path.join(out, 'texto-editado.pdf'), Buffer.from(await page.evaluate(async () => { const b = await window.miniAcrobat.buildOutput(); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), 'base64'));
console.log(res.its.map((i) => `${JSON.stringify(i.s)} @${i.x.toFixed(1)},${i.y.toFixed(1)} w${i.w.toFixed(1)} ${i.f}`).join('\n'));
const count = (re) => (res.all.match(re) || []).length;
check(count(/Gómez/g) === 1, 'el texto nuevo aparece una vez');
check(count(/Juan/g) === 1 && count(/firmó/g) === 1, 'el texto original reemplazado se eliminó (sin duplicados)');
const gomez = res.its.find((i) => /Gómez/.test(i.s));
check(gomez && /Carlito-Bold|Helvetica-Bold/.test(gomez.f), 'el texto agregado mantiene la negrita (' + gomez?.f + ')');
const firmo0 = items.find((i) => /rmó/.test(i.str)), firmo1 = res.its.find((i) => /firmó/.test(i.s));
check(firmo1 && Math.abs(firmo1.y - firmo0.base) < 0.3, 'misma línea de base que el original');
const el0 = items.find((i) => i.str.startsWith('El cliente')), el1 = res.its.find((i) => i.s.startsWith('El cliente'));
check(el1 && Math.abs(el1.x - el0.x) < 0.3, 'el inicio de la línea no se movió');
const j0 = items.find((i) => i.str.startsWith('Juan')), j1 = res.its.find((i) => i.s.startsWith('Juan'));
check(j1 && Math.abs(j1.x - j0.x) < 0.3, 'las palabras no editadas conservan su posición exacta (' + j0.x.toFixed(2) + ' vs ' + j1?.x.toFixed(2) + ')');
check(count(/NUEVO/g) === 1 && count(/Este es/g) === 1, 'párrafo editado sin duplicados');
const nrm = res.its.find((i) => i.s.trim() === 'normal');
check(nrm && /Carlito-Bold/.test(nrm.f), 'la palabra en negrita se guarda con Carlito-Bold (' + nrm?.f + ')');
// con acceso a las fuentes instaladas: las letras que faltan en el subconjunto se escriben con la misma fuente instalada
{
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx2.grantPermissions(['local-fonts']);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
  await p2.goto(pathToFileURL(path.join(root, 'mini_acrobat.html')).href);
  await p2.waitForFunction(() => window.miniAcrobat);
  await p2.setInputFiles('#fileInput', path.join(out, 'texto.pdf'));
  await p2.waitForSelector('.page canvas[width]:not([width="0"])');
  await p2.waitForTimeout(600);
  await p2.evaluate(() => window.miniAcrobat.setTool('edittext'));
  const b = await p2.locator('.page').first().boundingBox();
  const sc = await p2.evaluate(() => window.miniAcrobat.S.scale);
  await p2.mouse.click(b.x + (juan.x + juan.w - 1) * sc, b.y + (juan.base - juan.fs * 0.3) * sc);
  await p2.waitForSelector('.tx-editor');
  await p2.waitForTimeout(500);
  await p2.keyboard.type(' Gómez');
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(out, '23-fuente-instalada.png') });
  const f2 = await p2.evaluate(async () => {
    const bytes = await window.miniAcrobat.buildOutput();
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pg = await pdf.getPage(1); await pg.getOperatorList();
    const tc = await pg.getTextContent();
    const it = tc.items.find((i) => /Gómez/.test(i.str));
    return it ? pg.commonObjs.get(it.fontName).name : null;
  });
  check(/Carlito-Bold/.test(f2 || ''), 'con la fuente instalada, las letras faltantes usan la misma fuente (' + f2 + ')');
  await ctx2.close();
}
await browser.close();
if (errors.length) { console.log('\nErrores:\n' + errors.join('\n')); process.exit(1); }
console.log('\nTodo OK');
