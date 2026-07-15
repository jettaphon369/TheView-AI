const CACHE_NAME = 'theview-stock-v25.3';
const ASSETS = [
  './',
  './index.html',
  './main.css?v=25.3',
  './app.js?v=25.3',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: พยายามโหลดของใหม่จากเซิร์ฟเวอร์ก่อนเสมอ
// ถ้าออฟไลน์/เน็ตหลุดค่อย fallback ไปใช้ของที่ cache ไว้
// (ป้องกันปัญหาเว็บค้างเวอร์ชันเก่าหลัง deploy ใหม่)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // ไม่ยุ่งกับ Firebase requests

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
