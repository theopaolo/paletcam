import { getBackupApiBaseUrl } from "./config.js";

export class BackupApiError extends Error {
  /** @param {string} message @param {{code: string, status?: number}} details */
  constructor(message, { code, status }) {
    super(message);
    this.name = "BackupApiError";
    this.code = code;
    this.status = status;
  }
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
 * @param {{credentials: BackupCredentials, method?: string, body?: BodyInit, contentType?: string}} options
 */
async function backupRequest(path, { credentials, method = "GET", body, contentType }) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${getBackupApiBaseUrl()}${path}`, {
        method,
        headers: {
          Authorization: authorizationHeader(credentials),
          ...(contentType ? { "Content-Type": contentType } : {}),
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

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleepImplementation(getRetryDelayMs(response));
      continue;
    }

    const code =
      response.status === 401
        ? "unauthorized"
        : response.status === 507
          ? "quota_exceeded"
          : response.status === 429
            ? "rate_limited"
            : "server";
    throw new BackupApiError(`The backup server answered ${response.status}.`, {
      code,
      status: response.status,
    });
  }
}

/** @returns {Promise<{palettes: Record<string, {hash: string}>, assets: string[], tombstones: Record<string, object>, usageBytes: number}>} */
export async function fetchBackupManifest(credentials) {
  const response = await backupRequest("/v1/manifest", { credentials });
  const body = await response.json();
  return body.manifest;
}

export async function putBackupPalette(credentials, backupUid, envelope) {
  await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
    method: "PUT",
    body: JSON.stringify(envelope),
    contentType: "application/json",
  });
}

export async function putBackupAsset(credentials, assetHash, blob) {
  await backupRequest(`/v1/assets/${encodeURIComponent(assetHash)}`, {
    credentials,
    method: "PUT",
    body: blob,
    contentType: "application/octet-stream",
  });
}

/** @returns {Promise<{schemaVersion?: number, palette: object, assets?: string[]}>} */
export async function fetchBackupPalette(credentials, backupUid) {
  const response = await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
  });
  return response.json();
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
