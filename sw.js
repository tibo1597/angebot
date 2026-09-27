// Erzeugt von werkzeuge/sw-bauen.mjs — nicht von Hand ändern.
// Hält die App offline bereit. Es werden nur die eigenen Dateien zwischengespeichert;
// Angebote und Einseiter landen nie im Cache.
const VERSION = 'eed20b95ebcf';
const DATEIEN = [
  "./",
  "app.css",
  "app.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "kern/bilder.js",
  "kern/bildpunkte.js",
  "kern/extraktor.js",
  "kern/highlights.js",
  "kern/import.js",
  "kern/modell.js",
  "kern/parser.js",
  "kern/renderer.js",
  "kern/validator.js",
  "kern/zahlen.js",
  "manifest.webmanifest",
  "vendor/fontkit.es.min.js",
  "vendor/fonts/Inter-Bold.ttf",
  "vendor/fonts/Inter-Light.ttf",
  "vendor/fonts/Inter-Medium.ttf",
  "vendor/fonts/Inter-Regular.ttf",
  "vendor/pako-inflate.mjs",
  "vendor/pdf-lib.esm.min.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== VERSION).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(t => t ?? fetch(e.request)));
});
