import {
  CATCH_MODERATION_STATUSES,
  normalizeCatchStatus,
  postCatchToCommunity,
  unpublishCatchFromCommunity,
} from "../community-api.js";
import { communitySessionsEqual, getCommunitySession } from "../community-session.js";
import {
  deriveCommunityAccountKeyAliases,
  deriveCommunityAccountKey,
  normalizeCommunityAccountKey,
  paletteRemoteOwnerMatchesSession,
} from "../community-account-key.js";
import {
  bulkUpdateOwnedPaletteRemoteStates,
  ensurePaletteMasterPhotoBlob,
  updatePaletteRemoteState,
} from "../palette-storage.js";
import { buildCommunityCatchPublishPayload } from "../modules/community-publish-payload.js";
import { beginCriticalOperation } from "../modules/critical-operation.js";
import { reportAppError } from "../modules/error-reporting.js";
import { createCommunityServiceError, mapApiError } from "./errors.js";
import { applyPaletteRemoteState, getPaletteRemoteCatchId } from "./palette-state.js";
import { blobToBase64 } from "../modules/blob-base64.js";
import { COMMUNITY_API_CONTRACT_LIMITS } from "../community-api-contract.js";

const PUBLICATION_STATE_WRITE_ATTEMPTS = 2;
const PUBLICATION_RECOVERY_STORAGE_KEY = "paletcam:community:publication-recovery:v1";
const MAX_PUBLICATION_RECOVERY_ENTRIES = 20;

function createImmutablePublicationSession(candidate = getCommunitySession()) {
  const token = String(candidate?.token || "").trim();
  if (!token) {
    throw createCommunityServiceError("Authentication required.", { code: "NOT_AUTHENTICATED" });
  }

  const user = candidate?.user
    ? Object.freeze({
        id: candidate.user.id,
        name: candidate.user.name,
        email: candidate.user.email,
      })
    : null;
  return Object.freeze({
    token,
    email: String(candidate?.email || ""),
    user,
  });
}

/** @param {CommunitySession | null | undefined} expectedSession */
export function isCommunityPublicationSessionCurrent(expectedSession) {
  const expected = expectedSession ?? null;
  return expected !== null && communitySessionsEqual(getCommunitySession(), expected);
}

function createPublicationSessionChangedError(cause) {
  return createCommunityServiceError("The community session changed. Try again.", {
    code: "SESSION_CHANGED",
    cause,
  });
}

function assertPublicationSessionCurrent(expectedSession) {
  if (!isCommunityPublicationSessionCurrent(expectedSession)) {
    throw createPublicationSessionChangedError();
  }
}

function assertPaletteRemoteOwner(palette, session) {
  if (!normalizeCommunityAccountKey(palette?.remoteOwnerAccountKey)) {
    throw createCommunityServiceError("The palette's publishing account cannot be verified.", {
      code: "REMOTE_OWNER_UNKNOWN",
    });
  }
  if (!paletteRemoteOwnerMatchesSession(palette, session)) {
    throw createCommunityServiceError(
      "This palette was published by a different community account.",
      { code: "REMOTE_OWNER_MISMATCH" },
    );
  }
}

function assertPaletteRemoteOwnerIfKnown(palette, session) {
  const ownerAccountKey = normalizeCommunityAccountKey(palette?.remoteOwnerAccountKey);
  if (!ownerAccountKey) return false;
  if (!paletteRemoteOwnerMatchesSession(palette, session)) {
    throw createCommunityServiceError(
      "This palette was published by a different community account.",
      { code: "REMOTE_OWNER_MISMATCH" },
    );
  }
  return true;
}

function getLegacyRemoteOwnerClaimAccountKey(session) {
  const ownerAccountKey = deriveCommunityAccountKey(session);
  if (!ownerAccountKey) {
    throw createCommunityServiceError("A stable community account identity is required.", {
      code: "COMMUNITY_ACCOUNT_IDENTITY_REQUIRED",
    });
  }
  return ownerAccountKey;
}

