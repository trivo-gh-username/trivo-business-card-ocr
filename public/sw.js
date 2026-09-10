const CACHE_NAME = 'cardbox-static-v1';
const STATIC_FILES = [
  '/css/style.css',
  '/js/api.js', '/js/nav.js', '/js/scan.js', '/js/cards.js', '/js/admin.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never cache API calls, HTML pages, or images -- all per-user/dynamic/authenticated.
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.html') || url.pathname === '/'
    || url.pathname.startsWith('/c/')) {
    return;
  }

  // Static assets: cache-first, so the app shell still loads offline.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
      if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)); }
      return res;
    }))
  );
});
