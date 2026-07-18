import { getCommunitySession, subscribeCommunitySession } from "./community-session.js";
import { COMMUNITY_API_CONTRACT_LIMITS } from "./community-api-contract.js";
import {
  deriveCommunityAccountKey,
  deriveCommunityAccountKeyAliases,
  normalizeCommunityAccountKey,
} from "./community-account-key.js";
import {
  cleanupRemoteCatch,
  reconcilePublicationRecoveryForCurrentSession,
} from "./community-service.js";
import { reportAppError } from "./modules/error-reporting.js";
import { db } from "./palette-storage/db.js";

const COMMUNITY_DELETE_OUTBOX_STORAGE_KEY = "paletcam:community:delete-cleanup-outbox:v1";
const MAX_OUTBOX_ENTRIES = 100;
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const OUTBOX_LEASE_DURATION_MS = 60_000;
const MAX_LEASE_ID_LENGTH = 128;
const INVALID_OUTBOX_REPORT_THROTTLE_MS = 60_000;

let isInitialized = false;
let flushPromise = null;
let forceFlushRequested = false;
/** @type {ReturnType<typeof globalThis.setTimeout> | 0} */
let retryTimeoutId = 0;
let unsubscribeCommunitySession = () => {};
let legacyMigrationPromise = null;
const leaseOwner = createLeaseIdentity();

