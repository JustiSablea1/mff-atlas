const CACHE = 'mff-atlas-shell-2.0.0';
const FILES = [
  './index.html', './manifest.webmanifest', './icon.svg',
  './v2/apple-touch-icon.png', './v2/icon-192.png', './v2/icon-512.png',
  './v2/style.css', './v2/app.mjs', './v2/profile.mjs', './v2/plan.mjs',
  './v2/scan.mjs', './v2/ocr-worker.js', './v2/portraits.mjs', './v2/portraits.ndjson', './v2/catalog.json', './v2/evidence.json'
];
const url = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(FILES.map(path => new Request(url(path), { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && (/^mff-atlas-shell-/.test(key) || /^mff-atlas-v\d+$/.test(key))) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'ATLAS_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    const path = new URL(request.url).pathname;
    const root = new URL(self.registration.scope).pathname;
    if (![root, root + 'index.html', root + 'atlas-153.html'].includes(path)) return;
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url('./index.html'))));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(request);
    if (saved) return saved;
    return fetch(request);
  }));
});
