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

/**
 * @param {string} path
 * @param {{credentials: BackupCredentials, method?: string, body?: BodyInit, contentType?: string}} options
 */
async function backupRequest(path, { credentials, method = "GET", body, contentType }) {
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
  } catch (error) {
    throw new BackupApiError("The backup server could not be reached.", {
      code: "network",
      status: undefined,
    });
  }

  if (response.ok) {
    return response;
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

export async function deleteBackupPalette(credentials, backupUid) {
  await backupRequest(`/v1/palettes/${encodeURIComponent(backupUid)}`, {
    credentials,
    method: "DELETE",
  });
}
