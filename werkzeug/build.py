# Baut die Web-App (PWA) aus den Entwurfsdateien des Canvas.
# Aufruf: python3 build.py  ->  Ergebnis in dist/
import hashlib, json, os, re, shutil, glob, asyncio
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = os.path.dirname(HERE)
PROJ = os.path.join(SCR, 'rosenkranz', 'project')
BILDER = os.path.join(SCR, 'rosenkranz', 'bilder')
SRC = os.path.join(HERE, 'src')
NPM = os.path.join(HERE, 'npm')
DIST = os.path.join(HERE, 'dist')

PERSIST = {
    'Main': ['lang', 'mode', 'theme', 'lit', 'pronStyle', 'alt', 'trad', 'cal62'],
    'Gebet': ['hideText'],
}


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def extract(name):
    s = read(os.path.join(PROJ, name + '.dc.html'))
    tpl = s[s.index('<x-dc>') + 6:s.index('</x-dc>')]
    tpl = re.sub(r'<helmet>.*?</helmet>', '', tpl, flags=re.S)
    m = re.search(r'<script type="text/x-dc" data-dc-script[^>]*>(.*?)</script>', s, flags=re.S)
    return tpl, m.group(1)


def must_replace(s, old, new, count=1):
    assert old in s, 'nicht gefunden: ' + old[:80]
    return s.replace(old, new, count)


# Bild-IDs auf Dateinamen abbilden
gebet_src = read(os.path.join(PROJ, 'Gebet.dc.html'))
BLOB2FILE = {bid: key for key, bid in re.findall(r'"([a-z]+-\d-[abc])":"/_blob/([0-9a-f]{32})"', gebet_src)}
assert len(BLOB2FILE) == 60, len(BLOB2FILE)


def blobs(s):
    def rep(m):
        return "'img/" + BLOB2FILE[m.group(1)] + ".jpg'"
    s = re.sub(r"['\"]/_blob/([0-9a-f]{32})['\"]", rep, s)
    assert '/_blob/' not in s
    return s


shutil.rmtree(DIST, ignore_errors=True)
os.makedirs(DIST)

# ---------- Vorlagen und Logik ----------
main_tpl, main_js = extract('Main')
gebet_tpl, gebet_js = extract('Gebet')

# Startseite: volle Breite auf dem Handy, sichere Ränder (Notch, Home-Leiste)
main_tpl = must_replace(main_tpl, 'style="width: 390px; min-height: 2000px; box-sizing: border-box;',
                        'style="width: 100%; max-width: 480px; min-height: 100vh; box-sizing: border-box;')
main_tpl = must_replace(main_tpl, 'gap: 28px; padding: 20px 20px 40px; position: relative',
                        'gap: 28px; padding: calc(20px + env(safe-area-inset-top, 0px)) 20px calc(40px + env(safe-area-inset-bottom, 0px)); position: relative')
main_tpl = must_replace(main_tpl, 'z-index: 20; display: flex; justify-content: center; background: {{c.paper}}"',
                        'z-index: 20; display: flex; justify-content: center; box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); background: {{c.paper}}"')
main_tpl = re.sub(r'(role="dialog" aria-modal="true" aria-labelledby="kalender-titel" style="[^"]*?)padding: 20px 20px 40px',
                  r'\1padding: calc(20px + env(safe-area-inset-top, 0px)) 20px calc(40px + env(safe-area-inset-bottom, 0px))', main_tpl)
assert 'calc(20px + env(safe-area-inset-top, 0px)) 20px calc(40px' in main_tpl
main_tpl = must_replace(main_tpl, 'padding: 76px 12px 12px;',
                        'padding: calc(76px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px));')

# Zeit im Kirchenjahr aus dem heutigen Datum, Beispieltage nur auf den Canvas-Varianten
main_js = must_replace(main_js, "var season = this.props.season ?? 'jahreskreis';",
                       "var season = this.props.season ?? autoSeason(new Date());")
main_js = must_replace(main_js, "if (season === 'weihnachtszeit') hd =", "if (this.props.season === 'weihnachtszeit') hd =")
main_js = must_replace(main_js, "if (season === 'osterzeit') { var ed", "if (this.props.season === 'osterzeit') { var ed")
main_js = must_replace(main_js, 'seasonPlaceholder: s.ph,', "seasonPlaceholder: '',")
main_js = """function autoSeason(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var y = d.getFullYear();
  var e = new Date(y, 0, 6); var bap = new Date(y, 0, 6 + (7 - e.getDay()));
  if (d >= new Date(y, 11, 25) || d <= bap) return 'weihnachtszeit';
  var easter = easterDate(y);
  var pent = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 49);
  if (d >= easter && d <= pent) return 'osterzeit';
  return 'jahreskreis';
}
""" + main_js

# Gebet: Höhe des sichtbaren Bereichs statt 100vh (Safari-Leisten)
gebet_js = must_replace(gebet_js, "rootH: P.vollbild ? '100vh' : '844px'", "rootH: P.vollbild ? '100%' : '844px'")

main_tpl, main_js, gebet_tpl, gebet_js = map(blobs, (main_tpl, main_js, gebet_tpl, gebet_js))

