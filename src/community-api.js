import { clientLog } from "./modules/client-log.js";
import { getApiBaseUrl } from "./config.js";
import { requestJson } from "./modules/http-request.js";
import {
  COMMUNITY_API_CONTRACT_LIMITS,
  validateAcknowledgement,
  validateCatchPublication,
  validateLoginVerification,
  validateMagicLink,
  validateModerationStatuses,
} from "./community-api-contract.js";

const REQUEST_TIMEOUT_MS = 15000;
const MODERATION_STATUSES_PATH = "/catches/statuses";
const PUBLICATION_IDEMPOTENCY_KEY_PATTERN = /^paletcam-publish-[a-f0-9]{16,64}$/;

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

function validateCommunityResponse(path, validator, payload) {
  try {
    return validator(payload);
  } catch (error) {
    const issue = typeof error?.issue === "string" ? error.issue : "response contract mismatch";
    clientLog("Community API returned an invalid response.", {
      errorName: error?.name ?? "Error",
    });
    throw createApiError("Invalid response from community API.", {
      status: 502,
      payload: { failureKind: "invalid_response", issue },
      path,
    });
  }
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

async function requestCommunityApi(
  path,
  { method = "GET", token = "", body = undefined, signal = undefined, idempotencyKey = "" } = {},
) {
  const requestUrl = buildApiUrl(path);

  const headers = new Headers({
    Accept: "application/json",
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (idempotencyKey) {
    if (!PUBLICATION_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new TypeError("Invalid publication idempotency key.");
    }
    headers.set("Idempotency-Key", idempotencyKey);
  }

  const requestInit = {
    method,
    headers,
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestInit.body = JSON.stringify(body);
  }

  try {
    const { payload } = await requestJson(requestUrl, requestInit);
    return payload;
  } catch (error) {
    const isHttpFailure = error?.kind === "http";
    clientLog("Community API request failed.", {
      method,
      status: error?.status ?? 0,
      failureKind: error?.kind ?? "unknown",
      errorName: error?.name ?? "Error",
    });

    throw createApiError(
      isHttpFailure ? error.message : "Network error while calling community API.",
      {
        status: error?.status ?? 0,
        payload: error?.payload ?? {
          originalError: error?.message || String(error),
          failureKind: error?.kind ?? "unknown",
          requestId: error?.requestId ?? "",
        },
        path,
      },
    );
  }
}

export async function requestCommunityLoginCode({ email, signal }) {
  const path = "/login";
  const payload = await requestCommunityApi(path, {
    method: "POST",
    body: { email },
    signal,
  });
  return validateCommunityResponse(
    path,
    (value) => validateAcknowledgement(value, "login"),
    payload,
  );
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} [options.redirect] Relative path the magic link should land on after auto-login.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ magic_link?: string, expires_at?: string }>}
 */
export async function requestCommunityMagicLink({ token, redirect, signal }) {
  const path = "/auth/magic-link";
  const payload = await requestCommunityApi(path, {
    method: "POST",
    token,
    body: typeof redirect === "string" && redirect ? { redirect } : undefined,
    signal,
  });
  return validateCommunityResponse(
    path,
    (value) => validateMagicLink(value, new URL(getApiBaseUrl()).origin),
    payload,
  );
}

export async function requestAccountDeletionCode({ token, signal }) {
  const path = "/account/deletion-code";
  const payload = await requestCommunityApi(path, {
    method: "POST",
    token,
    signal,
  });
  return validateCommunityResponse(
    path,
    (value) => validateAcknowledgement(value, "account deletion code"),
    payload,
  );
}

export async function deleteAccount({ token, code, signal }) {
  const path = "/account";
  const payload = await requestCommunityApi(path, {
    method: "DELETE",
    token,
    body: { code },
    signal,
  });
  return validateCommunityResponse(
    path,
    (value) => validateAcknowledgement(value, "account deletion"),
    payload,
  );
}

export async function verifyCommunityLoginCode({ email, code, signal }) {
  const path = "/verify";
  const payload = await requestCommunityApi(path, {
    method: "POST",
    body: { email, code },
    signal,
  });
  return validateCommunityResponse(path, validateLoginVerification, payload);
}

export async function postCatchToCommunity({
  token,
  operationKey,
  photoBase64,
  timestamp,
  colors,
  captureAspectRatio = null,
  captureCropRect = null,
  ralCode = null,
  ralProximity = null,
}) {
  const path = "/catch/publish";
  const payload = await requestCommunityApi(path, {
    method: "POST",
    token,
    idempotencyKey: operationKey,
    body: {
      colors,
      photoBlob: photoBase64,
      timestamp,
      captureAspectRatio,
      captureCropRect,
      ...(ralCode ? { ralCode } : {}),
      ...(ralProximity !== null ? { ralProximity } : {}),
    },
  });
  return validateCommunityResponse(
    path,
    (value) => validateCatchPublication(value, normalizeCatchStatus),
    payload,
  );
}

export async function unpublishCatchFromCommunity({ token, remoteCatchId }) {
  const safeRemoteCatchId = encodeURIComponent(String(remoteCatchId || "").trim());
  const path = `/catch/${safeRemoteCatchId}/unpublish`;
  const payload = await requestCommunityApi(path, {
    method: "POST",
    token,
  });
  return validateCommunityResponse(
    path,
    (value) => validateAcknowledgement(value, "catch unpublish"),
    payload,
  );
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {(string | number)[]} options.remoteCatchIds
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ statuses: ModerationEntry[], deletedIds: string[] }>}
 */
