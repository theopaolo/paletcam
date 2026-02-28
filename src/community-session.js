const COMMUNITY_SESSION_STORAGE_KEY = "paletcam:community:session:v1";
const COMMUNITY_SESSION_GLOBAL_STORE_KEY = "__paletcamCommunitySessionStore__";

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function normalizeToken(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeUser(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const email = normalizeEmail(candidate.email);

  return {
    id: String(candidate.id ?? ""),
    name: typeof candidate.name === "string" ? candidate.name.trim() : "",
    email,
  };
}

function normalizeSession(candidate) {
  const token = normalizeToken(candidate?.token);
  if (!token) {
    return null;
  }

  const user = normalizeUser(candidate?.user);
  const email = normalizeEmail(candidate?.email || user?.email);

  return {
    token,
    email,
    user,
  };
}

function readStoredSession() {
  try {
    const rawValue = localStorage.getItem(COMMUNITY_SESSION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    return normalizeSession(JSON.parse(rawValue));
  } catch (error) {
    console.warn("Unable to read community session:", error);
    return null;
  }
}

function persistSession(session) {
  try {
    if (!session) {
      localStorage.removeItem(COMMUNITY_SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(COMMUNITY_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn("Unable to persist community session:", error);
  }
}

function getGlobalSessionStore() {
  const host = globalThis;

  if (!host[COMMUNITY_SESSION_GLOBAL_STORE_KEY]) {
    host[COMMUNITY_SESSION_GLOBAL_STORE_KEY] = {
      session: null,
      listeners: new Set(),
    };
  }

  return host[COMMUNITY_SESSION_GLOBAL_STORE_KEY];
}

const sessionStore = getGlobalSessionStore();
if (sessionStore.session === null) {
  sessionStore.session = readStoredSession();
}

function notifySessionListeners() {
  const snapshot = getCommunitySession();
  sessionStore.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Community session listener failed:", error);
    }
  });
}

export function getCommunitySession() {
  if (!sessionStore.session) {
    return null;
  }

  return {
    token: sessionStore.session.token,
    email: sessionStore.session.email,
    user: sessionStore.session.user
      ? { ...sessionStore.session.user }
      : null,
  };
}

export function getCommunityAccessToken() {
  return sessionStore.session?.token ?? "";
}

export function isCommunityAuthenticated() {
  return Boolean(getCommunityAccessToken());
}

export function setCommunitySession(nextSession) {
  const normalizedSession = normalizeSession(nextSession);
  sessionStore.session = normalizedSession;
  persistSession(normalizedSession);
  notifySessionListeners();
  return getCommunitySession();
}

export function clearCommunitySession() {
  if (!sessionStore.session) {
    persistSession(null);
    return;
  }

  sessionStore.session = null;
  persistSession(null);
  notifySessionListeners();
}

export function subscribeCommunitySession(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  sessionStore.listeners.add(listener);
  return () => {
    sessionStore.listeners.delete(listener);
  };
}
