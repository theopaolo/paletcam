const CACHE_NAME = "colorcatcher-__BUILD_ID__";
const CACHE_PREFIX = "colorcatcher-";
const SW_BASE_URL = new URL("./", self.location.href);

function toScopedPath(pathname = "") {
  const normalizedPath = pathname.replace(/^\/+/, "");
  return new URL(normalizedPath, SW_BASE_URL).pathname;
}

const INDEX_FALLBACK_URL = toScopedPath("index.html");
const OFFLINE_FALLBACK_URL = toScopedPath("offline.html");
const APP_ROOT_URL = SW_BASE_URL.pathname;
const PRECACHE_MANIFEST_URL = toScopedPath("precache-manifest.json");
const SERVICE_WORKER_SCRIPT_URL = toScopedPath("service-worker.js");
const WEB_MANIFEST_URL = toScopedPath("manifest.json");
const PRECACHE_URLS = __PRECACHE_URLS__.map((url) => toScopedPath(url));
const PRECACHE_URL_SET = new Set(PRECACHE_URLS);
const REQUIRED_SHELL_URLS = __REQUIRED_SHELL_URLS__.map((url) => toScopedPath(url));
const BYPASS_CACHE_PATHS = new Set([
  SERVICE_WORKER_SCRIPT_URL,
  PRECACHE_MANIFEST_URL,
  WEB_MANIFEST_URL,
]);
const DEBUG_CACHE_BYPASS_PATHS = new Set(
  __DEBUG_CACHE_BYPASS_PATHS__.map((path) => toScopedPath(path)),
);
const DEBUG_CACHE_BYPASS_PREFIXES = __DEBUG_CACHE_BYPASS_PREFIXES__.map((path) =>
  toScopedPath(path),
);

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const requiredUrls = [...new Set(REQUIRED_SHELL_URLS)];
  const optionalUrls = [...new Set(PRECACHE_URLS)].filter((url) => !requiredUrls.includes(url));

  // Required navigation fallbacks are an install transaction: if either one
  // fails, reject installation so an incomplete worker never activates.
  try {
    await Promise.all(requiredUrls.map((url) => cache.add(new Request(url, { cache: "reload" }))));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }

  // Optional immutable assets improve first offline use, but a single missing
  // font/icon must not block an otherwise complete app shell update.
  const optionalResults = await Promise.allSettled(
    optionalUrls.map((url) => cache.add(new Request(url, { cache: "reload" }))),
  );
  const optionalFailureCount = optionalResults.filter(
    (result) => result.status === "rejected",
  ).length;
  if (optionalFailureCount > 0) {
    console.warn(`Optional precache failed for ${optionalFailureCount} resource(s).`);
  }
}

function isSameOriginRequest(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function shouldCacheResponse(response) {
  return Boolean(response?.ok && response.type === "basic");
}

function isApiRequest(requestUrl) {
  return requestUrl.pathname.startsWith(toScopedPath("api/"));
}

function shouldBypassRequest(request, requestUrl) {
  return (
    isApiRequest(requestUrl) ||
    BYPASS_CACHE_PATHS.has(requestUrl.pathname) ||
    DEBUG_CACHE_BYPASS_PATHS.has(requestUrl.pathname) ||
    DEBUG_CACHE_BYPASS_PREFIXES.some((prefix) => requestUrl.pathname.startsWith(prefix)) ||
    request.cache === "no-store"
  );
}

function isCodeRequest(request) {
  return (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "worker"
  );
}

function isAppShellNavigation(requestUrl) {
  return requestUrl.pathname === APP_ROOT_URL || requestUrl.pathname === INDEX_FALLBACK_URL;
}

function isExactPrecachedNavigation(requestUrl) {
  return !requestUrl.search && PRECACHE_URL_SET.has(requestUrl.pathname);
}

function createFreshRequest(request) {
  return new Request(request, { cache: "no-store" });
}

// Fetches `request`, stores a successful response under `cacheKey`, and returns
// the network response (or null on failure). When `freshRequest` is true the
// browser HTTP cache is bypassed (used for app-shell/asset revalidation); set
// it to false to respect the HTTP cache for ordinary same-origin requests.
async function fetchAndCache(request, cache, { cacheKey = request, freshRequest = true } = {}) {
  try {
    const networkResponse = await fetch(freshRequest ? createFreshRequest(request) : request);
    if (shouldCacheResponse(networkResponse)) {
      try {
        await cache.put(cacheKey, networkResponse.clone());
      } catch (error) {
        console.warn("Service Worker cache write failed:", error);
      }
    }

    return networkResponse;
  } catch {
    return null;
  }
}

// A versioned cache holds exactly one build. A hit is served as is and never
// refreshed in the background: after a deploy, a refresh would write the new
// build's `index.html` and `app.js` into this cache, and they import chunks
// this worker never cached, so the next offline launch would not start. The
// new build arrives with its own worker and its own cache. Only a miss (an
// optional asset that failed to precache) goes to the network.
async function respondFromBuildCache(request, cache, { cacheKey = request, freshRequest } = {}) {
  return (
    (await cache.match(cacheKey)) ??
    (await fetchAndCache(request, cache, { cacheKey, freshRequest }))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const staleCaches = cacheNames.filter(
        (cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME,
      );

      await Promise.all(staleCaches.map((cacheName) => caches.delete(cacheName)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || !isSameOriginRequest(requestUrl)) {
    return;
  }

  if (shouldBypassRequest(request, requestUrl)) {
    return;
  }

  // Exact precached documents such as offline.html retain their own cache key
  // and continue through the manifest-bound request policy below. Unknown
  // server routes are network-first and may fall back to the shell, but can
  // never overwrite it.
  if (
    request.mode === "navigate" &&
    (isAppShellNavigation(requestUrl) || !isExactPrecachedNavigation(requestUrl))
  ) {
    const isAppShell = isAppShellNavigation(requestUrl);
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const response = isAppShell
          ? await respondFromBuildCache(request, cache, { cacheKey: INDEX_FALLBACK_URL })
          : await fetch(createFreshRequest(request)).catch(() => null);

        return (
          response ??
          (await cache.match(INDEX_FALLBACK_URL)) ??
          (await cache.match(OFFLINE_FALLBACK_URL)) ??
          new Response("Offline", { status: 503, statusText: "Offline" })
        );
      })(),
    );
    return;
  }

  // The generated manifest is the complete cache allowlist. Requests outside
  // it stay network-only, preventing arbitrary same-origin resources from
  // escaping the artifact/cache budgets or growing storage without bounds.
  // Query-bearing variants are also network-only: validating only the pathname
  // would let `/app.js?v=1`, `/app.js?v=2`, ... create unbounded cache keys.
  if (requestUrl.search || !PRECACHE_URL_SET.has(requestUrl.pathname)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await respondFromBuildCache(request, cache, {
        // Code is fetched past the HTTP cache. Other assets may use it.
        freshRequest: isCodeRequest(request),
      });
      return response ?? new Response("Offline", { status: 503, statusText: "Offline" });
    })(),
  );
});
