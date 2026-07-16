const CACHE_NAME = 'theview-stock-v32.0-stable';
const CORE_ASSETS = [
  './',
  './index.html',
  './main.css?v=32.0',
  './app.js?v=32.0',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document';
  const isCode = ['script','style'].includes(event.request.destination);

  if(isDocument || isCode){
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if(response && response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if(response && response.ok){
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy));
      }
      return response;
    }))
  );
});
