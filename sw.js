/* Lightweight app-shell caching. Do not cache AMap tiles, geocoding, personal API data or secrets. */
const CACHE = 'jinan-metro-pwa-v1';
const ASSETS = [
  '/', '/index.html', '/jinan-map.html',
  '/css/tablet.css', '/js/storage.js', '/js/tablet-ui.js', '/js/tablet-measure.js',
  '/amap-metro-poi-data.js', '/metro-lines-data.js', '/metro-line7-data.js',
  '/manifest.webmanifest', '/icons/metro.svg'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.all(ASSETS.map(async asset => {
      try {
        const response = await fetch(asset, { cache: 'reload' });
        if (response.ok) await cache.put(asset, response);
      } catch (_) { /* best effort for interrupted installs */ }
    }));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('jinan-metro-pwa-') && k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_AMapService/') || url.pathname === '/config.local.js') return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(response => response.ok ? response : Promise.reject(new Error('Network')))
      .catch(() => caches.match('/index.html')));
    return;
  }
  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
});
