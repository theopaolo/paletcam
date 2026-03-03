const SESSION_STORAGE_KEY = "paletcam:community:session:v1";

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function normalizeSession(candidate) {
  const token = typeof candidate?.token === "string" ? candidate.token.trim() : "";
  if (!token) {
    return null;
  }

  const user = candidate?.user && typeof candidate.user === "object"
    ? {
        id: String(candidate.user.id ?? ""),
        name: typeof candidate.user.name === "string" ? candidate.user.name.trim() : "",
        email: normalizeEmail(candidate.user.email),
      }
    : null;

  const email = normalizeEmail(candidate?.email || user?.email);

  return { token, email, user };
}

function readStoredSession() {
  try {
    const rawValue = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    return normalizeSession(JSON.parse(rawValue));
  } catch (error) {
    console.warn("Unable to read community session:", error);
    return undefined;
  }
}

function persistSession(session) {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn("Unable to persist community session:", error);
  }
}

const initialStoredSession = readStoredSession();
let session = initialStoredSession === undefined ? null : initialStoredSession;
const listeners = new Set();

function notifyListeners() {
  const snapshot = getCommunitySession();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Community session listener failed:", error);
    }
  });
}

function refreshSessionFromStorage() {
  const storedSession = readStoredSession();
  if (storedSession !== undefined) {
    session = storedSession;
  }
}

/** @returns {CommunitySession | null} */
export function getCommunitySession() {
  refreshSessionFromStorage();

  if (!session) {
    return null;
  }

  return {
    token: session.token,
    email: session.email,
    user: session.user ? { ...session.user } : null,
  };
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
  session = normalizeSession(nextSession);
  persistSession(session);
  notifyListeners();
  return getCommunitySession();
}

export function clearCommunitySession() {
  if (!session) {
    persistSession(null);
    return;
  }

  session = null;
  persistSession(null);
  notifyListeners();
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
