const CACHE_NAME = 'colorcatcher-v8';
const OFFLINE_FALLBACK_URL = '/offline.html';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  OFFLINE_FALLBACK_URL,
  '/app.css',
  '/reset.css',
  '/zoom.css',
  '/pwa-install.css',
  '/app.js',
  '/collection-ui.js',
  '/palette-storage.js',
  '/pwa-install.js',
  '/modules/camera-controller.js',
  '/modules/camera-ui.js',
  '/modules/palette-extraction.js',
  '/manifest.json',
  '/logo/colorcatchers.svg',
  '/icons/icon-192-framed.png',
  '/icons/icon-512-framed.png',
  '/icons/icon-192-padded.png',
  '/icons/icon-512-padded.png',
  '/node_modules/dexie/dist/dexie.mjs',
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const requests = APP_SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }));

  await cache.addAll(requests);
}

function isSameOriginRequest(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function shouldCacheResponse(response) {
  return Boolean(response && response.ok && response.type === 'basic');
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const staleCaches = cacheNames.filter((cacheName) => cacheName !== CACHE_NAME);

      await Promise.all(staleCaches.map((cacheName) => caches.delete(cacheName)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== 'GET' || !isSameOriginRequest(requestUrl)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', networkResponse.clone());
          return networkResponse;
        } catch (error) {
          const fallbackResponse = await caches.match(OFFLINE_FALLBACK_URL);
          if (fallbackResponse) {
            return fallbackResponse;
          }

          const appShellFallback = await caches.match('/index.html');
          if (appShellFallback) {
            return appShellFallback;
          }

          throw error;
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request);

      const networkResponsePromise = fetch(request)
        .then(async (networkResponse) => {
          if (shouldCacheResponse(networkResponse)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
          }

          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        return cachedResponse;
      }

      const networkResponse = await networkResponsePromise;
      if (networkResponse) {
        return networkResponse;
      }

      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
