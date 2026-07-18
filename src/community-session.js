import { COMMUNITY_API_CONTRACT_LIMITS } from "./community-api-contract.js";

const SESSION_STORAGE_KEY = "paletcam:community:session:v1";
const LOGOUT_TOMBSTONE_VALUE = '{"cleared":true}';

/** @param {unknown} value */
function normalizeEmail(value) {
  if (
    typeof value !== "string" ||
    value.length > COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters
  ) {
    return "";
  }

  return value.trim().toLowerCase();
}

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {unknown} candidate
 * @returns {CommunitySession | null}
 */
function normalizeSession(candidate) {
  if (!isRecord(candidate)) {
    return null;
  }
  const candidateRecord = /** @type {Record<string, unknown>} */ (candidate);
  const rawToken = candidateRecord.token;
  const token =
    typeof rawToken === "string" &&
    rawToken.length <= COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters
      ? rawToken.trim()
      : "";
  if (!token) {
    return null;
  }

  let user = null;
  if (isRecord(candidateRecord.user)) {
    const userRecord = /** @type {Record<string, unknown>} */ (candidateRecord.user);
    const rawId = userRecord.id;
    if (
      rawId !== undefined &&
      typeof rawId !== "string" &&
      !(typeof rawId === "number" && Number.isFinite(rawId))
    ) {
      return null;
    }
    const id =
      typeof rawId === "string" || (typeof rawId === "number" && Number.isFinite(rawId))
        ? String(rawId).trim()
        : "";
    const rawName = userRecord.name;
    if (rawName !== undefined && typeof rawName !== "string") {
      return null;
    }
    const name =
      typeof rawName === "string" &&
      rawName.length <= COMMUNITY_API_CONTRACT_LIMITS.userNameCharacters
        ? rawName.trim()
        : "";
    const rawUserEmail = userRecord.email;
    if (rawUserEmail !== undefined && typeof rawUserEmail !== "string") {
      return null;
    }
    const email = normalizeEmail(rawUserEmail);
    if (
      id.length > COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters ||
      (typeof rawName === "string" &&
        rawName.length > COMMUNITY_API_CONTRACT_LIMITS.userNameCharacters) ||
      (typeof rawUserEmail === "string" && !email && rawUserEmail.trim())
    ) {
      return null;
    }
    user = { id, name, email };
  }

  const rawEmail = candidateRecord.email;
  if (rawEmail !== undefined && typeof rawEmail !== "string") {
    return null;
  }
  const email = normalizeEmail(rawEmail || user?.email);
  if (typeof rawEmail === "string" && !email && rawEmail.trim()) {
    return null;
  }

  return { token, email, user };
}

/**
 * @param {CommunitySession | null} value
 * @returns {CommunitySession | null}
 */
function cloneSession(value) {
  if (!value) {
    return null;
  }

  return {
    token: value.token,
    email: value.email,
    user: value.user ? { ...value.user } : null,
  };
}

/** @param {CommunitySession | null} left @param {CommunitySession | null} right */
export function communitySessionsEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.token === right.token &&
    left.email === right.email &&
    left.user?.id === right.user?.id &&
    left.user?.name === right.user?.name &&
    left.user?.email === right.user?.email
  );
}

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @param {string | null} rawValue @returns {CommunitySession | null} */
function parseStoredSessionValue(rawValue) {
  if (!rawValue) {
    return null;
  }
  return normalizeSession(JSON.parse(rawValue));
}

/** @returns {CommunitySession | null | undefined} */
function readStoredSession() {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(SESSION_STORAGE_KEY);
    return parseStoredSessionValue(rawValue);
  } catch (error) {
    console.warn("Unable to read community session:", error);
    return undefined;
  }
}

/** @param {CommunitySession | null} session */
function persistSession(session) {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  if (!session) {
    let tombstoneWritten = false;
    try {
      storage.setItem(SESSION_STORAGE_KEY, LOGOUT_TOMBSTONE_VALUE);
      tombstoneWritten = true;
    } catch (error) {
      console.warn("Unable to invalidate community session:", error);
    }
    try {
      storage.removeItem(SESSION_STORAGE_KEY);
      return true;
    } catch (error) {
      console.warn("Unable to remove community session:", error);
      return tombstoneWritten;
    }
  }

  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch (error) {
    console.warn("Unable to persist community session:", error);
    return false;
  }
}

const initialStoredSession = readStoredSession();
/** @type {CommunitySession | null} */
let session = initialStoredSession === undefined ? null : initialStoredSession;
let storageRefreshSuppressed = false;
/** @type {Set<(session: CommunitySession | null) => void>} */
const listeners = new Set();

function notifyListeners() {
  const snapshot = cloneSession(session);
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Community session listener failed:", error);
    }
  });
}

function refreshSessionFromStorage() {
  if (storageRefreshSuppressed) return;
  const storedSession = readStoredSession();
  if (storedSession === undefined || communitySessionsEqual(session, storedSession)) return;

  session = storedSession;
  notifyListeners();
}

/** @param {StorageEvent} event */
function handleSessionStorageEvent(event) {
  if (event?.key !== SESSION_STORAGE_KEY) {
    return;
  }

  const storage = getLocalStorage();
  if (event.storageArea && storage && event.storageArea !== storage) {
    return;
  }

  let nextSession;
  try {
    nextSession = parseStoredSessionValue(event.newValue);
  } catch (error) {
    // A corrupted remote-tab write must not leave an old bearer capability
    // active in this tab. Fail closed and notify consumers as a logout.
    console.warn("Unable to synchronize community session:", error);
    nextSession = null;
  }

  // A real cross-tab write supersedes a same-tab failed-clear guard. A null
  // event confirms logout; a valid session event represents an explicit login.
  storageRefreshSuppressed = false;

  if (communitySessionsEqual(session, nextSession)) {
    return;
  }

  session = nextSession;
  notifyListeners();
}

globalThis.addEventListener?.("storage", handleSessionStorageEvent);

/** @returns {CommunitySession | null} */
export function getCommunitySession() {
  refreshSessionFromStorage();

  if (!session) {
    return null;
  }

  return cloneSession(session);
}

export function getCommunityAccessToken() {
  refreshSessionFromStorage();
  return session?.token ?? "";
}

/**
 * @param {Partial<CommunitySession> & { token: string }} nextSession
 * @returns {CommunitySession | null}
 */
export function setCommunitySession(nextSession) {
  const nextNormalizedSession = normalizeSession(nextSession);
  const changed = !communitySessionsEqual(session, nextNormalizedSession);
  session = nextNormalizedSession;
  storageRefreshSuppressed = !persistSession(session);
  if (changed) {
    notifyListeners();
  }
  return getCommunitySession();
}

export function clearCommunitySession() {
  const changed = Boolean(session);
  session = null;
  storageRefreshSuppressed = !persistSession(null);
  if (changed) notifyListeners();
  return !storageRefreshSuppressed;
}

/**
 * @param {(session: CommunitySession | null) => void} listener
 * @returns {() => void}
 */
export function subscribeCommunitySession(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
