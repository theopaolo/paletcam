import {
  CATCH_MODERATION_STATUSES,
  fetchCatchModerationStatuses,
  normalizeCatchStatus,
} from "../community-api.js";
import { getCommunityAccessToken } from "../community-session.js";
import { getSavedPalettes, updatePaletteRemoteState } from "../palette-storage.js";
import { mapApiError } from "./errors.js";
import { getPaletteRemoteCatchId } from "./palette-state.js";

/** @returns {Promise<ModerationSyncResult>} */
export async function syncPublishedPalettesModerationStatus() {
  const token = getCommunityAccessToken();
  if (!token) {
    return {
      pendingCount: 0,
      updatedCount: 0,
    };
  }

  const palettes = await getSavedPalettes();
  const publishedPalettes = palettes.filter((palette) => {
    return Boolean(getPaletteRemoteCatchId(palette));
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
    });
  } catch (error) {
    throw mapApiError(error);
  }

  const { statuses, deletedIds } = result;
  const statusByRemoteCatchId = new Map(
    statuses.map((entry) => [entry.remoteCatchId, entry.status]),
  );
  const deletedIdSet = new Set(deletedIds);

  let updatedCount = 0;
  let pendingCount = 0;
  const nowIso = new Date().toISOString();
  const updateOperations = [];

  publishedPalettes.forEach((palette) => {
    const remoteCatchId = getPaletteRemoteCatchId(palette);
    const currentStatus = normalizeCatchStatus(palette?.moderationStatus);

    if (deletedIdSet.has(remoteCatchId)) {
      if (currentStatus !== CATCH_MODERATION_STATUSES.PRIVATE) {
        updatedCount += 1;
        updateOperations.push(
          updatePaletteRemoteState(palette.id, {
            moderationStatus: CATCH_MODERATION_STATUSES.PRIVATE,
            moderationUpdatedAt: nowIso,
            lastModerationCheckAt: nowIso,
          }),
        );
      }
      return;
    }

    const incomingStatus = statusByRemoteCatchId.get(remoteCatchId);
    const nextStatus = incomingStatus || currentStatus || CATCH_MODERATION_STATUSES.TO_MODERATE;

    if (nextStatus === CATCH_MODERATION_STATUSES.TO_MODERATE) {
      pendingCount += 1;
    }

    if (nextStatus === currentStatus) {
      return;
    }

    updatedCount += 1;
    updateOperations.push(
      updatePaletteRemoteState(palette.id, {
        moderationStatus: nextStatus,
        moderationUpdatedAt: nowIso,
        lastModerationCheckAt: nowIso,
      }),
    );
  });

  await Promise.all(updateOperations);

  return {
    pendingCount,
    updatedCount,
  };
}