function createLeaseIdentity() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId || `outbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  const remoteCatchId = String(value).trim();
  return remoteCatchId.length <= COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters
    ? remoteCatchId
    : "";
}

function normalizeAttemptCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
}

function getSessionAccountKey(session = getCommunitySession()) {
  return deriveCommunityAccountKey(session);
}

function getSessionAccountKeys(session = getCommunitySession()) {
  return deriveCommunityAccountKeyAliases(session);
}

export function captureDeleteOutboxAccountKey() {
  return getSessionAccountKey();
}

function normalizeAccountKey(value) {
  return normalizeCommunityAccountKey(value) ?? "";
}

function getEntryKey({ accountKey, remoteCatchId }) {
  return `${accountKey}\u0000${remoteCatchId}`;
}

function getRetryDelayMs(attemptCount) {
  const exponent = Math.max(0, Math.min(20, normalizeAttemptCount(attemptCount) - 1));
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exponent);
}

function normalizeOutboxEntry(candidate) {
  const remoteCatchId = normalizeRemoteCatchId(candidate?.remoteCatchId);
  const accountKey = normalizeAccountKey(candidate?.accountKey);
  if (!remoteCatchId || !accountKey) {
    return null;
  }

  return {
    key: getEntryKey({ accountKey, remoteCatchId }),
    accountKey,
    attemptCount: normalizeAttemptCount(candidate?.attemptCount),
    enqueuedAt: normalizeIsoString(candidate?.enqueuedAt) || new Date().toISOString(),
    lastAttemptAt: normalizeIsoString(candidate?.lastAttemptAt),
    nextAttemptAt: normalizeIsoString(candidate?.nextAttemptAt),
    remoteCatchId,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
}

function normalizeStoredIsoString(value, { required = false } = {}) {
  if (value === null || value === undefined) {
    return required ? undefined : null;
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return normalizeIsoString(value) ?? undefined;
}

function normalizeStoredLeaseId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const leaseId = value.trim();
  return leaseId.length > 0 && leaseId.length <= MAX_LEASE_ID_LENGTH ? leaseId : "";
}

/** @returns {CommunityDeleteOutboxRecord | null} */
function normalizeStoredOutboxEntry(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const remoteCatchId =
    typeof candidate.remoteCatchId === "string"
      ? normalizeRemoteCatchId(candidate.remoteCatchId)
      : "";
  const accountKey = normalizeAccountKey(candidate.accountKey);
  const key = getEntryKey({ accountKey, remoteCatchId });
  const attemptCount = Number(candidate.attemptCount);
  const enqueuedAt = normalizeStoredIsoString(candidate.enqueuedAt, { required: true });
  const lastAttemptAt = normalizeStoredIsoString(candidate.lastAttemptAt);
  const nextAttemptAt = normalizeStoredIsoString(candidate.nextAttemptAt);

  if (
    !remoteCatchId ||
    !accountKey ||
    candidate.key !== key ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0 ||
    !enqueuedAt ||
    lastAttemptAt === undefined ||
    nextAttemptAt === undefined
  ) {
    return null;
  }

  const hasLeaseValue =
    candidate.leaseOwner !== null ||
    candidate.leaseToken !== null ||
    candidate.leaseExpiresAt !== null;
  let normalizedLeaseOwner = null;
  let normalizedLeaseToken = null;
  let normalizedLeaseExpiresAt = null;

  if (hasLeaseValue) {
    normalizedLeaseOwner = normalizeStoredLeaseId(candidate.leaseOwner);
    normalizedLeaseToken = normalizeStoredLeaseId(candidate.leaseToken);
    normalizedLeaseExpiresAt = normalizeStoredIsoString(candidate.leaseExpiresAt, {
      required: true,
    });
    if (!normalizedLeaseOwner || !normalizedLeaseToken || !normalizedLeaseExpiresAt) {
      return null;
    }
  }

  return {
    key,
    accountKey,
    attemptCount,
    enqueuedAt,
    lastAttemptAt,
    nextAttemptAt,
    remoteCatchId,
    leaseOwner: normalizedLeaseOwner,
    leaseToken: normalizedLeaseToken,
    leaseExpiresAt: normalizedLeaseExpiresAt,
  };
}

async function readValidatedCurrentOutboxInTransaction() {
  const storedEntries = await db.communityDeleteOutbox.toArray();
  const entries = [];
  const invalidKeys = [];

  for (const candidate of storedEntries) {
    const entry = normalizeStoredOutboxEntry(candidate);
    if (entry) {
      entries.push(entry);
      continue;
    }

    if (typeof candidate?.key === "string") {
      invalidKeys.push(candidate.key);
    }
  }

  if (invalidKeys.length > 0) {
    await db.communityDeleteOutbox.bulkDelete(invalidKeys);
  }

  return { entries, discardedCount: invalidKeys.length };
}

function reportDiscardedInvalidOutboxEntries(discardedCount) {
  if (discardedCount <= 0) {
    return;
  }

  reportAppError(null, {
    logMessage: "Discarded invalid community deletion outbox records.",
    includeConsole: false,
    clientLogKey: "community-delete-outbox-invalid-records",
    clientLogThrottleMs: INVALID_OUTBOX_REPORT_THROTTLE_MS,
    context: {
      discardedCount: Math.min(discardedCount, MAX_OUTBOX_ENTRIES),
      discardedCountCapped: discardedCount > MAX_OUTBOX_ENTRIES,
    },
  });
}

function readLegacyOutbox() {
  try {
    const rawValue = globalThis.localStorage?.getItem(COMMUNITY_DELETE_OUTBOX_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const entriesByKey = new Map();
    for (const candidate of parsed) {
      const entry = normalizeOutboxEntry(candidate);
      if (entry && !entriesByKey.has(entry.key)) {
        entriesByKey.set(entry.key, entry);
      }
      if (entriesByKey.size >= MAX_OUTBOX_ENTRIES) {
        break;
      }
    }
    return [...entriesByKey.values()];
  } catch (_error) {
    return [];
  }
}

async function migrateLegacyOutbox() {
  const legacyEntries = readLegacyOutbox();
  let discardedCount = 0;
  await db.transaction("rw", db.communityDeleteOutbox, async () => {
    const currentOutbox = await readValidatedCurrentOutboxInTransaction();
    const currentEntries = currentOutbox.entries;
    discardedCount = currentOutbox.discardedCount;
    const currentKeys = new Set(currentEntries.map((entry) => entry.key));
    const availableSlots = Math.max(0, MAX_OUTBOX_ENTRIES - currentEntries.length);
    const entriesToMigrate = legacyEntries
      .filter((entry) => !currentKeys.has(entry.key))
      .slice(0, availableSlots);
    if (entriesToMigrate.length > 0) {
      await db.communityDeleteOutbox.bulkPut(entriesToMigrate);
    }
  });
  reportDiscardedInvalidOutboxEntries(discardedCount);

  try {
    globalThis.localStorage?.removeItem(COMMUNITY_DELETE_OUTBOX_STORAGE_KEY);
  } catch (_error) {
    // The durable records are already committed; a later migration is idempotent.
  }
}

function ensureLegacyOutboxMigrated() {
  legacyMigrationPromise ??= migrateLegacyOutbox().catch((error) => {
    legacyMigrationPromise = null;
    throw error;
  });
  return legacyMigrationPromise;
}

function getLatestIsoString(entries, fieldName) {
  return (
    entries
      .map((entry) => entry[fieldName])
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  );
}

function mergeOutboxAliasEntries(entries, canonicalAccountKey) {
  const [firstEntry] = entries;
  const enqueuedAt = entries.map((entry) => entry.enqueuedAt).sort()[0];
  return {
    ...firstEntry,
    key: getEntryKey({
      accountKey: canonicalAccountKey,
      remoteCatchId: firstEntry.remoteCatchId,
    }),
    accountKey: canonicalAccountKey,
    attemptCount: Math.max(...entries.map((entry) => entry.attemptCount)),
    enqueuedAt,
    lastAttemptAt: getLatestIsoString(entries, "lastAttemptAt"),
    nextAttemptAt: getLatestIsoString(entries, "nextAttemptAt"),
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
}

async function canonicalizeCurrentSessionOutboxAliases() {
  const accountKeys = getSessionAccountKeys();
  const canonicalAccountKey = accountKeys[0] ?? "";
  if (!canonicalAccountKey || accountKeys.length < 2) {
    return;
  }

  let discardedCount = 0;
  await db.transaction("rw", db.communityDeleteOutbox, async () => {
    const currentOutbox = await readValidatedCurrentOutboxInTransaction();
    discardedCount = currentOutbox.discardedCount;
    const accountKeySet = new Set(accountKeys);
    const entriesByRemoteCatchId = new Map();

    for (const entry of currentOutbox.entries) {
      if (!accountKeySet.has(entry.accountKey)) continue;
      const entries = entriesByRemoteCatchId.get(entry.remoteCatchId) ?? [];
      entries.push(entry);
      entriesByRemoteCatchId.set(entry.remoteCatchId, entries);
    }

    for (const entries of entriesByRemoteCatchId.values()) {
      const alreadyCanonical =
        entries.length === 1 && entries[0].accountKey === canonicalAccountKey;
      // Never rewrite a job another tab is actively processing. The next read
      // canonicalizes it after its lease is finalized or expires.
      const nowMs = Date.now();
      if (alreadyCanonical || entries.some((entry) => !isLeaseAvailable(entry, nowMs))) continue;

      const canonicalEntry = mergeOutboxAliasEntries(entries, canonicalAccountKey);
      const aliasKeys = entries
        .map((entry) => entry.key)
        .filter((key) => key !== canonicalEntry.key);
      if (aliasKeys.length > 0) {
        await db.communityDeleteOutbox.bulkDelete(aliasKeys);
      }
      await db.communityDeleteOutbox.put(canonicalEntry);
    }
  });
  reportDiscardedInvalidOutboxEntries(discardedCount);
}

export async function prepareDeleteOutbox() {
  await ensureLegacyOutboxMigrated();
  await canonicalizeCurrentSessionOutboxAliases();
}

export async function preparePaletteDeletionRemoteCleanup(paletteId) {
  await reconcilePublicationRecoveryForCurrentSession({ paletteId });
  await prepareDeleteOutbox();
}

export async function reserveDeleteRetryInCurrentTransaction({ accountKey, remoteCatchId }) {
  const safeRemoteCatchId = normalizeRemoteCatchId(remoteCatchId);
  const safeAccountKey = normalizeAccountKey(accountKey);
  if (!safeRemoteCatchId || !safeAccountKey) {
    return { discardedCount: 0, enqueued: false, reserved: false };
  }

  const key = getEntryKey({ accountKey: safeAccountKey, remoteCatchId: safeRemoteCatchId });
  const currentOutbox = await readValidatedCurrentOutboxInTransaction();
  if (currentOutbox.entries.some((entry) => entry.key === key)) {
    return {
      discardedCount: currentOutbox.discardedCount,
      enqueued: false,
      reserved: true,
    };
  }

  if (currentOutbox.entries.length >= MAX_OUTBOX_ENTRIES) {
    return {
      discardedCount: currentOutbox.discardedCount,
      enqueued: false,
      reserved: false,
    };
  }

  await db.communityDeleteOutbox.put({
    key,
    accountKey: safeAccountKey,
    attemptCount: 0,
    enqueuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    nextAttemptAt: null,
    remoteCatchId: safeRemoteCatchId,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  });
  return {
    discardedCount: currentOutbox.discardedCount,
    enqueued: true,
    reserved: true,
  };
}

async function readOutbox() {
  await prepareDeleteOutbox();
  const result = await db.transaction("rw", db.communityDeleteOutbox, () =>
    readValidatedCurrentOutboxInTransaction(),
  );
  reportDiscardedInvalidOutboxEntries(result.discardedCount);
  return result.entries;
}

function isOnline() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return navigator.onLine !== false;
}

function clearRetryTimeout() {
  if (!retryTimeoutId) {
    return;
  }

  globalThis.clearTimeout?.(retryTimeoutId);
  retryTimeoutId = 0;
}

function getEntryEligibleAt(entry, nowMs) {
  const nextAttemptMs = entry.nextAttemptAt ? new Date(entry.nextAttemptAt).getTime() : nowMs;
  const leaseExpiresMs = entry.leaseExpiresAt
    ? new Date(entry.leaseExpiresAt).getTime()
    : Number.NEGATIVE_INFINITY;
  return Math.max(
    Number.isFinite(nextAttemptMs) ? nextAttemptMs : nowMs,
    Number.isFinite(leaseExpiresMs) ? leaseExpiresMs : Number.NEGATIVE_INFINITY,
  );
}

function scheduleNextRetry(entries, accountKeys) {
  clearRetryTimeout();
  const accountKeySet = new Set(accountKeys);
  if (!isInitialized || !isOnline() || accountKeySet.size === 0) {
    return;
  }

  const nowMs = Date.now();
  const nextAttemptMs = entries
    .filter((entry) => accountKeySet.has(entry.accountKey))
    .map((entry) => getEntryEligibleAt(entry, nowMs))
    .filter(Number.isFinite)
    .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);

  if (!Number.isFinite(nextAttemptMs)) {
    return;
  }

  const delayMs = Math.max(0, nextAttemptMs - nowMs);
  retryTimeoutId = globalThis.setTimeout?.(() => {
    retryTimeoutId = 0;
    flushDeleteOutboxInBackground();
  }, delayMs);
}

function flushDeleteOutboxInBackground(options) {
  void flushDeleteOutbox(options).catch((error) => {
    reportAppError(error, {
      logMessage: "Failed to process the remote deletion outbox.",
      includeConsole: false,
    });
  });
}

function reconcilePublicationRecoveryInBackground() {
  void reconcilePublicationRecoveryForCurrentSession().catch((error) => {
    reportAppError(error, {
      logMessage: "Failed to reconcile an uncertain community publication.",
      includeConsole: false,
    });
  });
}

function handleOnline() {
  reconcilePublicationRecoveryInBackground();
  flushDeleteOutboxInBackground({ force: true });
}

function handleVisibilityChange() {
  if (globalThis.document?.visibilityState !== "visible") {
    return;
  }

  // Mobile Safari does not always emit `online` when an installed PWA regains
  // connectivity. Returning to the foreground is a second, bounded recovery
  // opportunity; transactional leases still prevent duplicate processing.
  reconcilePublicationRecoveryInBackground();
  flushDeleteOutboxInBackground({ force: true });
}

function handleCommunitySessionChange(session) {
  if (!session?.token) {
    return;
  }

  reconcilePublicationRecoveryInBackground();
  flushDeleteOutboxInBackground({ force: true });
}

export async function enqueueDeleteRetry({ remoteCatchId }) {
  const safeRemoteCatchId = normalizeRemoteCatchId(remoteCatchId);
  const accountKey = getSessionAccountKey();
  if (!safeRemoteCatchId || !accountKey) {
    return false;
  }

  await prepareDeleteOutbox();
  const result = await db.transaction("rw", db.communityDeleteOutbox, () =>
    reserveDeleteRetryInCurrentTransaction({ accountKey, remoteCatchId: safeRemoteCatchId }),
  );
  reportDiscardedInvalidOutboxEntries(result.discardedCount);
  return result.enqueued;
}

function isEntryDue(entry, nowMs, force) {
  if (force || !entry.nextAttemptAt) {
    return true;
  }

  return new Date(entry.nextAttemptAt).getTime() <= nowMs;
}

function isLeaseAvailable(entry, nowMs) {
  if (!entry.leaseToken || !entry.leaseExpiresAt) {
    return true;
  }
  const leaseExpiresMs = new Date(entry.leaseExpiresAt).getTime();
  return !Number.isFinite(leaseExpiresMs) || leaseExpiresMs <= nowMs;
}

async function claimNextEntry({ accountKeys, candidateKeys, force }) {
  const accountKeySet = new Set(accountKeys);
  const result = await db.transaction("rw", db.communityDeleteOutbox, async () => {
    const nowMs = Date.now();
    const currentOutbox = await readValidatedCurrentOutboxInTransaction();
    const entries = currentOutbox.entries;
    const entry = entries
      .filter(
        (candidate) =>
          accountKeySet.has(candidate.accountKey) &&
          candidateKeys.has(candidate.key) &&
          isEntryDue(candidate, nowMs, force) &&
          isLeaseAvailable(candidate, nowMs),
      )
      .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt))[0];

    if (!entry) {
      return { entry: null, discardedCount: currentOutbox.discardedCount };
    }

    const leaseToken = createLeaseIdentity();
    const claimedEntry = {
      ...entry,
      leaseOwner,
      leaseToken,
      leaseExpiresAt: new Date(nowMs + OUTBOX_LEASE_DURATION_MS).toISOString(),
    };
    await db.communityDeleteOutbox.put(claimedEntry);
    return { entry: claimedEntry, discardedCount: currentOutbox.discardedCount };
  });
  reportDiscardedInvalidOutboxEntries(result.discardedCount);
  return result.entry;
}

function ownsClaim(currentEntry, claimedEntry) {
  return (
    currentEntry?.leaseOwner === leaseOwner && currentEntry?.leaseToken === claimedEntry.leaseToken
  );
}

async function releaseClaim(claimedEntry) {
  return db.transaction("rw", db.communityDeleteOutbox, async () => {
    const currentEntry = await db.communityDeleteOutbox.get(claimedEntry.key);
    if (!ownsClaim(currentEntry, claimedEntry)) {
      return false;
    }
    await db.communityDeleteOutbox.put({
      ...currentEntry,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return true;
  });
}

async function finalizeClaim(claimedEntry, success) {
  return db.transaction("rw", db.communityDeleteOutbox, async () => {
    const currentEntry = await db.communityDeleteOutbox.get(claimedEntry.key);
    if (!ownsClaim(currentEntry, claimedEntry)) {
      return false;
    }

    if (success) {
      await db.communityDeleteOutbox.delete(claimedEntry.key);
      return true;
    }

    const attemptCount = currentEntry.attemptCount + 1;
    const attemptedAt = new Date();
    await db.communityDeleteOutbox.put({
      ...currentEntry,
      attemptCount,
      lastAttemptAt: attemptedAt.toISOString(),
      nextAttemptAt: new Date(attemptedAt.getTime() + getRetryDelayMs(attemptCount)).toISOString(),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return true;
  });
}

async function runOutboxFlush({ force = false } = {}) {
  const initialEntries = await readOutbox();
  const accountKeys = getSessionAccountKeys();
  const sessionAccountKey = accountKeys[0] ?? "";

  if (initialEntries.length === 0 || !isOnline() || !sessionAccountKey) {
    return {
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: initialEntries.length,
    };
  }

  const nowMs = Date.now();
  const candidateKeys = new Set(
    initialEntries
      .filter((entry) => accountKeys.includes(entry.accountKey) && isEntryDue(entry, nowMs, force))
      .map((entry) => entry.key),
  );
  let dequeuedCount = 0;
  let processedCount = 0;

  while (candidateKeys.size > 0) {
    if (getSessionAccountKey() !== sessionAccountKey) {
      break;
    }

    const claimedEntry = await claimNextEntry({ accountKeys, candidateKeys, force });
    if (!claimedEntry) {
      break;
    }
    candidateKeys.delete(claimedEntry.key);

    if (getSessionAccountKey() !== sessionAccountKey) {
      await releaseClaim(claimedEntry);
      break;
    }

    processedCount += 1;
    let result;
    try {
      result = await cleanupRemoteCatch(claimedEntry.remoteCatchId);
    } catch (_error) {
      result = { success: false };
    }

    const claimFinalized = await finalizeClaim(claimedEntry, result.success === true);
    if (claimFinalized && result.success) {
      dequeuedCount += 1;
    }
  }

  const remainingEntries = await readOutbox();
  scheduleNextRetry(remainingEntries, getSessionAccountKeys());

  return {
    dequeuedCount,
    processedCount,
    remainingCount: remainingEntries.length,
  };
}

export async function flushDeleteOutbox(options) {
  if (flushPromise) {
    forceFlushRequested ||= options?.force === true;
    return flushPromise;
  }

  flushPromise = (async () => {
    let result = await runOutboxFlush(options);
    while (forceFlushRequested) {
      forceFlushRequested = false;
      result = await runOutboxFlush({ force: true });
    }
    return result;
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

export function initializeDeleteOutbox() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;
  globalThis.addEventListener?.("online", handleOnline);
  globalThis.document?.addEventListener?.("visibilitychange", handleVisibilityChange);
  unsubscribeCommunitySession = subscribeCommunitySession(handleCommunitySessionChange);
  reconcilePublicationRecoveryInBackground();
  flushDeleteOutboxInBackground();
}

export function resetDeleteOutboxForTests() {
  if (isInitialized) {
    globalThis.removeEventListener?.("online", handleOnline);
    globalThis.document?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    unsubscribeCommunitySession();
  }

  unsubscribeCommunitySession = () => {};
  isInitialized = false;
  flushPromise = null;
  forceFlushRequested = false;
  legacyMigrationPromise = null;
  clearRetryTimeout();
}

export {
  COMMUNITY_DELETE_OUTBOX_STORAGE_KEY,
  MAX_OUTBOX_ENTRIES,
  OUTBOX_LEASE_DURATION_MS,
  RETRY_BASE_DELAY_MS,
};
