// Offline-Speicher der Rosenkranz-App. Version wird beim Bauen gesetzt.
var CACHE = 'rosenkranz-db12f2f212';
var FILES = [
"./",
"app.js",
"fonts/eb-garamond-latin-400-italic.woff2",
"fonts/eb-garamond-latin-400-normal.woff2",
"fonts/eb-garamond-latin-500-normal.woff2",
"fonts/eb-garamond-latin-600-normal.woff2",
"fonts/eb-garamond-latin-ext-400-italic.woff2",
"fonts/eb-garamond-latin-ext-400-normal.woff2",
"fonts/eb-garamond-latin-ext-500-normal.woff2",
"fonts/eb-garamond-latin-ext-600-normal.woff2",
"fonts/source-sans-3-latin-400-normal.woff2",
"fonts/source-sans-3-latin-600-normal.woff2",
"fonts/source-sans-3-latin-ext-400-normal.woff2",
"fonts/source-sans-3-latin-ext-600-normal.woff2",
"icons/apple-touch-icon.png",
"icons/favicon-32.png",
"icons/icon-192.png",
"icons/icon-512.png",
"icons/icon.svg",
"img/freud-1-a.jpg",
"img/freud-1-b.jpg",
"img/freud-1-c.jpg",
"img/freud-2-a.jpg",
"img/freud-2-b.jpg",
"img/freud-2-c.jpg",
"img/freud-3-a.jpg",
"img/freud-3-b.jpg",
"img/freud-3-c.jpg",
"img/freud-4-a.jpg",
"img/freud-4-b.jpg",
"img/freud-4-c.jpg",
"img/freud-5-a.jpg",
"img/freud-5-b.jpg",
"img/freud-5-c.jpg",
"img/glor-1-a.jpg",
"img/glor-1-b.jpg",
"img/glor-1-c.jpg",
"img/glor-2-a.jpg",
"img/glor-2-b.jpg",
"img/glor-2-c.jpg",
"img/glor-3-a.jpg",
"img/glor-3-b.jpg",
"img/glor-3-c.jpg",
"img/glor-4-a.jpg",
"img/glor-4-b.jpg",
"img/glor-4-c.jpg",
"img/glor-5-a.jpg",
"img/glor-5-b.jpg",
"img/glor-5-c.jpg",
"img/licht-1-a.jpg",
"img/licht-1-b.jpg",
"img/licht-1-c.jpg",
"img/licht-2-a.jpg",
"img/licht-2-b.jpg",
"img/licht-2-c.jpg",
"img/licht-3-a.jpg",
"img/licht-3-b.jpg",
"img/licht-3-c.jpg",
"img/licht-4-a.jpg",
"img/licht-4-b.jpg",
"img/licht-4-c.jpg",
"img/licht-5-a.jpg",
"img/licht-5-b.jpg",
"img/licht-5-c.jpg",
"img/schmerz-1-a.jpg",
"img/schmerz-1-b.jpg",
"img/schmerz-1-c.jpg",
"img/schmerz-2-a.jpg",
"img/schmerz-2-b.jpg",
"img/schmerz-2-c.jpg",
"img/schmerz-3-a.jpg",
"img/schmerz-3-b.jpg",
"img/schmerz-3-c.jpg",
"img/schmerz-4-a.jpg",
"img/schmerz-4-b.jpg",
"img/schmerz-4-c.jpg",
"img/schmerz-5-a.jpg",
"img/schmerz-5-b.jpg",
"img/schmerz-5-c.jpg",
"index.html",
"manifest.webmanifest"
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('rosenkranz-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    // Ganze App aus einem Guss: neue Versionen gelten ab dem nächsten Start
    e.respondWith(caches.match('./').then(function (hit) { return hit || fetch(e.request); }));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || fetch(e.request); }));
});