runtime = read(os.path.join(SRC, 'runtime.js'))
app_js = runtime + '\n' + '\n'.join(
    "DC.register('%s', 'tpl-%s', (function () {\n%s\nreturn Component;\n})(), %s);" % (n, n, js, json.dumps(PERSIST[n]))
    for n, js in (('Gebet', gebet_js), ('Main', main_js))
) + """
DC.mount('Main', document.getElementById('app'));

// Hintergrund und Statusleiste folgen dem Erscheinungsbild der App
(function () {
  var app = document.getElementById('app');
  var meta = document.querySelector('meta[name="theme-color"]');
  function sync() {
    var r = app.firstElementChild;
    var bg = r && r.style.background;
    if (bg) { document.documentElement.style.setProperty('--bg', bg); if (meta) meta.setAttribute('content', bg); }
  }
  new MutationObserver(sync).observe(app, { childList: true });
  sync();
})();

// Offline-Betrieb
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
"""
write(os.path.join(DIST, 'app.js'), app_js)

# ---------- Schriften (selbst gehostet, keine Anfragen an Google) ----------
font_css = []
def fonts(pkg, family_file, specs):
    base = os.path.join(NPM, pkg)
    for spec in specs:
        css = read(os.path.join(base, spec + '.css'))
        for block in re.findall(r'/\* [^*]*?-(?:latin|latin-ext)-[^*]*\*/\s*@font-face \{.*?\}', css, flags=re.S):
            fn = re.search(r'url\(\./files/([^)]+?\.woff2)\)', block).group(1)
            os.makedirs(os.path.join(DIST, 'fonts'), exist_ok=True)
            shutil.copy(os.path.join(base, 'files', fn), os.path.join(DIST, 'fonts', fn))
            block = re.sub(r'src: [^;]+;', "src: url(fonts/%s) format('woff2');" % fn, block)
            font_css.append(block)
fonts('fontsource-eb-garamond-5.1.0', 'eb-garamond', ['400', '500', '600', '400-italic'])
fonts('fontsource-source-sans-3-5.1.0', 'source-sans-3', ['400', '600'])

# ---------- Bilder ----------
os.makedirs(os.path.join(DIST, 'img'))
for f in sorted(glob.glob(os.path.join(BILDER, '*.jpg'))):
    im = Image.open(f).convert('RGB')
    if im.width > 800:
        im = im.resize((800, round(im.height * 800 / im.width)), Image.LANCZOS)
    im.save(os.path.join(DIST, 'img', os.path.basename(f)), 'JPEG', quality=78, optimize=True, progressive=True)

# ---------- App-Symbole ----------
os.makedirs(os.path.join(DIST, 'icons'))
shutil.copy(os.path.join(SRC, 'icon.svg'), os.path.join(DIST, 'icons', 'icon.svg'))
async def icons():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for size, name in ((180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png'), (32, 'favicon-32.png')):
            pg = await b.new_page(viewport={'width': size, 'height': size})
            await pg.set_content('<style>html,body{margin:0}img{display:block;width:%dpx;height:%dpx}</style><img src="data:image/svg+xml;base64,%s">' % (
                size, size, __import__('base64').b64encode(read(os.path.join(SRC, 'icon.svg')).encode()).decode()))
            await pg.screenshot(path=os.path.join(DIST, 'icons', name))
            await pg.close()
        await b.close()
asyncio.run(icons())

# ---------- Manifest ----------
manifest = {
    'name': 'Rosenkranz',
    'short_name': 'Rosenkranz',
    'description': 'Den Rosenkranz beten, auf Deutsch und Latein.',
    'lang': 'de',
    'start_url': './',
    'scope': './',
    'display': 'standalone',
    'background_color': '#F8F6F1',
    'theme_color': '#F8F6F1',
    'icons': [
        {'src': 'icons/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
        {'src': 'icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}
write(os.path.join(DIST, 'manifest.webmanifest'), json.dumps(manifest, ensure_ascii=False, indent=2))

# ---------- index.html ----------
index = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rosenkranz</title>
<meta name="description" content="Den Rosenkranz beten, auf Deutsch und Latein.">
<meta name="theme-color" content="#F8F6F1">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Rosenkranz">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="icon" type="image/svg+xml" href="icons/icon.svg">
<style>
%s
:root{--bg:#F8F6F1}
html,body{margin:0;background:var(--bg)}
#app{display:flex;justify-content:center}
button,a{-webkit-tap-highlight-color:transparent}
button{touch-action:manipulation}
</style>
</head>
<body>
<div id="app"></div>
<template id="tpl-Main">%s</template>
<template id="tpl-Gebet">%s</template>
<noscript><p style="font-family:serif;padding:20px">Bitte JavaScript aktivieren, um die Rosenkranz-App zu nutzen.</p></noscript>
<script src="app.js"></script>
</body>
</html>
""" % ('\n'.join(font_css), main_tpl, gebet_tpl)
write(os.path.join(DIST, 'index.html'), index)
write(os.path.join(DIST, '.nojekyll'), '')

# ---------- Service Worker ----------
files = []
for root, _, fs in os.walk(DIST):
    for f in fs:
        rel = os.path.relpath(os.path.join(root, f), DIST).replace(os.sep, '/')
        if rel in ('.nojekyll',):
            continue
        files.append(rel)
files.sort()
h = hashlib.sha256()
for rel in files:
    with open(os.path.join(DIST, rel), 'rb') as f:
        h.update(rel.encode()); h.update(f.read())
version = h.hexdigest()[:10]
sw = """// Offline-Speicher der Rosenkranz-App. Version wird beim Bauen gesetzt.
var CACHE = 'rosenkranz-%s';
var FILES = %s;

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
""" % (version, json.dumps(['./'] + files, indent=0))
write(os.path.join(DIST, 'sw.js'), sw)

total = sum(os.path.getsize(os.path.join(DIST, f)) for f in files)
print('Version', version, '·', len(files), 'Dateien ·', round(total / 1e6, 2), 'MB')
