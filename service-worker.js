const CACHE_NAME = 'colorcatcher-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/palette-storage.js',
  '/collection-ui.js',
  '/pwa-install.css',
  '/pwa-install.js',
  '/logo/colorcatchers.svg',
  '/icons/icon-192-framed.png',
  '/icons/icon-512-framed.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
