const CACHE_PREFIX = 'theview-stock-';
const CACHE_NAME = 'theview-stock-main-theview-4d389-34-29-50-pc-brand-balance';
const RUNTIME_CACHE = 'theview-stock-runtime-main-theview-4d389-34-29-50-pc-brand-balance';
const REQUIRED_ASSETS = [
  './',
  './index.html',
  './qr.html',
  './manual.html',
  './reset.html',
  './main.css?v=34.29.50-main',
  './app.js?v=34.29.50-main',
  './firebase-config.js',
  './chee-chan-logo.png',
  './chee-chan-course-original.jpg'
];
const OPTIONAL_ASSETS = [
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon-64.png',
  './favicon.ico'
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
    // v34.29.50: clear every older CHEE CHAN / TheView cache so the PC brand balance fix is applied immediately.
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX) && ![CACHE_NAME,RUNTIME_CACHE].includes(key)).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
  if(event.data?.type==='CLEAR_CACHES'){
    event.waitUntil((async()=>{
      const keys=await caches.keys();
      await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)).map(key=>caches.delete(key)));
    })());
  }
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if(url.origin === self.location.origin && /\/(reset\.html|VERSION\.txt|VERSION_CHECK\.html)(?:$|\?)/i.test(url.pathname)){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }

  if(/(firestore|identitytoolkit|securetoken)\.googleapis\.com$/i.test(url.hostname)) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isFirebaseModule = url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');
  const isStorageImage = /^(firebasestorage|storage)\.googleapis\.com$/i.test(url.hostname) && event.request.destination === 'image';

  if(isFirebaseModule){
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
