// Genera mini_acrobat.html: un único archivo con todas las librerías embebidas.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const pdfjs = read('./node_modules/pdfjs-dist/build/pdf.min.js');
const worker = read('./node_modules/pdfjs-dist/build/pdf.worker.min.js');
const pdflib = read('./node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js');
const viewerCss = read('./node_modules/pdfjs-dist/web/pdf_viewer.css');

// Solo las reglas de capa de texto y de anotaciones/formularios de pdf.js.
const lines = viewerCss.split('\n');
const start = lines.findIndex((l) => l.startsWith(':root'));
const end = lines.findIndex((l, i) => i > 400 && l.startsWith(':root'));
const layerCss = lines.slice(start, end).join('\n');

const appFiles = ['core.js', 'viewer.js', 'objects.js', 'tools.js', 'pages.js', 'docops.js', 'export.js', 'ui.js'];
const app = appFiles.map((f) => `// ---- ${f} ----\n` + read(`./src/${f}`)).join('\n');

let html = read('./src/index.html');
const parts = {
  '/*LAYER_CSS*/': layerCss,
  '/*APP_CSS*/': read('./src/styles.css'),
  '<!--LIBS-->': [
    `<script>${safe(pdfjs)}</script>`,
    `<script type="text/plain" id="pdfjs-worker-src">${safe(worker)}</script>`,
    `<script>${safe(pdflib)}</script>`,
  ].join('\n'),
  '<!--APP-->': `<script>\n(function(){\n'use strict';\n${safe(app)}\n})();\n</script>`,
};
for (const [k, v] of Object.entries(parts)) {
  if (!html.includes(k)) throw new Error('Falta marcador ' + k);
  html = html.split(k).join(v);
}
writeFileSync(new URL('./mini_acrobat.html', import.meta.url), html);
console.log('mini_acrobat.html generado (' + (html.length / 1024 / 1024).toFixed(2) + ' MB)');
