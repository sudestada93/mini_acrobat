// Prueba de humo: abre mini_acrobat.html en Chromium y ejercita las funciones principales.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* siguiente */ }
}
if (!chromium) { console.error('Playwright no está instalado'); process.exit(1); }
const PDFLib = require('../node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js');
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

const out = path.join(root, 'test-output');
mkdirSync(out, { recursive: true });

async function samplePdf() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 4; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Titulo de la pagina ${i + 1}`, { x: 60, y: 770, size: 22, font: fb });
    p.drawText('Contrato de prueba con datos confidenciales: juan@example.com', { x: 60, y: 720, size: 12, font: f });
    p.drawText('Linea normal de texto para buscar y resaltar.', { x: 60, y: 700, size: 12, font: f, color: rgb(0.1, 0.1, 0.4) });
    if (i === 2) p.setRotation(degrees(90));
  }
  const form = doc.getForm();
  const tf = form.createTextField('nombre');
  tf.addToPage(doc.getPage(0), { x: 60, y: 600, width: 200, height: 22 });
  const cb = form.createCheckBox('acepto');
  cb.addToPage(doc.getPage(0), { x: 60, y: 560, width: 14, height: 14 });
  return doc.save();
}

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(root, 'mini_acrobat.html')).href);
await page.waitForFunction(() => window.miniAcrobat);
await page.screenshot({ path: path.join(out, '01-bienvenida.png') });

const b64 = Buffer.from(await samplePdf()).toString('base64');
await page.evaluate(async (b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  await window.miniAcrobat.openBytes(u, 'prueba.pdf');
}, b64);
await page.waitForSelector('.page canvas[width]:not([width="0"])');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, '02-abierto.png') });

const check = (cond, msg) => { if (!cond) { errors.push('FALLO: ' + msg); console.log('✗', msg); } else console.log('✓', msg); };

// búsqueda
await page.fill('#searchInput', 'confidenciales');
await page.press('#searchInput', 'Enter');
await page.waitForTimeout(600);
check((await page.textContent('#searchCount')).includes('/4'), 'búsqueda encuentra 4 coincidencias');

// objetos de edición vía API en página normal y rotada
const res = await page.evaluate(async () => {
  const A = window.miniAcrobat;
  const S = A.S;
  A.addObject(0, { type: 'text', x: 60, y: 300, w: 10, h: 17, nowrap: true, text: 'Hola mundo añadido', size: 14, font: 'helv', color: '#c8102e' }, { select: false });
  A.addObject(0, { type: 'rect', x: 50, y: 250, w: 200, h: 100, stroke: '#1473e6', fill: null, width: 2, opacity: 1 }, { select: false });
  A.addObject(0, { type: 'ink', strokes: [[[100, 400], [150, 420], [200, 380]]], stroke: '#000000', width: 2, opacity: 1 }, { select: false });
  A.addObject(0, { type: 'markup', kind: 'highlight', rects: [{ x: 60, y: 130, w: 200, h: 14 }], color: '#ffe500', opacity: 0.45, comment: 'Revisar', author: 'Test' }, { select: false });
  A.addObject(0, { type: 'note', x: 400, y: 100, w: 20, h: 20, text: 'Nota de prueba', color: '#ffd84d', author: 'Test' }, { select: false });
  A.addObject(0, { type: 'stamp', x: 300, y: 500, w: 150, h: 46, text: 'APROBADO', sub: 'Test · hoy', color: '#1e8e3e', opacity: 0.9 }, { select: false });
  A.addObject(0, { type: 'link', x: 60, y: 600, w: 120, h: 20, url: 'https://example.com' }, { select: false });
  A.addObject(0, { type: 'field', ftype: 'text', x: 300, y: 650, w: 150, h: 22, name: 'nuevoCampo' }, { select: false });
  A.addObject(0, { type: 'mark', kind: 'check', x: 300, y: 700, w: 16, h: 16, stroke: '#111111' }, { select: false });
  A.addObject(2, { type: 'text', x: 100, y: 100, w: 10, h: 17, nowrap: true, text: 'Texto en pagina rotada', size: 14, font: 'helv', color: '#000000' }, { select: false });
  const bytes = await A.buildOutput();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const p1 = await pdf.getPage(1);
  const tc = await p1.getTextContent();
  const added = tc.items.find((i) => i.str.includes('Hola mundo'));
  const vp = p1.getViewport({ scale: 1 });
  const pos = added ? pdfjsLib.Util.applyTransform([added.transform[4], added.transform[5]], vp.transform) : null;
  const annots = await p1.getAnnotations();
  const p3 = await pdf.getPage(3);
  const tc3 = await p3.getTextContent();
  const rot = tc3.items.find((i) => i.str.includes('rotada'));
  const vp3 = p3.getViewport({ scale: 1 });
  const pos3 = rot ? pdfjsLib.Util.applyTransform([rot.transform[4], rot.transform[5]], vp3.transform) : null;
  const fields = await pdf.getFieldObjects();
  return { pos, subtypes: annots.map((a) => a.subtype), pos3, fields: Object.keys(fields || {}), size: bytes.length };
});
console.log(JSON.stringify(res));
await page.evaluate(() => document.querySelector('#viewer').scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, '02b-objetos.png') });
check(res.pos && Math.abs(res.pos[0] - 60) < 1 && Math.abs(res.pos[1] - (300 + 0.9465 * 14)) < 1.5, 'texto añadido en la posición correcta');
check(res.pos3 && Math.abs(res.pos3[0] - 100) < 1 && Math.abs(res.pos3[1] - (100 + 0.9465 * 14)) < 1.5, 'texto en página rotada en la posición correcta');
check(['Text', 'Highlight', 'Link'].every((s) => res.subtypes.includes(s)), 'notas, resaltado y enlace como anotaciones');
check(res.fields.includes('nuevoCampo') && res.fields.includes('nombre'), 'campos de formulario nuevos y existentes');

// operaciones de páginas con remapeo de objetos
const ops = await page.evaluate(async () => {
  const A = window.miniAcrobat; const S = A.S;
  await A.rotatePages([0], 90);
  const afterRot = { n: S.pages.length, rot: S.pages[0].rot, objs: S.objects[0].length };
  await A.movePages([0], 3);
  const afterMove = { firstObjs: S.objects[0].length, movedObjs: S.objects[2].length };
  await A.duplicatePages([2]);
  const afterDup = { n: S.pages.length, dupObjs: S.objects[3].length };
  return { afterRot, afterMove, afterDup };
});
console.log(JSON.stringify(ops));
check(ops.afterRot.rot === 90 && ops.afterRot.objs === 9, 'rotar página conserva objetos');
check(ops.afterMove.movedObjs === 9 && ops.afterMove.firstObjs === 0, 'mover página mueve sus objetos');
check(ops.afterDup.n === 5 && ops.afterDup.dupObjs === 9, 'duplicar página duplica objetos');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, '03-editado.png') });

// deshacer
const undone = await page.evaluate(async () => { const A = window.miniAcrobat; await A.undo(); return A.S.pages.length; });
check(undone === 4, 'deshacer revierte duplicado');

// redacción
const red = await page.evaluate(async () => {
  const A = window.miniAcrobat; const S = A.S;
  const hits = await A.findAll('juan@example.com', {});
  for (const h of hits) for (const r of h.rects) S.objects[h.page].push({ id: 'r' + Math.random(), page: h.page, type: 'redact', ...r });
  await A.applyRedactions({ confirm: false });
  const after = await A.findAll('juan@example.com', {});
  return { before: hits.length, after: after.length };
});
check(red.before === 4 && red.after === 0, 'redacción elimina el texto (' + JSON.stringify(red) + ')');

// cifrado
const enc = await page.evaluate(async () => {
  const A = window.miniAcrobat;
  A.S.encryption = { userPassword: 'abc', ownerPassword: 'xyz', permissions: { printing: 'highResolution' } };
  const b = await A.buildOutput();
  A.S.encryption = null;
  let opened = false;
  try { await pdfjsLib.getDocument({ data: b.slice() }).promise; opened = true; } catch (e) { opened = e.name; }
  const ok = await pdfjsLib.getDocument({ data: b.slice(), password: 'abc' }).promise.then((d) => d.numPages);
  return { opened, ok };
});
check(enc.opened === 'PasswordException' && enc.ok === 4, 'cifrado con contraseña');

// interfaz: pestañas, herramientas y dibujo con el mouse
await page.click('#tabs button:has-text("Comentar")');
await page.click('.rb[data-tool="rect"]');
const box = await page.locator('.page').first().boundingBox();
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 250, box.y + 200, { steps: 5 });
await page.mouse.up();
const nRect = await page.evaluate(() => window.miniAcrobat.S.objects[0].filter((o) => o.type === 'rect').length);
check(nRect >= 1, 'dibujar rectángulo con el mouse');
await page.click('#tabs button:has-text("Editar")');
await page.click('.rb[data-cmd="watermark"]');
await page.waitForSelector('.modal');
await page.click('.modal .btn.primary');
await page.waitForTimeout(1500);
check(!(await page.$('.modal')), 'marca de agua aplicada desde el diálogo');
for (const tab of ['Organizar', 'Rellenar y firmar', 'Formularios', 'Proteger', 'Convertir', 'Herramientas', 'Inicio']) {
  await page.click(`#tabs button:has-text("${tab}")`);
}
await page.click('#tabs button:has-text("Organizar")');
await page.click('.rb[data-cmd="organize"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, '04-organizar.png') });
await page.keyboard.press('Escape');
for (const s of ['bookmarks', 'comments', 'attachments', 'layers', 'thumbs']) {
  await page.click(`#sideTabs button[title]:nth-child(${['thumbs', 'bookmarks', 'comments', 'attachments', 'layers'].indexOf(s) + 1})`);
  await page.waitForTimeout(200);
}
await page.screenshot({ path: path.join(out, '05-final.png') });

// guardar descarga un PDF válido
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
const saved = await dl.path();
const { readFileSync } = await import('node:fs');
const sd = await PDFDocument.load(readFileSync(saved));
check(sd.getPageCount() === 4, 'guardar genera un PDF válido de 4 páginas');
writeFileSync(path.join(out, 'guardado.pdf'), readFileSync(saved));

await browser.close();
const real = errors.filter((e) => !/Failed to load resource|cmaps|standard_fonts|net::ERR/.test(e));
if (real.length) { console.log('\nErrores:\n' + real.join('\n')); process.exit(1); }
console.log('\nTodo OK');
