// Recorre los comandos y diálogos principales verificando que no haya errores.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch { /* siguiente */ } }
const PDFLib = require('../node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js');
const { PDFDocument, StandardFonts } = PDFLib;
const out = path.join(root, 'test-output');
mkdirSync(out, { recursive: true });

const doc = await PDFDocument.create();
const f = await doc.embedFont(StandardFonts.Helvetica);
const fb = await doc.embedFont(StandardFonts.HelveticaBold);
for (let i = 0; i < 3; i++) {
  const p = doc.addPage([595, 842]);
  p.drawText('Capitulo ' + (i + 1), { x: 60, y: 770, size: 24, font: fb });
  p.drawText('Nombre: ________________', { x: 60, y: 700, size: 12, font: f });
  p.drawText('Texto del capitulo numero ' + (i + 1) + ' con contenido.', { x: 60, y: 680, size: 12, font: f });
}
const tf = doc.getForm().createTextField('campo1'); tf.addToPage(doc.getPage(0), { x: 60, y: 600, width: 200, height: 22 }); tf.setText('valor inicial');
const sample = await doc.save();
writeFileSync(path.join(out, 'muestra.pdf'), sample);
const sample2 = path.join(out, 'muestra2.pdf');
const d2 = await PDFDocument.load(sample); d2.getPage(1).drawText('Texto agregado en la revision', { x: 60, y: 640, size: 12, font: await d2.embedFont(StandardFonts.Helvetica) });
writeFileSync(sample2, await d2.save());
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJgYGBAQAKBQEBnd1q+gAAAABJRU5ErkJggg==', 'base64');
const pngPath = path.join(out, 'img.png'); writeFileSync(pngPath, png);

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 850 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') { errors.push('console: ' + m.text()); console.log('  [console] ' + m.text().slice(0, 200)); } });
await page.goto(pathToFileURL(path.join(root, 'mini_acrobat.html')).href);
await page.waitForFunction(() => window.miniAcrobat);
await page.setInputFiles('#fileInput', path.join(out, 'muestra.pdf'));
await page.waitForSelector('.page canvas[width]:not([width="0"])');
await page.waitForTimeout(500);

const downloads = [];
page.on('requestfailed', (r) => console.log('  [requestfailed] ' + r.url().slice(0, 150)));
page.on('download', async (d) => downloads.push(d.suggestedFilename()));
let chooserFiles = [path.join(out, 'muestra2.pdf')];
page.on('filechooser', async (fc) => { await fc.setFiles(chooserFiles); });

