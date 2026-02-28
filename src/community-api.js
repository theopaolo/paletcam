const LOCAL_PROXY_COMMUNITY_API_BASE_URL = "/api/v1";
const LIVE_COMMUNITY_API_BASE_URL = "https://ccs.preview.name/api/v1";
const LEGACY_DEFAULT_COMMUNITY_API_BASE_URLS = new Set([
  "http://ccs.test/api/v1",
  "https://ccs.preview.name/api/v1",
  "http://ccs.preview.name/api/v1",
]);
const COMMUNITY_API_BASE_URL_STORAGE_KEY = "paletcam:community:api-base-url:v1";
const COMMUNITY_API_REQUEST_TIMEOUT_MS = 15000;

export const CATCH_MODERATION_STATUSES = Object.freeze({
  TO_MODERATE: "TO_MODERATE",
  VALID: "VALID",
  REJECTED: "REJECTED",
});

const KNOWN_CATCH_STATUSES = new Set(Object.values(CATCH_MODERATION_STATUSES));

function getRuntimeHostname() {
  return String(globalThis.location?.hostname || "").toLowerCase();
}

function isLocalDevHost() {
  const hostname = getRuntimeHostname();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function getDefaultCommunityApiBaseUrl() {
  return isLocalDevHost()
    ? LOCAL_PROXY_COMMUNITY_API_BASE_URL
    : LIVE_COMMUNITY_API_BASE_URL;
}

function normalizeApiBaseUrl(candidateUrl) {
  const defaultApiBaseUrl = getDefaultCommunityApiBaseUrl();

  if (typeof candidateUrl !== "string" || !candidateUrl.trim()) {
    return defaultApiBaseUrl;
  }

  const trimmedUrl = candidateUrl.trim();
  if (LEGACY_DEFAULT_COMMUNITY_API_BASE_URLS.has(trimmedUrl)) {
    return defaultApiBaseUrl;
  }

  if (/^https?:\/\//i.test(trimmedUrl)) {
    try {
      const parsed = new URL(trimmedUrl);
      const normalizedCandidatePath = parsed.pathname.replace(/\/+$/, "") || "/";
      const isKnownCommunityHost = (
        parsed.hostname === "ccs.test" ||
        parsed.hostname === "ccs.preview.name"
      );

      if (isKnownCommunityHost && normalizedCandidatePath === "/api/v1") {
        return defaultApiBaseUrl;
      }

      parsed.pathname = normalizedCandidatePath;
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch (_error) {
      return defaultApiBaseUrl;
    }
  }

  const normalizedRelativePath = trimmedUrl
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalizedRelativePath) {
    return defaultApiBaseUrl;
  }

  if (!isLocalDevHost()) {
    return LIVE_COMMUNITY_API_BASE_URL;
  }

  return `/${normalizedRelativePath}`;
}

function getStoredApiBaseUrl() {
  try {
    return localStorage.getItem(COMMUNITY_API_BASE_URL_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
}

export function getCommunityApiBaseUrl() {
  return normalizeApiBaseUrl(getStoredApiBaseUrl());
}

function buildApiUrl(pathname) {
  const safePath = typeof pathname === "string" ? pathname.replace(/^\/+/, "") : "";
  const baseUrl = getCommunityApiBaseUrl();

  if (/^https?:\/\//i.test(baseUrl)) {
    const rootUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(safePath, rootUrl).toString();
  }

  const normalizedBasePath = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;

  return `${normalizedBasePath}/${safePath}`;
}

function createApiError(message, { status = 0, payload = null, path = "" } = {}) {
  const error = new Error(message);
  error.name = "CommunityApiError";
  error.status = status;
  error.payload = payload;
  error.path = path;
  return error;
}

function extractArrayPayload(payload, preferredKeys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

function normalizeModerationStatusEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const remoteCatchId = String(
    entry.id
      || entry.catchId
      || entry.remoteCatchId
      || "",
  ).trim();
  const status = normalizeCatchStatus(
    entry.status || entry.moderationStatus || null,
  );

  if (!remoteCatchId || !status) {
    return null;
  }

  return { remoteCatchId, status };
}

function normalizeModerationStatusPayload(payload) {
  const arrayPayload = extractArrayPayload(payload, [
    "statuses",
    "catches",
    "data",
    "items",
  ]);

  if (arrayPayload.length > 0) {
    return arrayPayload
      .map((entry) => normalizeModerationStatusEntry(entry))
      .filter(Boolean);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  return Object.entries(payload)
    .map(([remoteCatchId, status]) =>
      normalizeModerationStatusEntry({ remoteCatchId, status }))
    .filter(Boolean);
}

export function normalizeCatchStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return KNOWN_CATCH_STATUSES.has(normalized) ? normalized : null;
}

export function isEndpointMissingError(error) {
  const status = Number(error?.status);
  return status === 404 || status === 405;
}

async function requestCommunityApi(
  path,
  {
    method = "GET",
    token = "",
    body = undefined,
    query = null,
  } = {},
) {
  const requestUrlValue = buildApiUrl(path);
  const requestUrl = /^https?:\/\//i.test(requestUrlValue)
    ? new URL(requestUrlValue)
    : new URL(requestUrlValue, globalThis.location?.origin ?? "http://localhost");

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }

      requestUrl.searchParams.set(key, String(value));
    });
  }

  const headers = new Headers({
    Accept: "application/json",
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const requestInit = {
    method,
    headers,
    signal: undefined,
  };

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestInit.body = JSON.stringify(body);
  }

  let response;
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    abortController.abort(new Error("Community API request timeout."));
  }, COMMUNITY_API_REQUEST_TIMEOUT_MS);
  requestInit.signal = abortController.signal;

  try {
    response = await fetch(requestUrl.toString(), requestInit);
  } catch (error) {
    const isAbortError = error?.name === "AbortError";
    throw createApiError("Network error while calling community API.", {
      status: 0,
      payload: {
        originalError: isAbortError
          ? `Request timed out after ${COMMUNITY_API_REQUEST_TIMEOUT_MS}ms.`
          : (error?.message || String(error)),
      },
      path,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  let payload = null;
  const rawResponseBody = await response.text();

  if (rawResponseBody) {
    try {
      payload = JSON.parse(rawResponseBody);
    } catch (_error) {
      payload = null;
    }
  }

  if (!response.ok) {
    const payloadMessage = typeof payload?.message === "string" ? payload.message : "";
    throw createApiError(
      payloadMessage || `API request failed (${response.status}).`,
      {
        status: response.status,
        payload,
        path,
      },
    );
  }

  return payload;
}

export function requestCommunityLoginCode({ email }) {
  return requestCommunityApi("/login", {
    method: "POST",
    body: { email },
  });
}

export function verifyCommunityLoginCode({ email, code }) {
  const attempts = [
    { path: "/verify", method: "POST", body: { email, code } },
    { path: "/verify", method: "GET", query: { email, code } },
    { path: "/login", method: "POST", body: { email, code } },
  ];

  let lastError = null;

  return (async () => {
    for (const attempt of attempts) {
      try {
        const payload = await requestCommunityApi(attempt.path, {
          method: attempt.method,
          body: attempt.body,
          query: attempt.query,
        });

        if (typeof payload?.token === "string" && payload.token.trim()) {
          return payload;
        }

        // If /verify exists but returns no token, this is a real backend issue:
        // do not hit /login afterwards because it may resend a new OTP.
        if (attempt.path === "/verify") {
          throw createApiError("Verification endpoint returned no token.", {
            status: 422,
            payload,
            path: attempt.path,
          });
        }

        // /login fallback may return a "code sent" payload. In that case there
        // is still no token and verification cannot continue.
      } catch (error) {
        lastError = error;

        // Fallback is allowed only when the endpoint is missing.
        if (isEndpointMissingError(error)) {
          continue;
        }

        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw createApiError("No login verification endpoint is available.", {
      status: 404,
      path: "/verify",
    });
  })();
}

export function postCatchToCommunity({
  token,
  photoBase64,
  timestamp,
  colors,
}) {
  return requestCommunityApi("/publish", {
    method: "POST",
    token,
    body: {
      photoBlob: photoBase64,
      timestamp,
      colors,
    },
  });
}

export async function fetchCatchModerationStatuses({
  token,
  remoteCatchIds,
}) {
  if (!Array.isArray(remoteCatchIds) || remoteCatchIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(
    remoteCatchIds
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];

  if (uniqueIds.length === 0) {
    return [];
  }

  try {
    const payload = await requestCommunityApi("/catches/statuses", {
      method: "POST",
      body: { ids: uniqueIds },
      token,
    });

    return normalizeModerationStatusPayload(payload);
  } catch (error) {
    if (isEndpointMissingError(error)) {
      throw createApiError("Moderation status endpoint is unavailable.", {
        status: Number(error?.status || 404),
        payload: error?.payload ?? null,
        path: "/catches/statuses",
      });
    }

    throw error;
  }
}
