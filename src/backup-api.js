import { getBackupApiBaseUrl } from "./config.js";

export class BackupApiError extends Error {
  /** @param {string} message @param {{code: string, status?: number, body?: any}} details */
  constructor(message, { code, status, body = null }) {
    super(message);
    this.name = "BackupApiError";
    this.code = code;
    this.status = status;
    // A 409 body says what the server holds: `{current: {hash} | null, tombstoned}`.
    this.body = body;
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function normalizeHash(value) {
  const hash = String(value ?? "")
    .replace(/^W\//, "")
    .replaceAll('"', "")
    .trim()
    .toLowerCase();
  return HASH_PATTERN.test(hash) ? hash : null;
}

function getErrorCode(status, body) {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 507) return "quota_exceeded";
  if (status === 403 && body?.error === "pairing_disabled") return "pairing_disabled";
  return "server";
}

function authorizationHeader({ accountId, secret }) {
  return `Bearer ${accountId}.${secret}`;
}

export const MAX_RATE_LIMIT_RETRIES = 4;
export const DEFAULT_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 90_000;

let sleepImplementation = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/** Test-only override so retry pacing is assertable without real waits. */
export function setBackupApiSleepForTests(implementation) {
  sleepImplementation =
    implementation ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
}

export function getRetryDelayMs(response) {
  // Retry-After is not CORS-safelisted: unless the server exposes it, the
  // browser answers null here, and Number(null) is 0 — either must fall back
  // to a real pause, never a zero-length retry burst.
  const rawHeader = response.headers.get("retry-after");
  const parsedSeconds = Number(rawHeader);
  if (rawHeader === null || !Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.min(parsedSeconds * 1000, MAX_RETRY_DELAY_MS);
}

/**
 * A restore fetches hundreds of small documents quickly, so hitting the
 * server's per-IP rate limit is normal operation, not an error: 429 responses
 * are retried after the server-advertised delay before giving up.
 *
 * @param {string} path
 * @param {{credentials: BackupCredentials | null, method?: string, body?: BodyInit, contentType?: string, headers?: Record<string, string>, retryRateLimit?: boolean}} options
 */
async function backupRequest(
  path,
  { credentials, method = "GET", body, contentType, headers = {}, retryRateLimit = true },
) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${getBackupApiBaseUrl()}${path}`, {
        method,
        headers: {
          ...(credentials ? { Authorization: authorizationHeader(credentials) } : {}),
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...headers,
        },
        body,
      });
    } catch (_error) {
      throw new BackupApiError("The backup server could not be reached.", {
        code: "network",
        status: undefined,
      });
    }

    if (response.ok) {
      return response;
    }

    if (response.status === 429 && retryRateLimit && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleepImplementation(getRetryDelayMs(response));
      continue;
    }

    const errorBody = await response.json().catch(() => null);
    throw new BackupApiError(`The backup server answered ${response.status}.`, {
      code: getErrorCode(response.status, errorBody),
      status: response.status,
      body: errorBody,
    });
  }
}

/** @returns {Promise<{palettes: Record<string, {hash: string}>, assets: string[], tombstones: Record<string, object>, usageBytes: number}>} */
export async function fetchBackupManifest(credentials) {
  const response = await backupRequest("/v1/manifest", { credentials });
  const body = await response.json();
  return body.manifest;
}

/**
 * Writes a palette only if the server still holds the version this device
 * last saw (`baseHash`), or holds no live version when `baseHash` is null.
 * A mismatch throws a BackupApiError with code "conflict".
 * @returns {Promise<string | null>} hash of the stored document
 */
export async function putBackupPalette(credentials, backupUid, envelope, { baseHash = null } = {}) {
  const response = await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
    method: "PUT",
    body: JSON.stringify(envelope),
    contentType: "application/json",
    headers: baseHash ? { "If-Match": `"${baseHash}"` } : { "If-None-Match": "*" },
  });
  const body = await response.json().catch(() => null);
  return normalizeHash(body?.hash);
}

export async function putBackupAsset(credentials, assetHash, blob) {
  await backupRequest(`/v1/assets/${encodeURIComponent(assetHash)}`, {
    credentials,
    method: "PUT",
    body: blob,
    contentType: "application/octet-stream",
  });
}

/**
 * The hash comes from the ETag, so it names the version actually downloaded
 * even when the manifest read earlier is already stale.
 * @returns {Promise<{envelope: {schemaVersion?: number, palette: object, assets?: string[]}, hash: string | null}>}
 */
export async function fetchBackupPalette(credentials, backupUid) {
  const response = await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
  });
  const hash = normalizeHash(response.headers.get("etag"));
  return { envelope: await response.json(), hash };
}

/** @returns {Promise<Blob>} */
export async function fetchBackupAsset(credentials, assetHash) {
  const response = await backupRequest(`/v1/assets/${encodeURIComponent(assetHash)}`, {
    credentials,
  });
  return response.blob();
}

export async function deleteBackupPalette(credentials, backupUid) {
  await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
    method: "DELETE",
  });
}

/** Deletes the whole account on the server. The credentials stop working. */
export async function deleteBackupAccount(credentials) {
  await backupRequest("/v1/account", { credentials, method: "DELETE" });
}

/**
 * Mints a new backup account. Pairing is rate limited per IP for an hour, so
 * a 429 fails at once instead of waiting through the usual retries.
 * @returns {Promise<BackupCredentials>}
 */
export async function pairBackupAccount() {
  const response = await backupRequest("/v1/pair", {
    credentials: null,
    method: "POST",
    retryRateLimit: false,
  });
  const body = await response.json().catch(() => null);
  const accountId = String(body?.accountId ?? "");
  const secret = String(body?.secret ?? "");
  if (!/^[a-f0-9]{16}$/.test(accountId) || !/^[a-f0-9]{48}$/.test(secret)) {
    throw new BackupApiError("The backup server sent malformed credentials.", {
      code: "server",
      status: response.status,
    });
  }
  return { accountId, secret };
}