function createLegacyRemoteOwnerUnverifiedError(cause) {
  return createCommunityServiceError(
    "The palette's publishing account could not be verified by the server.",
    { code: "REMOTE_OWNER_UNKNOWN", cause },
  );
}

async function runCriticalPublication(operation) {
  const releaseCriticalOperation = beginCriticalOperation("community-publication");
  try {
    return await operation();
  } finally {
    releaseCriticalOperation();
  }
}

function fallbackStableHash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

async function hashPublicationIdentity(value) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  return fallbackStableHash(value);
}

async function createPublishOperationKey(palette, remoteOwnerAccountKey, publishTimestamp) {
  const operationIdentity = [
    remoteOwnerAccountKey,
    palette?.id ?? "",
    publishTimestamp,
    getPaletteRemoteCatchId(palette),
    normalizeCatchStatus(palette?.moderationStatus) || "",
    palette?.moderationUpdatedAt || "",
  ].join("\u001f");
  const digest = await hashPublicationIdentity(operationIdentity);
  return `paletcam-publish-${digest}`;
}

function readPublicationRecoveryJournal() {
  try {
    const rawValue = globalThis.localStorage?.getItem(PUBLICATION_RECOVERY_STORAGE_KEY);
    if (!rawValue) return [];
    const entries = JSON.parse(rawValue);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !/^paletcam-publish-[a-f0-9]{16,64}$/.test(entry.operationKey)
        ) {
          return false;
        }
        const paletteId = Number(entry.paletteId);
        if (!Number.isSafeInteger(paletteId) || paletteId <= 0) {
          return false;
        }
        if (entry.state === "reserved") {
          return (
            entry.remoteCatchId === null &&
            normalizeCommunityAccountKey(entry.remoteOwnerAccountKey) !== null
          );
        }
        return (
          typeof entry.remoteCatchId === "string" &&
          entry.remoteCatchId.length > 0 &&
          entry.remoteCatchId.length <= COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters &&
          normalizeCommunityAccountKey(entry.remoteOwnerAccountKey) !== null
        );
      })
      .slice(-MAX_PUBLICATION_RECOVERY_ENTRIES)
      .map((entry) =>
        entry.state === "reserved"
          ? {
              operationKey: entry.operationKey,
              paletteId: Number(entry.paletteId),
              remoteCatchId: null,
              remoteOwnerAccountKey: normalizeCommunityAccountKey(entry.remoteOwnerAccountKey),
              state: "reserved",
            }
          : {
              operationKey: entry.operationKey,
              paletteId: Number(entry.paletteId),
              remoteCatchId: entry.remoteCatchId,
              remoteOwnerAccountKey: normalizeCommunityAccountKey(entry.remoteOwnerAccountKey),
              moderationStatus:
                normalizeCatchStatus(entry.moderationStatus) ||
                CATCH_MODERATION_STATUSES.TO_MODERATE,
              postedAt: typeof entry.postedAt === "string" ? entry.postedAt : null,
              moderationUpdatedAt:
                typeof entry.moderationUpdatedAt === "string" ? entry.moderationUpdatedAt : null,
              lastModerationCheckAt:
                typeof entry.lastModerationCheckAt === "string"
                  ? entry.lastModerationCheckAt
                  : null,
              state: "remote_created",
            },
      );
  } catch {
    return [];
  }
}

function reservePublicationRecovery(operationKey, remoteOwnerAccountKey, paletteId) {
  const normalizedPaletteId = Number(paletteId);
  if (!Number.isSafeInteger(normalizedPaletteId) || normalizedPaletteId <= 0) {
    return false;
  }
  const entries = readPublicationRecoveryJournal();
  if (entries.some((entry) => entry.operationKey === operationKey)) {
    return true;
  }
  if (entries.length >= MAX_PUBLICATION_RECOVERY_ENTRIES) {
    return false;
  }
  entries.push({
    operationKey,
    paletteId: normalizedPaletteId,
    remoteCatchId: null,
    remoteOwnerAccountKey,
    state: "reserved",
  });
  return writePublicationRecoveryJournal(entries);
}

