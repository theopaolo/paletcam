const CACHE_NAME = 'colorcatcher-v13';
const SW_BASE_URL = new URL('./', self.location.href);

function toScopedPath(pathname = '') {
  const normalizedPath = pathname.replace(/^\/+/, '');
  return new URL(normalizedPath, SW_BASE_URL).pathname;
}

const INDEX_FALLBACK_URL = toScopedPath('index.html');
const OFFLINE_FALLBACK_URL = toScopedPath('offline.html');
const PRECACHE_MANIFEST_URL = toScopedPath('precache-manifest.json');
const CORE_APP_SHELL_URLS = [INDEX_FALLBACK_URL, OFFLINE_FALLBACK_URL];

async function readPrecacheManifest() {
  try {
    const manifestResponse = await fetch(new Request(PRECACHE_MANIFEST_URL, { cache: 'no-store' }));
    if (!manifestResponse.ok) {
      return [];
    }

    const manifestUrls = await manifestResponse.json();
    if (!Array.isArray(manifestUrls)) {
      return [];
    }

    return manifestUrls
      .filter((url) => typeof url === 'string')
      .map((url) => toScopedPath(url));
  } catch {
    return [];
  }
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const manifestUrls = await readPrecacheManifest();
  const urlsToCache = [...new Set([...CORE_APP_SHELL_URLS, ...manifestUrls])];

  await Promise.allSettled(
    urlsToCache.map((url) => cache.add(new Request(url, { cache: 'reload' })))
  );
}

function isSameOriginRequest(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function shouldCacheResponse(response) {
  return Boolean(response?.ok && response.type === 'basic');
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
          cache.put(INDEX_FALLBACK_URL, networkResponse.clone());
          return networkResponse;
        } catch (error) {
          const fallbackResponse = await caches.match(OFFLINE_FALLBACK_URL);
          if (fallbackResponse) {
            return fallbackResponse;
          }

          const appShellFallback = await caches.match(INDEX_FALLBACK_URL);
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
