const ACKNOWLEDGEMENT_ENDPOINTS = new Set([
  "login",
  "account deletion code",
  "account deletion",
  "catch unpublish",
]);

/**
 * Wire-contract limits. These are intentionally above normal application data
 * while bounding retained credentials and server-controlled response work.
 */
export const COMMUNITY_API_CONTRACT_LIMITS = Object.freeze({
  // Leaves ample room for signed JWT/PASETO-style credentials without
  // retaining an unbounded server-controlled string in localStorage.
  loginTokenCharacters: 8_192,
  // Shared by user ids, published catch ids, and moderation ids.
  remoteIdCharacters: 256,
  userNameCharacters: 160,
  // Covers the maximum conventional local@domain representation.
  userEmailCharacters: 320,
  // OTPs are normally short numeric values, but allow future alphanumeric
  // formats while preventing unbounded credential bodies.
  loginCodeCharacters: 32,
  accountDeletionCodeCharacters: 32,
  // Twenty sequential 100-id requests covers the supported 2,000-palette import ceiling.
  moderationBatchIds: 100,
  moderationRequestIds: 2_000,
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} endpoint @param {string} issue */
function invalidResponse(endpoint, issue) {
  const error = /** @type {Error & {endpoint: string, issue: string}} */ (
    new Error(`Invalid ${endpoint} response: ${issue}`)
  );
  error.name = "CommunityApiContractError";
  error.endpoint = endpoint;
  error.issue = issue;
  return error;
}

/** @param {unknown} payload @param {string} endpoint @returns {Record<string, unknown>} */
function requireRecord(payload, endpoint) {
  if (!isRecord(payload)) {
    throw invalidResponse(endpoint, "expected a JSON object");
  }
  return payload;
}

/** @param {unknown} value @param {string} endpoint @param {string} field */
function normalizeRemoteId(value, endpoint, field) {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw invalidResponse(endpoint, `${field} must be a string or number`);
  }
  if (
    typeof value === "string" &&
    value.length > COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters
  ) {
    throw invalidResponse(
      endpoint,
      `${field} must contain 1 to ${COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters} characters`,
    );
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters) {
    throw invalidResponse(
      endpoint,
      `${field} must contain 1 to ${COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters} characters`,
    );
  }
  return normalized;
}

/** @param {unknown} payload @param {string} endpoint */
export function validateAcknowledgement(payload, endpoint) {
  if (!ACKNOWLEDGEMENT_ENDPOINTS.has(endpoint)) {
    throw new Error(`Unknown acknowledgement endpoint: ${endpoint}`);
  }
  if (payload !== null && payload !== undefined && !isRecord(payload)) {
    throw invalidResponse(endpoint, "expected an empty response or JSON object");
  }
  return payload === null || payload === undefined ? null : {};
}

/** @param {unknown} payload */
export function validateLoginVerification(payload) {
  const response = requireRecord(payload, "login verification");
  if (
    typeof response.token !== "string" ||
    !response.token.trim() ||
    response.token.length > COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters
  ) {
    throw invalidResponse(
      "login verification",
      `token must contain 1 to ${COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters} characters`,
    );
  }
  if (response.user !== undefined && response.user !== null && !isRecord(response.user)) {
    throw invalidResponse("login verification", "user must be an object or null");
  }
  if (
    isRecord(response.user) &&
    response.user.id !== undefined &&
    typeof response.user.id !== "string" &&
    !(typeof response.user.id === "number" && Number.isFinite(response.user.id))
  ) {
    throw invalidResponse("login verification", "user.id must be a string or finite number");
  }
  if (isRecord(response.user) && response.user.id !== undefined) {
    normalizeRemoteId(response.user.id, "login verification", "user.id");
  }
  for (const { field, maxCharacters } of [
    { field: "name", maxCharacters: COMMUNITY_API_CONTRACT_LIMITS.userNameCharacters },
    { field: "email", maxCharacters: COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters },
  ]) {
    if (
      isRecord(response.user) &&
      response.user[field] !== undefined &&
      typeof response.user[field] !== "string"
    ) {
      throw invalidResponse("login verification", `user.${field} must be a string`);
    }
    if (
      isRecord(response.user) &&
      typeof response.user[field] === "string" &&
      response.user[field].length > maxCharacters
    ) {
      throw invalidResponse(
        "login verification",
        `user.${field} must contain at most ${maxCharacters} characters`,
      );
    }
  }
  const user = isRecord(response.user) ? response.user : response.user === null ? null : undefined;
  return {
    token: response.token.trim(),
    ...(user === undefined
      ? {}
      : {
          user:
            user === null
              ? null
              : {
                  ...(user.id !== undefined
                    ? { id: normalizeRemoteId(user.id, "login verification", "user.id") }
                    : {}),
                  ...(typeof user.name === "string" ? { name: user.name } : {}),
                  ...(typeof user.email === "string" ? { email: user.email } : {}),
                },
        }),
  };
}