function writePublicationRecoveryJournal(entries) {
  try {
    if (!globalThis.localStorage || entries.length > MAX_PUBLICATION_RECOVERY_ENTRIES) return false;
    if (entries.length === 0) {
      globalThis.localStorage.removeItem(PUBLICATION_RECOVERY_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(PUBLICATION_RECOVERY_STORAGE_KEY, JSON.stringify(entries));
    }
    return true;
  } catch {
    return false;
  }
}

function rememberPublicationRecovery(operationKey, paletteId, nextRemoteState) {
  const normalizedPaletteId = Number(paletteId);
  if (!Number.isSafeInteger(normalizedPaletteId) || normalizedPaletteId <= 0) {
    return false;
  }
  const entries = readPublicationRecoveryJournal().filter(
    (entry) => entry.operationKey !== operationKey,
  );
  if (entries.length >= MAX_PUBLICATION_RECOVERY_ENTRIES) return false;
  entries.push({
    operationKey,
    paletteId: normalizedPaletteId,
    remoteCatchId: nextRemoteState.remoteCatchId,
    remoteOwnerAccountKey: normalizeCommunityAccountKey(nextRemoteState.remoteOwnerAccountKey),
    state: "remote_created",
    moderationStatus: nextRemoteState.moderationStatus,
    postedAt: nextRemoteState.postedAt,
    moderationUpdatedAt: nextRemoteState.moderationUpdatedAt,
    lastModerationCheckAt: nextRemoteState.lastModerationCheckAt,
  });
  return writePublicationRecoveryJournal(entries);
}

/**
 * Reconciles remote publications that were created but could not be durably
 * attached to their local palette. The local palette id is part of the journal
 * so startup and deletion flows can recover without requiring another publish.
 * @param {{paletteId?: number | string}} [options]
 */
export async function reconcilePublicationRecoveryForCurrentSession({ paletteId } = {}) {
  const session = getCommunitySession();
  const token = String(session?.token || "").trim();
  const accountKeys = new Set(deriveCommunityAccountKeyAliases(session));
  if (!token || accountKeys.size === 0) {
    return { reconciledCount: 0, remainingCount: readPublicationRecoveryJournal().length };
  }

  const requestedPaletteId =
    paletteId === undefined
      ? null
      : Number.isSafeInteger(Number(paletteId))
        ? Number(paletteId)
        : -1;
  const recoveryEntries = readPublicationRecoveryJournal();
  if (
    requestedPaletteId !== null &&
    recoveryEntries.some(
      (entry) =>
        entry.paletteId === requestedPaletteId &&
        entry.state === "reserved" &&
        accountKeys.has(entry.remoteOwnerAccountKey),
    )
  ) {
    throw createCommunityServiceError(
      "The publication outcome is still uncertain. Retry publication before deleting this palette.",
      { code: "PUBLICATION_STATE_UNCERTAIN" },
    );
  }
  const pendingEntries = recoveryEntries.filter(
    (entry) =>
      entry.state === "remote_created" &&
      accountKeys.has(entry.remoteOwnerAccountKey) &&
      (requestedPaletteId === null || entry.paletteId === requestedPaletteId),
  );
  let reconciledCount = 0;

  for (const pending of pendingEntries) {
    try {
      await unpublishCatchFromCommunity({ token, remoteCatchId: pending.remoteCatchId });
    } catch (error) {
      if (Number(error?.status) !== 404) {
        throw mapApiError(error, { expectedToken: token });
      }
    }

    const nowIso = new Date().toISOString();
    await bulkUpdateOwnedPaletteRemoteStates(
      [
        {
          id: pending.paletteId,
          expectedRemoteCatchId: pending.remoteCatchId,
          patch: {
            moderationStatus: CATCH_MODERATION_STATUSES.PRIVATE,
            moderationUpdatedAt: nowIso,
            lastModerationCheckAt: nowIso,
          },
        },
      ],
      { ownerAccountKey: pending.remoteOwnerAccountKey },
    );
    forgetPublicationRecovery(pending.operationKey);
    reconciledCount += 1;
  }

  return {
    reconciledCount,
    remainingCount: readPublicationRecoveryJournal().length,
  };
}

function forgetPublicationRecovery(operationKey) {
  const entries = readPublicationRecoveryJournal();
  const remaining = entries.filter((entry) => entry.operationKey !== operationKey);
  if (remaining.length === entries.length) return;
  writePublicationRecoveryJournal(remaining);
}

async function reconcilePendingPublication(operationKey, token, palette, remoteOwnerAccountKey) {
  const pending = readPublicationRecoveryJournal().find(
    (entry) => entry.operationKey === operationKey,
  );
  if (!pending || pending.state === "reserved") return;
  if (pending.remoteOwnerAccountKey !== remoteOwnerAccountKey) {
    throw createCommunityServiceError(
      "Publication recovery belongs to a different community account.",
      { code: "PUBLICATION_RECOVERY_OWNER_MISMATCH" },
    );
  }

  try {
    await unpublishCatchFromCommunity({ token, remoteCatchId: pending.remoteCatchId });
    forgetPublicationRecovery(operationKey);
  } catch (error) {
    if (Number(error?.status) === 404) {
      forgetPublicationRecovery(operationKey);
      return;
    }

    applyPaletteRemoteState(palette, pending);
    throw createCommunityServiceError(
      "A previous publication still needs to be reconciled before retrying.",
      { code: "PUBLICATION_STATE_UNCERTAIN", cause: error },
    );
  }
}

async function persistPaletteRemoteStateWithRetry(palette, nextRemoteState) {
  let lastError = null;
  for (let attempt = 0; attempt < PUBLICATION_STATE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await updatePaletteRemoteState(palette.id, nextRemoteState);
      applyPaletteRemoteState(palette, nextRemoteState);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function compensateFailedPublication({
  token,
  remoteCatchId,
  logMessage = "Failed to compensate a publication after local persistence failed.",
}) {
  try {
    await unpublishCatchFromCommunity({ token, remoteCatchId });
    return true;
  } catch (error) {
    if (Number(error?.status) === 404) {
      return true;
    }

    reportAppError(error, {
      logMessage,
      includeConsole: false,
      context: { errorName: error?.name || "Error" },
    });
    return false;
  }
}

/**
 * @param {string} remoteCatchId
 * @returns {PaletteDeleteRemoteCleanupResult}
 */
function buildRemoteDeletionCleanupAuthRequiredResult(remoteCatchId) {
  return {
    attempted: false,
    error: createCommunityServiceError("Authentication required.", { code: "NOT_AUTHENTICATED" }),
    remoteCatchId,
    status: "authentication_required",
    success: false,
  };
}

async function persistPalettePrivateRemoteState(palette, { remoteOwnerAccountKey = "" } = {}) {
  const nowIso = new Date().toISOString();
  const nextRemoteState = {
    ...(remoteOwnerAccountKey ? { remoteOwnerAccountKey } : {}),
    moderationStatus: CATCH_MODERATION_STATUSES.PRIVATE,
    moderationUpdatedAt: nowIso,
    lastModerationCheckAt: nowIso,
  };

  try {
    await updatePaletteRemoteState(palette.id, nextRemoteState);
  } catch (error) {
    reportAppError(error, {
      logMessage: "Failed to persist palette private remote state.",
      includeConsole: false,
    });
  }

  applyPaletteRemoteState(palette, nextRemoteState);
}

/**
 * @param {string | null | undefined} remoteCatchId
 * @returns {Promise<PaletteDeleteRemoteCleanupResult>}
 */
async function cleanupRemoteCatchOperation(remoteCatchId, session = getCommunitySession()) {
  const safeRemoteCatchId = String(remoteCatchId || "").trim();
  if (!safeRemoteCatchId) {
    return {
      attempted: false,
      remoteCatchId: "",
      status: "not_published",
      success: true,
    };
  }

  const token = String(session?.token || "").trim();
  if (!token) {
    return buildRemoteDeletionCleanupAuthRequiredResult(safeRemoteCatchId);
  }

  try {
    await unpublishCatchFromCommunity({
      token,
      remoteCatchId: safeRemoteCatchId,
    });
  } catch (error) {
    if (Number(error?.status) === 404) {
      return {
        attempted: true,
        remoteCatchId: safeRemoteCatchId,
        status: "already_removed",
        success: true,
      };
    }

    const mappedError =
      error?.name === "CommunityServiceError"
        ? error
        : mapApiError(error, { expectedToken: token });

    if (mappedError?.code === "AUTH_EXPIRED" || mappedError?.code === "NOT_AUTHENTICATED") {
      return {
        attempted: true,
        error: mappedError,
        remoteCatchId: safeRemoteCatchId,
        status: "authentication_required",
        success: false,
      };
    }

    return {
      attempted: true,
      error: mappedError,
      remoteCatchId: safeRemoteCatchId,
      status: "failed",
      success: false,
    };
  }

  return {
    attempted: true,
    remoteCatchId: safeRemoteCatchId,
    status: "unpublished",
    success: true,
  };
}

export function cleanupRemoteCatch(remoteCatchId) {
  const session = getCommunitySession();
  return runCriticalPublication(() => cleanupRemoteCatchOperation(remoteCatchId, session));
}

/**
 * @param {Palette} palette
 * @returns {Promise<PaletteDeleteRemoteCleanupResult>}
 */
async function cleanupPaletteRemoteCatchOperation(palette) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError("Palette is required.", { code: "MISSING_PALETTE" });
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  if (!remoteCatchId) {
    return {
      attempted: false,
      remoteCatchId: "",
      status: "not_published",
      success: true,
    };
  }

  const session = getCommunitySession();
  if (!session?.token) {
    return cleanupRemoteCatchOperation(remoteCatchId, session);
  }
  const hasKnownOwner = assertPaletteRemoteOwnerIfKnown(palette, session);
  const legacyOwnerAccountKey = hasKnownOwner ? "" : getLegacyRemoteOwnerClaimAccountKey(session);

  const result = await cleanupRemoteCatchOperation(remoteCatchId, session);
  if (!hasKnownOwner && result.status === "already_removed") {
    return {
      ...result,
      error: createLegacyRemoteOwnerUnverifiedError(result.error),
      status: "failed",
      success: false,
    };
  }
  if (result.success && result.attempted) {
    await persistPalettePrivateRemoteState(palette, {
      remoteOwnerAccountKey: legacyOwnerAccountKey,
    });
  }

  return result;
}

export function cleanupPaletteRemoteCatch(palette) {
  return runCriticalPublication(() => cleanupPaletteRemoteCatchOperation(palette));
}

/**
 * @param {Palette} palette
 * @returns {Promise<{ remoteCatchId: string, moderationStatus: ModerationStatus }>}
 */
async function publishPaletteToCommunityFeedOperation(palette, publicationSession) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError("Palette is required.", { code: "MISSING_PALETTE" });
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  const canRepublish =
    currentModerationStatus === CATCH_MODERATION_STATUSES.REJECTED ||
    currentModerationStatus === CATCH_MODERATION_STATUSES.PRIVATE;

  if (remoteCatchId) {
    assertPaletteRemoteOwner(palette, publicationSession);
    if (!canRepublish) {
      throw createCommunityServiceError("Palette already published.", {
        code: "ALREADY_PUBLISHED",
      });
    }
  }

  assertPublicationSessionCurrent(publicationSession);
  const photoBlob = await ensurePaletteMasterPhotoBlob(palette);

  if (!(photoBlob instanceof Blob)) {
    throw createCommunityServiceError("Photo data is missing.", { code: "MISSING_PHOTO" });
  }

  const token = publicationSession.token;
  const photoBase64 = await blobToBase64(photoBlob);

  if (!photoBase64) {
    throw createCommunityServiceError("Unable to encode photo.", { code: "INVALID_PHOTO" });
  }

  const publishPayload = buildCommunityCatchPublishPayload(palette, photoBase64);
  if (publishPayload.colors.length === 0) {
    throw createCommunityServiceError("Palette colors are missing.", { code: "MISSING_COLORS" });
  }

  const remoteOwnerAccountKey = deriveCommunityAccountKey(publicationSession);
  if (!remoteOwnerAccountKey) {
    throw createCommunityServiceError("A stable community account identity is required.", {
      code: "COMMUNITY_ACCOUNT_IDENTITY_REQUIRED",
    });
  }
  const operationKey = await createPublishOperationKey(
    palette,
    remoteOwnerAccountKey,
    publishPayload.timestamp,
  );
  assertPublicationSessionCurrent(publicationSession);
  let payload;
  let postStarted = false;
  try {
    await reconcilePendingPublication(operationKey, token, palette, remoteOwnerAccountKey);
    assertPublicationSessionCurrent(publicationSession);
    if (!reservePublicationRecovery(operationKey, remoteOwnerAccountKey, palette.id)) {
      throw createCommunityServiceError(
        "Publication recovery storage is unavailable. Free local storage and try again.",
        { code: "PUBLICATION_RECOVERY_UNAVAILABLE" },
      );
    }
    postStarted = true;
    payload = await postCatchToCommunity({
      token,
      operationKey,
      ...publishPayload,
    });
  } catch (error) {
    const status = Number(error?.status);
    const isDefinitiveClientRejection =
      postStarted &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500 &&
      ![408, 409, 425, 429].includes(status);
    if (isDefinitiveClientRejection) {
      forgetPublicationRecovery(operationKey);
    }
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    if (!isCommunityPublicationSessionCurrent(publicationSession)) {
      throw createPublicationSessionChangedError(error);
    }
    throw mapApiError(error, { expectedToken: token });
  }

  const nextRemoteCatchId = String(payload?.catch?.id || "").trim();
  if (!nextRemoteCatchId) {
    throw createCommunityServiceError("Missing remote catch id in response.", {
      code: "MISSING_REMOTE_ID",
    });
  }

  const nextModerationStatus =
    normalizeCatchStatus(payload?.catch?.status) || CATCH_MODERATION_STATUSES.TO_MODERATE;
  const nowIso = new Date().toISOString();
  const nextRemoteState = {
    remoteCatchId: nextRemoteCatchId,
    remoteOwnerAccountKey,
    moderationStatus: nextModerationStatus,
    postedAt: nowIso,
    moderationUpdatedAt: nowIso,
    lastModerationCheckAt: nowIso,
  };

  if (!isCommunityPublicationSessionCurrent(publicationSession)) {
    const recoveryRemembered = rememberPublicationRecovery(
      operationKey,
      palette.id,
      nextRemoteState,
    );
    const compensated = await compensateFailedPublication({
      token,
      remoteCatchId: nextRemoteCatchId,
      logMessage: "Failed to compensate a publication after its session changed.",
    });
    if (compensated) {
      forgetPublicationRecovery(operationKey);
      throw createPublicationSessionChangedError();
    }

    if (!recoveryRemembered) {
      applyPaletteRemoteState(palette, nextRemoteState);
    }

    throw createCommunityServiceError(
      "The session changed while publishing, and the remote state could not be rolled back.",
      { code: "PUBLICATION_STATE_UNCERTAIN" },
    );
  }

  if (!rememberPublicationRecovery(operationKey, palette.id, nextRemoteState)) {
    const compensated = await compensateFailedPublication({
      token,
      remoteCatchId: nextRemoteCatchId,
    });
    if (compensated) {
      forgetPublicationRecovery(operationKey);
      throw createCommunityServiceError(
        "Publication recovery storage became unavailable. The remote publication was rolled back.",
        { code: "PUBLICATION_RECOVERY_UNAVAILABLE" },
      );
    }

    applyPaletteRemoteState(palette, nextRemoteState);
    throw createCommunityServiceError(
      "The palette was published, but its recovery state could not be saved or rolled back.",
      { code: "PUBLICATION_STATE_UNCERTAIN" },
    );
  }

  try {
    await persistPaletteRemoteStateWithRetry(palette, nextRemoteState);
    forgetPublicationRecovery(operationKey);
  } catch (persistenceError) {
    const compensated = await compensateFailedPublication({
      token,
      remoteCatchId: nextRemoteCatchId,
    });

    if (!compensated) {
      // Preserve the remote identity in memory so this running session cannot
      // immediately create a duplicate and can still offer an unpublish action.
      applyPaletteRemoteState(palette, nextRemoteState);
      throw createCommunityServiceError(
        "The palette was published, but its local state could not be saved or rolled back.",
        { code: "PUBLICATION_STATE_UNCERTAIN", cause: persistenceError },
      );
    }

    forgetPublicationRecovery(operationKey);

    throw createCommunityServiceError(
      "Unable to save the publication state. The remote publication was rolled back.",
      { code: "LOCAL_PERSISTENCE_FAILED", cause: persistenceError },
    );
  }

  return {
    remoteCatchId: nextRemoteCatchId,
    moderationStatus: nextModerationStatus,
  };
}

/**
 * @param {Palette} palette
 * @param {{session?: CommunitySession | null}} [options]
 */
export function publishPaletteToCommunityFeed(palette, { session } = {}) {
  const publicationSession = createImmutablePublicationSession(session);
  return runCriticalPublication(() =>
    publishPaletteToCommunityFeedOperation(palette, publicationSession),
  );
}

/**
 * @param {Palette} palette
 * @returns {Promise<{ remoteCatchId: string, moderationStatus: ModerationStatus }>}
 */
async function unpublishPaletteFromCommunityFeedOperation(palette, publicationSession) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError("Palette is required.", { code: "MISSING_PALETTE" });
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  if (!remoteCatchId) {
    throw createCommunityServiceError("Palette has not been published yet.", {
      code: "NOT_PUBLISHED",
    });
  }

  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  if (currentModerationStatus !== CATCH_MODERATION_STATUSES.PUBLIC) {
    throw createCommunityServiceError("Palette is not public.", { code: "NOT_PUBLIC" });
  }

  const hasKnownOwner = assertPaletteRemoteOwnerIfKnown(palette, publicationSession);
  const legacyOwnerAccountKey = hasKnownOwner
    ? ""
    : getLegacyRemoteOwnerClaimAccountKey(publicationSession);
  assertPublicationSessionCurrent(publicationSession);
  const token = publicationSession.token;

  try {
    await unpublishCatchFromCommunity({
      token,
      remoteCatchId,
    });
  } catch (error) {
    if (Number(error?.status) === 404) {
      if (!hasKnownOwner) {
        throw createLegacyRemoteOwnerUnverifiedError(error);
      }
      // A known-owned catch is already absent; persist local convergence below.
    } else {
      if (error?.name === "CommunityServiceError") {
        throw error;
      }
      if (!isCommunityPublicationSessionCurrent(publicationSession)) {
        throw createPublicationSessionChangedError(error);
      }
      throw mapApiError(error, { expectedToken: token });
    }
  }

  const nowIso = new Date().toISOString();
  const nextModerationStatus = CATCH_MODERATION_STATUSES.PRIVATE;
  const nextRemoteState = {
    ...(legacyOwnerAccountKey ? { remoteOwnerAccountKey: legacyOwnerAccountKey } : {}),
    moderationStatus: nextModerationStatus,
    moderationUpdatedAt: nowIso,
    lastModerationCheckAt: nowIso,
  };

  try {
    await persistPaletteRemoteStateWithRetry(palette, nextRemoteState);
  } catch (persistenceError) {
    // The remote mutation has already committed (or was already private).
    // Keep this session converged and let a later retry persist the same
    // idempotent PRIVATE state instead of presenting a stale publish action.
    applyPaletteRemoteState(palette, nextRemoteState);
    throw createCommunityServiceError(
      "The palette was unpublished, but its local state could not be saved.",
      {
        code: "LOCAL_PERSISTENCE_FAILED",
        cause: persistenceError,
      },
    );
  }

  return {
    remoteCatchId,
    moderationStatus: nextModerationStatus,
  };
}

/**
 * @param {Palette} palette
 * @param {{session?: CommunitySession | null}} [options]
 */
export function unpublishPaletteFromCommunityFeed(palette, { session } = {}) {
  const publicationSession = createImmutablePublicationSession(session);
  return runCriticalPublication(() =>
    unpublishPaletteFromCommunityFeedOperation(palette, publicationSession),
  );
}
