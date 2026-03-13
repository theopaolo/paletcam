import { subscribeCommunitySession } from "./community-session.js";
import { cleanupRemoteCatchForDeletionByRemoteCatchId } from "./community-service.js";

const COMMUNITY_DELETE_OUTBOX_STORAGE_KEY = "paletcam:community:delete-cleanup-outbox:v1";

let isInitialized = false;
let flushPromise = null;
let unsubscribeCommunitySession = () => {};

function getStorage() {
  const storage = globalThis.localStorage;
  return storage && typeof storage.getItem === "function" ? storage : null;
}

function normalizeIsoString(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeRemoteCatchId(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeAttemptCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
}

function normalizeOutboxEntry(candidate) {
  const remoteCatchId = normalizeRemoteCatchId(candidate?.remoteCatchId);
  if (!remoteCatchId) {
    return null;
  }

  return {
    attemptCount: normalizeAttemptCount(candidate?.attemptCount),
    enqueuedAt: normalizeIsoString(candidate?.enqueuedAt) || new Date().toISOString(),
    lastAttemptAt: normalizeIsoString(candidate?.lastAttemptAt),
    remoteCatchId,
  };
}

function readCommunityDeletionCleanupOutbox() {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(COMMUNITY_DELETE_OUTBOX_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seenRemoteCatchIds = new Set();

    return parsed
      .map(normalizeOutboxEntry)
      .filter(Boolean)
      .filter((entry) => {
        if (seenRemoteCatchIds.has(entry.remoteCatchId)) {
          return false;
        }

        seenRemoteCatchIds.add(entry.remoteCatchId);
        return true;
      });
  } catch (_error) {
    return [];
  }
}

function writeCommunityDeletionCleanupOutbox(entries) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    storage.removeItem(COMMUNITY_DELETE_OUTBOX_STORAGE_KEY);
    return;
  }

  storage.setItem(COMMUNITY_DELETE_OUTBOX_STORAGE_KEY, JSON.stringify(entries));
}

function isOnline() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return navigator.onLine !== false;
}

function handleCommunityDeletionCleanupOnline() {
  void flushCommunityDeletionCleanupOutbox();
}

function handleCommunityDeletionCleanupVisibilityChange() {
  if (globalThis.document?.visibilityState !== "visible") {
    return;
  }

  void flushCommunityDeletionCleanupOutbox();
}

function handleCommunitySessionChange(session) {
  if (!session?.token) {
    return;
  }

  void flushCommunityDeletionCleanupOutbox();
}

export function enqueueCommunityDeletionCleanupRetry({ remoteCatchId }) {
  const safeRemoteCatchId = normalizeRemoteCatchId(remoteCatchId);
  if (!safeRemoteCatchId) {
    return false;
  }

  const outbox = readCommunityDeletionCleanupOutbox();
  if (outbox.some((entry) => entry.remoteCatchId === safeRemoteCatchId)) {
    return false;
  }

  outbox.push({
    attemptCount: 0,
    enqueuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    remoteCatchId: safeRemoteCatchId,
  });
  writeCommunityDeletionCleanupOutbox(outbox);
  return true;
}

async function flushCommunityDeletionCleanupOutboxInternal() {
  const initialEntries = readCommunityDeletionCleanupOutbox();

  if (initialEntries.length === 0 || !isOnline()) {
    return {
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: initialEntries.length,
    };
  }

  const runEntryIds = new Set(initialEntries.map((entry) => entry.remoteCatchId));
  const remainingEntries = [];
  let dequeuedCount = 0;

  for (const entry of initialEntries) {
    const result = await cleanupRemoteCatchForDeletionByRemoteCatchId(entry.remoteCatchId);

    if (result.success) {
      dequeuedCount += 1;
      continue;
    }

    remainingEntries.push({
      ...entry,
      attemptCount: entry.attemptCount + 1,
      lastAttemptAt: new Date().toISOString(),
    });
  }

  const newlyQueuedEntries = readCommunityDeletionCleanupOutbox().filter((entry) => {
    return !runEntryIds.has(entry.remoteCatchId);
  });
  const nextEntries = [...remainingEntries, ...newlyQueuedEntries];
  writeCommunityDeletionCleanupOutbox(nextEntries);

  return {
    dequeuedCount,
    processedCount: initialEntries.length,
    remainingCount: nextEntries.length,
  };
}

export async function flushCommunityDeletionCleanupOutbox() {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = flushCommunityDeletionCleanupOutboxInternal().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

export function initializeCommunityDeletionCleanupOutbox() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;
  globalThis.addEventListener?.("online", handleCommunityDeletionCleanupOnline);
  globalThis.document?.addEventListener?.(
    "visibilitychange",
    handleCommunityDeletionCleanupVisibilityChange,
  );
  unsubscribeCommunitySession = subscribeCommunitySession(handleCommunitySessionChange);
  void flushCommunityDeletionCleanupOutbox();
}

export function resetCommunityDeletionCleanupOutboxForTests() {
  if (isInitialized) {
    globalThis.removeEventListener?.("online", handleCommunityDeletionCleanupOnline);
    globalThis.document?.removeEventListener?.(
      "visibilitychange",
      handleCommunityDeletionCleanupVisibilityChange,
    );
    unsubscribeCommunitySession();
  }

  unsubscribeCommunitySession = () => {};
  isInitialized = false;
  flushPromise = null;
}

export { COMMUNITY_DELETE_OUTBOX_STORAGE_KEY };
