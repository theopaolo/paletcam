const STORAGE_KEY = "paletcam:backup:credentials:v1";
const RECOVERY_CODE_PATTERN = /^paletcam-([a-f0-9]{16})-([a-f0-9]{48})$/;

/** @type {Set<(credentials: BackupCredentials | null) => void>} */
const listeners = new Set();

/**
 * Splits a `paletcam-<accountId>-<secret>` recovery code into credentials,
 * tolerating surrounding whitespace and stray uppercase. Returns null when
 * the shape is wrong — the same contract as the server's parser.
 * @returns {BackupCredentials | null}
 */
export function parseBackupRecoveryCode(code) {
  const match = RECOVERY_CODE_PATTERN.exec(
    String(code || "")
      .trim()
      .toLowerCase(),
  );
  return match ? { accountId: match[1], secret: match[2] } : null;
}

/** @param {Partial<BackupCredentials>} credentials */
export function formatBackupRecoveryCode({ accountId, secret }) {
  return `paletcam-${accountId}-${secret}`;
}

/** @returns {BackupCredentials | null} */
export function getBackupCredentials() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parseBackupRecoveryCode(formatBackupRecoveryCode(parsed ?? {}));
  } catch {
    return null;
  }
}

function notifyListeners() {
  const snapshot = getBackupCredentials();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Backup credentials listener failed:", error);
    }
  }
}

/** @param {BackupCredentials} credentials */
export function saveBackupCredentials(credentials) {
  const normalized = parseBackupRecoveryCode(formatBackupRecoveryCode(credentials ?? {}));
  if (!normalized) {
    throw new TypeError("Backup credentials are malformed.");
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn("Unable to persist backup credentials:", error);
  }
  notifyListeners();
  return normalized;
}

export function clearBackupCredentials() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear backup credentials:", error);
  }
  notifyListeners();
}

/** @param {(credentials: BackupCredentials | null) => void} listener */
export function subscribeBackupCredentials(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
