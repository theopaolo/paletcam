import { clientLog } from "./modules/client-log.js";
import { getApiBaseUrl } from "./config.js";

const REQUEST_TIMEOUT_MS = 15000;

export const CATCH_MODERATION_STATUSES = Object.freeze({
  TO_MODERATE: "TO_MODERATE",
  PUBLIC: "PUBLIC",
  REJECTED: "REJECTED",
  PRIVATE: "PRIVATE",
});

/** @type {Set<string>} */
const KNOWN_CATCH_STATUSES = new Set(Object.values(CATCH_MODERATION_STATUSES));

function buildApiUrl(pathname) {
  const safePath = typeof pathname === "string" ? pathname.replace(/^\/+/, "") : "";
  const baseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL(safePath, `${baseUrl}/`).toString();
  }

  return `${baseUrl}/${safePath}`;
}

function createApiError(message, { status = 0, payload = null, path = "" } = {}) {
  const error = /** @type {Error & CommunityApiError} */ (new Error(message));
  error.name = "CommunityApiError";
  error.status = status;
  error.payload = payload;
  error.path = path;
  return error;
}

/**
 * @param {string | null | undefined} status
 * @returns {ModerationStatus | null}
 */
export function normalizeCatchStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return KNOWN_CATCH_STATUSES.has(normalized) ? /** @type {ModerationStatus} */ (normalized) : null;
}

function createTimeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
  return controller.signal;
}

async function requestCommunityApi(
  path,
  {
    method = "GET",
    token = "",
    body = undefined,
  } = {},
) {
  const requestUrl = buildApiUrl(path);

  const headers = new Headers({
    Accept: "application/json",
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const requestInit = {
    method,
    headers,
    signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
  };

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestInit.body = JSON.stringify(body);
  }

  let response;

  try {
    response = await fetch(requestUrl, requestInit);
  } catch (error) {
    const originalError = error?.name === "TimeoutError"
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms.`
      : (error?.message || String(error));

    clientLog("Network error while calling community API.", {
      requestUrl,
      method,
      path,
      originalError,
    });

    throw createApiError("Network error while calling community API.", {
      status: 0,
      payload: { requestUrl, originalError },
      path,
    });
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

    clientLog(`API request failed (${response.status}).`, {
      requestUrl,
      method,
      path,
      status: response.status,
      payloadMessage,
    });

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
  return requestCommunityApi("/verify", {
    method: "POST",
    body: { email, code },
  });
}

export function postCatchToCommunity({
  token,
  photoBase64,
  timestamp,
  colors,
  captureAspectRatio = null,
  captureCropRect = null,
}) {
  return requestCommunityApi("/catch/publish", {
    method: "POST",
    token,
    body: {
      colors,
      photoBlob: photoBase64,
      timestamp,
      captureAspectRatio,
      captureCropRect,
    },
  });
}

export function unpublishCatchFromCommunity({
  token,
  remoteCatchId,
}) {
  const safeRemoteCatchId = encodeURIComponent(String(remoteCatchId || "").trim());
  return requestCommunityApi(`/catch/${safeRemoteCatchId}/unpublish`, {
    method: "POST",
    token,
  });
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string[]} options.remoteCatchIds
 * @returns {Promise<{ statuses: ModerationEntry[], deletedIds: string[] }>}
 */
export async function fetchCatchModerationStatuses({
  token,
  remoteCatchIds,
}) {
  const empty = { statuses: [], deletedIds: [] };

  if (!Array.isArray(remoteCatchIds) || remoteCatchIds.length === 0) {
    return empty;
  }

  const uniqueIds = [...new Set(
    remoteCatchIds
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];

  if (uniqueIds.length === 0) {
    return empty;
  }

  const payload = await requestCommunityApi("/catches/statuses", {
    method: "POST",
    body: { ids: uniqueIds },
    token,
  });

  const entries = Array.isArray(payload?.catches) ? payload.catches : [];

  const statuses = entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const remoteCatchId = String(entry.id || "").trim();
      const status = normalizeCatchStatus(entry.status);
      return remoteCatchId && status ? { remoteCatchId, status } : null;
    })
    .filter(Boolean);

  const deletedIds = Array.isArray(payload?.deletedIds)
    ? payload.deletedIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  return { statuses, deletedIds };
}