/** @param {unknown} payload @param {string} [allowedOrigin] */
export function validateMagicLink(payload, allowedOrigin = "") {
  const response = requireRecord(payload, "magic link");
  const magicLinkValue = typeof response.magic_link === "string" ? response.magic_link : undefined;
  const expiresAtValue = typeof response.expires_at === "string" ? response.expires_at : undefined;
  if (response.magic_link !== undefined && magicLinkValue === undefined) {
    throw invalidResponse("magic link", "magic_link must be a string");
  }
  if (response.expires_at !== undefined && expiresAtValue === undefined) {
    throw invalidResponse("magic link", "expires_at must be a string");
  }
  let magicLink;
  if (magicLinkValue !== undefined) {
    try {
      magicLink = new URL(magicLinkValue);
    } catch {
      throw invalidResponse("magic link", "magic_link must be an absolute HTTPS URL");
    }
    if (magicLink.protocol !== "https:") {
      throw invalidResponse("magic link", "magic_link must be an absolute HTTPS URL");
    }
    if (allowedOrigin && magicLink.origin !== new URL(allowedOrigin).origin) {
      throw invalidResponse("magic link", "magic_link origin is not allowed");
    }
  }
  if (expiresAtValue !== undefined && Number.isNaN(new Date(expiresAtValue).getTime())) {
    throw invalidResponse("magic link", "expires_at must be an ISO-compatible date");
  }
  return {
    ...(magicLink ? { magic_link: magicLink.toString() } : {}),
    ...(expiresAtValue !== undefined ? { expires_at: new Date(expiresAtValue).toISOString() } : {}),
  };
}

/** @param {unknown} payload @param {(value: unknown) => string | null} normalizeStatus */
export function validateCatchPublication(payload, normalizeStatus) {
  const response = requireRecord(payload, "catch publication");
  const publishedCatch = requireRecord(response.catch, "catch publication");
  const id = normalizeRemoteId(publishedCatch.id, "catch publication", "catch.id");
  const status =
    publishedCatch.status === undefined ? null : normalizeStatus(publishedCatch.status);
  if (publishedCatch.status !== undefined && !status) {
    throw invalidResponse("catch publication", "catch.status is unknown");
  }
  return { catch: { id, ...(status ? { status } : {}) } };
}

/**
 * @param {unknown} payload
 * @param {(value: unknown) => string | null} normalizeStatus
 * @param {{allowedIds?: Iterable<string>, maxEntries?: number}} [options]
 */
export function validateModerationStatuses(payload, normalizeStatus, options = {}) {
  const response = requireRecord(payload, "moderation statuses");
  const catches = response.catches ?? [];
  const deletedIds = response.deletedIds ?? [];
  if (!Array.isArray(catches)) {
    throw invalidResponse("moderation statuses", "catches must be an array");
  }
  if (!Array.isArray(deletedIds)) {
    throw invalidResponse("moderation statuses", "deletedIds must be an array");
  }

  const configuredMaxEntries = Number(options.maxEntries);
  const maxEntries =
    Number.isSafeInteger(configuredMaxEntries) && configuredMaxEntries >= 0
      ? Math.min(configuredMaxEntries, COMMUNITY_API_CONTRACT_LIMITS.moderationBatchIds)
      : COMMUNITY_API_CONTRACT_LIMITS.moderationBatchIds;
  if (catches.length + deletedIds.length > maxEntries) {
    throw invalidResponse(
      "moderation statuses",
      `response must contain at most ${maxEntries} total entries`,
    );
  }

  const allowedIds = options.allowedIds ? new Set(options.allowedIds) : null;
  const seenIds = new Set();

  /** @param {string} remoteCatchId @param {string} field */
  const validateUniqueRequestedId = (remoteCatchId, field) => {
    if (seenIds.has(remoteCatchId)) {
      throw invalidResponse("moderation statuses", `${field} duplicates another response id`);
    }
    if (allowedIds && !allowedIds.has(remoteCatchId)) {
      throw invalidResponse("moderation statuses", `${field} contains an unrequested id`);
    }
    seenIds.add(remoteCatchId);
  };

  const statuses = catches.map((entry, index) => {
    if (!isRecord(entry)) {
      throw invalidResponse("moderation statuses", `catches[${index}] must be an object`);
    }
    const remoteCatchId = normalizeRemoteId(
      entry.id,
      "moderation statuses",
      `catches[${index}].id`,
    );
    validateUniqueRequestedId(remoteCatchId, `catches[${index}].id`);
    const status = normalizeStatus(entry.status);
    if (!status) {
      throw invalidResponse("moderation statuses", `catches[${index}].status is unknown`);
    }
    return { remoteCatchId, status };
  });
  const normalizedDeletedIds = deletedIds.map((id, index) => {
    const remoteCatchId = normalizeRemoteId(id, "moderation statuses", `deletedIds[${index}]`);
    validateUniqueRequestedId(remoteCatchId, `deletedIds[${index}]`);
    return remoteCatchId;
  });
  return { statuses, deletedIds: normalizedDeletedIds };
}
