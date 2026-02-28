const CACHE_NAME = 'colorcatcher-__BUILD_ID__';
const SW_BASE_URL = new URL('./', self.location.href);

function toScopedPath(pathname = '') {
  const normalizedPath = pathname.replace(/^\/+/, '');
  return new URL(normalizedPath, SW_BASE_URL).pathname;
}

const INDEX_FALLBACK_URL = toScopedPath('index.html');
const OFFLINE_FALLBACK_URL = toScopedPath('offline.html');
const PRECACHE_MANIFEST_URL = toScopedPath('precache-manifest.json');
const SERVICE_WORKER_SCRIPT_URL = toScopedPath('service-worker.js');
const WEB_MANIFEST_URL = toScopedPath('manifest.json');
const CORE_APP_SHELL_URLS = [INDEX_FALLBACK_URL, OFFLINE_FALLBACK_URL];
const BYPASS_CACHE_PATHS = new Set([
  SERVICE_WORKER_SCRIPT_URL,
  PRECACHE_MANIFEST_URL,
  WEB_MANIFEST_URL,
]);

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

function isApiRequest(requestUrl) {
  return requestUrl.pathname.startsWith(toScopedPath('api/'));
}

function shouldBypassRequest(request, requestUrl) {
  return (
    isApiRequest(requestUrl) ||
    BYPASS_CACHE_PATHS.has(requestUrl.pathname) ||
    request.cache === 'no-store'
  );
}

function isNetworkFirstAssetRequest(request) {
  return (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker'
  );
}

function createFreshRequest(request) {
  return new Request(request, { cache: 'no-store' });
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

  if (shouldBypassRequest(request, requestUrl)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResponse = await fetch(createFreshRequest(request));
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

  if (isNetworkFirstAssetRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          const networkResponse = await fetch(createFreshRequest(request));
          if (shouldCacheResponse(networkResponse)) {
            cache.put(request, networkResponse.clone());
          }

          return networkResponse;
        } catch {
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);

      const networkResponsePromise = fetch(request)
        .then(async (networkResponse) => {
          if (shouldCacheResponse(networkResponse)) {
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