export async function fetchCatchModerationStatuses({ token, remoteCatchIds, signal }) {
  const empty = { statuses: [], deletedIds: [] };

  if (!Array.isArray(remoteCatchIds) || remoteCatchIds.length === 0) {
    return empty;
  }

  if (remoteCatchIds.length > COMMUNITY_API_CONTRACT_LIMITS.moderationRequestIds) {
    throw new RangeError(
      `Moderation status requests support at most ${COMMUNITY_API_CONTRACT_LIMITS.moderationRequestIds} ids.`,
    );
  }

  /** @type {string[]} */
  const uniqueIds = [];
  const seenIds = new Set();
  remoteCatchIds.forEach((value, index) => {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
      throw new TypeError(`remoteCatchIds[${index}] must be a string or finite number.`);
    }
    if (
      typeof value === "string" &&
      value.length > COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters
    ) {
      throw new RangeError(
        `remoteCatchIds[${index}] exceeds ${COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters} characters.`,
      );
    }
    const normalizedId = String(value).trim();
    if (!normalizedId || seenIds.has(normalizedId)) {
      return;
    }
    seenIds.add(normalizedId);
    uniqueIds.push(normalizedId);
  });

  if (uniqueIds.length === 0) {
    return empty;
  }

  /** @type {{statuses: ModerationEntry[], deletedIds: string[]}} */
  const result = { statuses: [], deletedIds: [] };
  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += COMMUNITY_API_CONTRACT_LIMITS.moderationBatchIds
  ) {
    const batchIds = uniqueIds.slice(
      offset,
      offset + COMMUNITY_API_CONTRACT_LIMITS.moderationBatchIds,
    );
    const payload = await requestCommunityApi(MODERATION_STATUSES_PATH, {
      method: "POST",
      body: { ids: batchIds },
      token,
      signal,
    });
    const batchResult = validateCommunityResponse(
      MODERATION_STATUSES_PATH,
      (value) =>
        validateModerationStatuses(value, normalizeCatchStatus, {
          allowedIds: batchIds,
          maxEntries: batchIds.length,
        }),
      payload,
    );
    result.statuses.push(...batchResult.statuses);
    result.deletedIds.push(...batchResult.deletedIds);
  }

  return result;
}
