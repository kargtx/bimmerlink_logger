// Service worker: статика из кэша (приложение открывается без сети), API — только из сети.
const VERSION = 'bl-v2.1.0';
const STATIC = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/js/api.js',
  '/js/charts.js',
  '/js/dom.js',
  '/icon.svg',
  '/manifest.webmanifest',
  '/vendor/uplot/uPlot.esm.js',
  '/vendor/uplot/uPlot.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/'))
    return;
  // сначала сеть (чтобы обновления приходили сразу), при её отсутствии — кэш
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html')))
  );
});
