// Offline-Speicher der Rosenkranz-App. Version wird beim Bauen gesetzt.
// Kern (Seite, Code, Schriften, Symbole) wird bei der Installation komplett gespeichert.
// Bilder liegen in einem eigenen Speicher und werden einzeln nachgeladen; ein
// Abbruch (z. B. App geschlossen) setzt beim nächsten Start dort fort.
var CORE_CACHE = 'rosenkranz-kern-a0cb699883';
var IMG_CACHE = 'rosenkranz-bilder-1';
var CORE = [
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
"index.html",
"manifest.webmanifest"
];
var IMGS = [
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
"img/schmerz-5-c.jpg"
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CORE_CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf('rosenkranz-') === 0 && k !== CORE_CACHE && k !== IMG_CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }).then(function () { fill(); }));
});

var filling = null;
function notify() {
  self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: 'progress' }); }); });
}
function fill() {
  if (filling) return filling;
  filling = caches.open(IMG_CACHE).then(function (cache) {
    var todo = [];
    return Promise.all(IMGS.map(function (u) {
      return cache.match(u).then(function (hit) { if (!hit) todo.push(u); });
    })).then(function () {
      var i = 0;
      function worker() {
        if (i >= todo.length) return Promise.resolve();
        var u = todo[i++];
        var ctl = self.AbortController ? new AbortController() : null;
        var t = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : null;
        return fetch(u, ctl ? { cache: 'no-cache', signal: ctl.signal } : { cache: 'no-cache' }).then(function (r) {
          clearTimeout(t);
          if (r.ok) return cache.put(u, r).then(notify);
        }).catch(function () { clearTimeout(t); }).then(worker);
      }
      return Promise.all([worker(), worker(), worker()]);
    });
  }).then(function () { filling = null; notify(); }, function () { filling = null; });
  return filling;
}

self.addEventListener('message', function (e) {
  if (e.data === 'fill') e.waitUntil(fill());
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
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(e.request).then(function (r) {
      // Angeschaute Bilder sofort mitspeichern
      if (r.ok && url.pathname.indexOf('/img/') !== -1) {
        var copy = r.clone();
        caches.open(IMG_CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return r;
    });
  }));
});
