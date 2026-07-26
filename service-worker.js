const CACHE_PREFIX = 'theview-stock-prod-';
const CACHE_NAME = 'theview-stock-prod-v34.15.1';
const RUNTIME_CACHE = 'theview-stock-runtime-v34.15.1';
const REQUIRED_ASSETS = [
  './',
  './index.html',
  './main.css?v=34.15.1',
  './app.js?v=34.15.1',
  './firebase-config.js',
  './chee-chan-logo.png',
  './chee-chan-course-original.jpg'
];
const OPTIONAL_ASSETS = [
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(REQUIRED_ASSETS);
    await Promise.allSettled(OPTIONAL_ASSETS.map(asset=>cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX) && ![CACHE_NAME,RUNTIME_CACHE].includes(key)).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // ห้าม cache คำขอฐานข้อมูล Firestore/Auth เพื่อไม่ให้ข้อมูลผิดหรือค้าง
  if(/(firestore|identitytoolkit|securetoken)\.googleapis\.com$/i.test(url.hostname)) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isFirebaseModule = url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');
  const isStorageImage = /^(firebasestorage|storage)\.googleapis\.com$/i.test(url.hostname) && event.request.destination === 'image';

  if(isFirebaseModule){
    // Firebase SDK: cache หลังโหลดครั้งแรก เพื่อให้เปิดเว็บซ้ำตอนออฟไลน์ได้
    event.respondWith((async()=>{
      const cache=await caches.open(RUNTIME_CACHE);
      const cached=await cache.match(event.request);
      if(cached) return cached;
      const response=await fetch(event.request);
      if(response?.ok) await cache.put(event.request,response.clone());
      return response;
    })());
    return;
  }

  if(isStorageImage){
    // รูปสินค้าที่เคยเปิดแล้ว สามารถดูซ้ำตอนออฟไลน์ได้
    event.respondWith((async()=>{
      const cache=await caches.open(RUNTIME_CACHE);
      const cached=await cache.match(event.request);
      if(cached) return cached;
      try{
        const response=await fetch(event.request);
        if(response?.ok) await cache.put(event.request,response.clone());
        return response;
      }catch(_){
        return cached || Response.error();
      }
    })());
    return;
  }

  if(!isSameOrigin) return;
  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document';
  const isCode = ['script','style'].includes(event.request.destination);

  if(isDocument || isCode){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response?.ok){
          const cache=await caches.open(CACHE_NAME);
          await cache.put(event.request,response.clone());
        }
        return response;
      }catch(_){
        return (await caches.match(event.request)) || (isDocument ? await caches.match('./index.html') : Response.error());
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached) return cached;
    try{
      const response=await fetch(event.request);
      if(response?.ok){
        const cache=await caches.open(RUNTIME_CACHE);
        await cache.put(event.request,response.clone());
      }
      return response;
    }catch(_){
      return cached || Response.error();
    }
  })());
});
