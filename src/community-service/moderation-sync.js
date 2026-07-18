import {
  CATCH_MODERATION_STATUSES,
  fetchCatchModerationStatuses,
  normalizeCatchStatus,
} from "../community-api.js";
import { getCommunitySession } from "../community-session.js";
import {
  deriveCommunityAccountKey,
  paletteRemoteOwnerMatchesSession,
} from "../community-account-key.js";
import { bulkUpdateOwnedPaletteRemoteStates, getSavedPalettes } from "../palette-storage.js";
import { mapApiError } from "./errors.js";
import { getPaletteRemoteCatchId } from "./palette-state.js";

/**
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<ModerationSyncResult>}
 */
export async function syncPublishedPalettesModerationStatus({ signal } = {}) {
  const session = getCommunitySession();
  const token = String(session?.token || "").trim();
  const ownerAccountKey = deriveCommunityAccountKey(session);
  if (!token || !ownerAccountKey) {
    return {
      pendingCount: 0,
      updatedCount: 0,
    };
  }

  const palettes = await getSavedPalettes();
  const publishedPalettes = palettes.filter((palette) => {
    return (
      Boolean(getPaletteRemoteCatchId(palette)) &&
      paletteRemoteOwnerMatchesSession(palette, session)
    );
  });

  if (publishedPalettes.length === 0) {
    return {
      pendingCount: 0,
      updatedCount: 0,
    };
  }

  const remoteCatchIds = publishedPalettes.map((palette) => getPaletteRemoteCatchId(palette));

  let result;

  try {
    result = await fetchCatchModerationStatuses({
      token,
      remoteCatchIds,
      signal,
    });
  } catch (error) {
    throw mapApiError(error, { expectedToken: token });
  }

  const { statuses, deletedIds } = result;
  const statusByRemoteCatchId = new Map(
    statuses.map((entry) => [entry.remoteCatchId, entry.status]),
  );
  const deletedIdSet = new Set(deletedIds);

  let pendingCount = 0;
  const nowIso = new Date().toISOString();
  const remoteStateUpdates = [];
  const checkTimestampUpdates = [];

  publishedPalettes.forEach((palette) => {
    const remoteCatchId = getPaletteRemoteCatchId(palette);
    const currentStatus = normalizeCatchStatus(palette?.moderationStatus);

    if (deletedIdSet.has(remoteCatchId)) {
      if (currentStatus !== CATCH_MODERATION_STATUSES.PRIVATE) {
        remoteStateUpdates.push({
          id: palette.id,
          expectedRemoteCatchId: remoteCatchId,
          patch: {
            moderationStatus: CATCH_MODERATION_STATUSES.PRIVATE,
            moderationUpdatedAt: nowIso,
            lastModerationCheckAt: nowIso,
          },
        });
      } else {
        checkTimestampUpdates.push({
          id: palette.id,
          expectedRemoteCatchId: remoteCatchId,
          patch: { lastModerationCheckAt: nowIso },
        });
      }
      return;
    }

    const incomingStatus = statusByRemoteCatchId.get(remoteCatchId);
    const nextStatus = incomingStatus || currentStatus || CATCH_MODERATION_STATUSES.TO_MODERATE;

    if (nextStatus === CATCH_MODERATION_STATUSES.TO_MODERATE) {
      pendingCount += 1;
    }

    if (nextStatus === currentStatus) {
      checkTimestampUpdates.push({
        id: palette.id,
        expectedRemoteCatchId: remoteCatchId,
        patch: { lastModerationCheckAt: nowIso },
      });
      return;
    }

    remoteStateUpdates.push({
      id: palette.id,
      expectedRemoteCatchId: remoteCatchId,
      patch: {
        moderationStatus: nextStatus,
        moderationUpdatedAt: nowIso,
        lastModerationCheckAt: nowIso,
      },
    });
  });

  const updatedCount = await bulkUpdateOwnedPaletteRemoteStates(remoteStateUpdates, {
    ownerAccountKey,
  });
  if (checkTimestampUpdates.length > 0) {
    await bulkUpdateOwnedPaletteRemoteStates(checkTimestampUpdates, { ownerAccountKey });
  }

  return {
    pendingCount,
    updatedCount,
  };
}