const cmd = (name) => page.evaluate((n) => { window.__cmdDone = false; Promise.resolve(window.miniAcrobat.CMDS[n]()).finally(() => { window.__cmdDone = true; }); }, name);
const waitDone = () => page.waitForFunction(() => window.__cmdDone === true, null, { timeout: 60000 });
const primary = async () => { await page.waitForSelector('.modal'); await page.click('.modal footer .btn.primary'); };
const step = async (label, fn) => {
  const before = errors.length;
  try { await fn(); await page.waitForTimeout(150); console.log((errors.length > before ? '✗ ' : '✓ ') + label); }
  catch (e) { await page.screenshot({ path: path.join(out, 'fallo-' + label.replace(/\W+/g, '_') + '.png') }); errors.push(label + ': ' + e.message); console.log('✗ ' + label + ' — ' + e.message); }
  if (await page.$('.modal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
};
const flow = (label, name, { confirm = true, extra } = {}) => step(label, async () => { await cmd(name); if (confirm) await primary(); if (extra) await extra(); await waitDone(); });

await flow('numerar páginas', 'numbers');
await flow('numeración Bates', 'bates');
await step('encabezado y pie (con texto)', async () => { await cmd('header'); await page.waitForSelector('.modal'); await page.waitForTimeout(120); await page.fill('.modal [name=hc]', 'Encabezado {archivo}'); await page.click('.modal footer .btn.primary'); await waitDone(); });
await flow('marca de agua', 'watermark');
await flow('propiedades', 'properties', { extra: async () => {} });
await flow('recortar márgenes', 'cropMargins');
await flow('tamaño de página', 'resize');
await flow('página en blanco', 'blank');
await flow('insertar archivo', 'insertFile');
await flow('extraer', 'extract');
await flow('dividir', 'split');
await flow('reemplazar páginas', 'replace');
await step('invertir orden', async () => { await cmd('reverse'); await waitDone(); });
await step('duplicar página', async () => { await cmd('dupPages'); await waitDone(); });
await step('rotar', async () => { await cmd('rotr'); await waitDone(); });
await step('eliminar página', async () => { await cmd('delPages'); await primary(); await waitDone(); });
await step('detectar campos', async () => { await cmd('detectFields'); await waitDone(); });
await flow('exportar datos de formulario', 'exportData');
await step('importar datos', async () => { writeFileSync(path.join(out, 'datos.json'), JSON.stringify({ campo1: 'importado' })); chooserFiles = [path.join(out, 'datos.json')]; await cmd('importData'); await waitDone(); chooserFiles = [sample2]; });
await step('borrar formulario', async () => { await cmd('clearForm'); await primary(); await waitDone(); });
await step('aplanar formulario', async () => { await cmd('flattenForm'); await primary(); await waitDone(); });
await step('proteger (con clave)', async () => { await cmd('encrypt'); await page.waitForSelector('.modal'); await page.waitForTimeout(120); await page.fill('.modal [name=user]', 'clave'); await page.fill('.modal [name=user2]', 'clave'); await page.click('.modal footer .btn.primary'); await waitDone(); });
await step('quitar seguridad', async () => { await cmd('removeSecurity'); await waitDone(); });
await step('buscar y redactar', async () => { await cmd('searchRedact'); await page.waitForSelector('.modal'); await page.waitForTimeout(120); await page.fill('.modal [name=text]', 'contenido'); await page.click('.modal footer .btn.primary'); await primary(); await waitDone(); });
await flow('aplicar redacciones', 'applyRedactions');
await flow('quitar información oculta', 'sanitize');
await step('exportar a Word', async () => { await cmd('toWord'); await waitDone(); });
await step('exportar a CSV', async () => { await cmd('toExcel'); await waitDone(); });
await flow('exportar a imágenes', 'toImages');
await step('exportar a texto', async () => { await cmd('toText'); await waitDone(); });
await step('exportar a HTML', async () => { await cmd('toHtml'); await waitDone(); });
await flow('optimizar', 'optimize', { extra: async () => { await primary(); } });
await step('marcadores automáticos', async () => { await cmd('autoBookmarks'); await primary(); await waitDone(); });
await flow('agregar marcador', 'addBookmark');
await step('adjuntar archivo', async () => { chooserFiles = [pngPath]; await cmd('attach'); await waitDone(); chooserFiles = [sample2]; });
await step('comparar', async () => { await cmd('compare'); await page.waitForSelector('.modal'); const t = await page.textContent('.modal'); if (!/revision/.test(t)) throw new Error('no detectó el cambio: ' + t.slice(0, 200)); });
await flow('PDF/A', 'pdfa');
await step('propiedades (lectura)', async () => { await cmd('properties'); await page.waitForSelector('.modal'); });
await step('preferencias', async () => { await cmd('prefs'); await page.waitForSelector('.modal'); });
await step('ayuda', async () => { await cmd('help'); await page.waitForSelector('.modal'); });
await step('elegir sello', async () => { await cmd('stampPick'); await page.waitForSelector('.stamp-grid button'); await page.click('.stamp-grid button'); await waitDone(); });
await step('colocar sello', async () => { const b = await page.locator('.page').first().boundingBox(); await page.mouse.click(b.x + 200, b.y + 300); });
await step('firma dibujada', async () => {
  await cmd('sigManage'); await page.waitForSelector('.sigpad');
  const b = await page.locator('.sigpad').first().boundingBox();
  await page.mouse.move(b.x + 30, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + 200, b.y + 60, { steps: 8 }); await page.mouse.move(b.x + 300, b.y + 120, { steps: 8 }); await page.mouse.up();
  await page.click('.modal footer .btn.primary'); await waitDone();
  const pb = await page.locator('.page').first().boundingBox(); await page.mouse.click(pb.x + 300, pb.y + 500);
});
await step('reabrir muestra', async () => { await page.evaluate(() => { window.miniAcrobat.S.dirty = false; }); await page.setInputFiles('#fileInput', path.join(out, 'muestra.pdf')); await page.waitForTimeout(1200); });
await step('herramienta editar texto', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('edittext'));
  await page.evaluate(() => document.querySelector('#viewer').scrollTo(0, 0));
  await page.waitForTimeout(300);
  const span = page.locator('.page').first().locator('.textLayer span').filter({ hasText: 'Capitulo' }).first();
  const sb = await span.boundingBox();
  await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForSelector('.tx-editor');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Capítulo editado');
  await page.keyboard.press('Escape');
  const t = await page.evaluate(() => window.miniAcrobat.S.objects.flat().find((o) => o.edit)?.runs.map((r) => r.t).join(''));
  if (t !== 'Capítulo editado') throw new Error('texto: ' + t);
});
await step('resaltar selección', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('highlight'));
  const span = page.locator('.page').first().locator('.textLayer span').filter({ hasText: 'Texto del capitulo' }).first();
  const b = await span.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => window.miniAcrobat.S.objects.flat().filter((o) => o.type === 'markup').length);
  if (n < 1) throw new Error('sin resaltado');
});
await step('nota', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('note'));
  const b = await page.locator('.page').first().boundingBox(); await page.mouse.click(b.x + 500, b.y + 120);
  await page.waitForSelector('.note-pop textarea'); await page.fill('.note-pop textarea', 'Comentario de prueba'); await page.click('.note-pop .btn');
});
await step('texto nuevo con teclado', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('text'));
  const b = await page.locator('.page').first().boundingBox(); await page.mouse.click(b.x + 100, b.y + 450);
  await page.waitForTimeout(150); await page.keyboard.type('Escrito a mano'); await page.mouse.click(b.x + 400, b.y + 700);
});
await step('mover objeto con arrastre', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('select'));
  const el = page.locator('.obj.text').first(); const b = await el.boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 60, { steps: 5 }); await page.mouse.up();
});
await step('dibujo libre', async () => {
  await page.evaluate(() => window.miniAcrobat.setTool('ink'));
  const b = await page.locator('.page').first().boundingBox();
  await page.mouse.move(b.x + 100, b.y + 600); await page.mouse.down(); await page.mouse.move(b.x + 200, b.y + 650, { steps: 10 }); await page.mouse.up();
});
await step('organizador', async () => { await cmd('organize'); await waitDone(); await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, '10-organizador.png') }); await page.keyboard.press('Escape'); });
await page.evaluate(() => window.miniAcrobat.setTool('select'));
await page.evaluate(() => document.querySelector('#viewer').scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, '11-flujo.png') });
await step('guardar como', async () => { await cmd('saveAs'); await primary(); await waitDone(); });
await page.waitForTimeout(800);
console.log('Descargas:', downloads.join(', '));
await step('combinar', async () => { chooserFiles = [path.join(out, 'muestra.pdf'), sample2]; await cmd('merge'); await page.waitForSelector('.file-row'); await page.click('.modal button:has-text("Agregar archivos")'); await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 3); await page.waitForTimeout(300); await page.click('.modal footer .btn.primary'); await waitDone(); });
console.log('Páginas tras combinar:', await page.evaluate(() => window.miniAcrobat.S.pages.length));
await step('crear desde texto', async () => { await cmd('fromText'); await page.waitForSelector('.modal'); await page.waitForTimeout(120); await page.fill('.modal textarea', 'Hola\nMundo ñandú'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(300); if (await page.$('.modal')) await primary(); await waitDone(); });
await step('nuevo en blanco', async () => { await cmd('newBlank'); await primary(); await page.waitForTimeout(300); if (await page.$('.modal')) await primary(); await waitDone(); });
await browser.close();
const real = errors.filter((e) => !/Failed to load resource|cmaps|standard_fonts|net::ERR/.test(e));
if (real.length) { console.log('\nErrores:\n' + real.join('\n')); process.exit(1); }
console.log('\nTodo OK');
