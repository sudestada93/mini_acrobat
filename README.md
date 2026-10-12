# Mini Acrobat

Editor de PDF completo en **un único archivo HTML**: `mini_acrobat.html`.
Descargalo y abrilo con doble clic en Chrome, Edge o Firefox. No necesita servidor ni instalación,
funciona sin internet y los documentos nunca salen de tu equipo.

> El único extra que usa internet es el **OCR**: descarga el motor Tesseract la primera vez que lo usás.

## Funciones

| Área | Qué incluye |
|---|---|
| **Ver** | Miniaturas, zoom (ajustar ancho / página / %), una o dos páginas, modo noche, presentación a pantalla completa, búsqueda (con mayúsculas/palabra completa), marcadores, capas, lectura en voz alta, imprimir |
| **Comentar** | Notas adhesivas, resaltar / subrayar / tachar texto, resaltar área, cuadros de texto, dibujo libre, rectángulos, elipses, líneas, flechas, sellos (predefinidos, dinámicos con nombre y fecha, personalizados o desde imagen), herramienta de medición con escala, lista de comentarios. Se guardan como anotaciones editables (o aplanados, a elección) |
| **Editar** | Editar texto existente (clic sobre el texto), añadir texto e imágenes, enlaces (a web o a página), corrector, marca de agua (texto o imagen, centrada o en mosaico), encabezado y pie, numeración de páginas, numeración Bates, recortar páginas, cambiar tamaño de página |
| **Organizar** | Vista de organización con arrastrar y soltar, girar, eliminar, duplicar, insertar páginas en blanco o desde PDF/imágenes, reemplazar, extraer, dividir (cada N páginas, rangos, tamaño o marcadores), combinar archivos, invertir orden |
| **Rellenar y firmar** | Completar formularios, firmas e iniciales (dibujadas, escritas o desde imagen, se recuerdan), fecha, tildes, cruces y puntos |
| **Formularios** | Crear campos de texto, casillas, botones de opción, listas desplegables y cuadros de lista; detectar campos automáticamente; exportar / importar datos (JSON, CSV); borrar valores; aplanar; eliminar campos |
| **Proteger** | Contraseña de apertura y permisos (AES-256 / AES-128), abrir PDF protegidos, quitar seguridad, redacción real (marcar áreas o buscar texto/patrones: correos, teléfonos, DNI/CUIT, tarjetas, fechas), quitar información oculta (metadatos, JavaScript, adjuntos, comentarios) |
| **Convertir** | PDF → Word (.docx), Excel (.csv), imágenes (PNG/JPG/WebP), texto, HTML; PDF/A; crear PDF en blanco, desde imágenes o desde texto |
| **Herramientas** | OCR (texto buscable en escaneos), optimizar (recomprime imágenes y elimina objetos sin uso), compresión máxima, comparar dos versiones, adjuntar archivos, marcadores manuales y automáticos, propiedades y metadatos |

Además: deshacer/rehacer ilimitado por sesión, copiar/pegar objetos, pegar imágenes desde el portapapeles,
arrastrar archivos a la ventana, tema claro/oscuro y atajos de teclado (botón **Ayuda**).

## Limitaciones conocidas

- *Editar texto* reemplaza el fragmento: tapa el original con el color de fondo y escribe el nuevo texto encima
  (como la mayoría de los editores web). Usa las fuentes estándar Helvetica, Times o Courier.
- La redacción convierte en imagen las páginas afectadas para garantizar que el contenido no pueda recuperarse.
- No hay firma digital con certificado (PKCS#7); las firmas son visuales.
- No convierte desde Word/Excel/PowerPoint hacia PDF.

## Desarrollo

El código fuente está en `src/` y `build.mjs` lo une con las librerías en un solo HTML.

```bash
npm install
npm run build   # genera mini_acrobat.html
npm test        # build + pruebas en Chromium con Playwright
```

Librerías embebidas: [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache 2.0) para mostrar los PDF
y [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) 2.11.1 (MIT) para modificarlos y cifrarlos.
