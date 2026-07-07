import {
  CATCH_MODERATION_STATUSES,
  normalizeCatchStatus,
  postCatchToCommunity,
  unpublishCatchFromCommunity,
} from "../community-api.js";
import { getCommunityAccessToken } from "../community-session.js";
import { ensurePaletteMasterPhotoBlob, updatePaletteRemoteState } from "../palette-storage.js";
import { buildCommunityCatchPublishPayload } from "../modules/community-publish-payload.js";
import { reportAppError } from "../modules/error-reporting.js";
import { createCommunityServiceError, getAuthTokenOrThrow, mapApiError } from "./errors.js";
import { applyPaletteRemoteState, getPaletteRemoteCatchId } from "./palette-state.js";

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function buildRemoteDeletionCleanupAuthRequiredResult(remoteCatchId) {
  return {
    attempted: false,
    error: createCommunityServiceError("Authentication required.", { code: "NOT_AUTHENTICATED" }),
    remoteCatchId,
    status: "authentication_required",
    success: false,
  };
}

async function persistPalettePrivateRemoteState(palette) {
  const nowIso = new Date().toISOString();
  const nextRemoteState = {
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
      context: {
        paletteId: palette?.id,
        remoteCatchId: getPaletteRemoteCatchId(palette),
      },
    });
  }

  applyPaletteRemoteState(palette, nextRemoteState);
}

/**
 * @param {string | null | undefined} remoteCatchId
 * @returns {Promise<PaletteDeleteRemoteCleanupResult>}
 */
export async function cleanupRemoteCatch(remoteCatchId) {
  const safeRemoteCatchId = String(remoteCatchId || "").trim();
  if (!safeRemoteCatchId) {
    return {
      attempted: false,
      remoteCatchId: "",
      status: "not_published",
      success: true,
    };
  }

  const token = getCommunityAccessToken();
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

    const mappedError = error?.name === "CommunityServiceError" ? error : mapApiError(error);

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

/**
 * @param {Palette} palette
 * @returns {Promise<PaletteDeleteRemoteCleanupResult>}
 */
export async function cleanupPaletteRemoteCatch(palette) {
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

  const result = await cleanupRemoteCatch(remoteCatchId);
  if (result.success && result.attempted) {
    await persistPalettePrivateRemoteState(palette);
  }

  return result;
}

/**
 * @param {Palette} palette
 * @returns {Promise<{ remoteCatchId: string, moderationStatus: ModerationStatus }>}
 */
export async function publishPaletteToCommunityFeed(palette) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError("Palette is required.", { code: "MISSING_PALETTE" });
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  const canRepublish =
    currentModerationStatus === CATCH_MODERATION_STATUSES.REJECTED ||
    currentModerationStatus === CATCH_MODERATION_STATUSES.PRIVATE;

  if (remoteCatchId && !canRepublish) {
    throw createCommunityServiceError("Palette already published.", { code: "ALREADY_PUBLISHED" });
  }

  const photoBlob = await ensurePaletteMasterPhotoBlob(palette);

  if (!(photoBlob instanceof Blob)) {
    throw createCommunityServiceError("Photo data is missing.", { code: "MISSING_PHOTO" });
  }

  const token = getAuthTokenOrThrow();
  const photoBase64 = await blobToBase64(photoBlob);

  if (!photoBase64) {
    throw createCommunityServiceError("Unable to encode photo.", { code: "INVALID_PHOTO" });
  }

  const publishPayload = buildCommunityCatchPublishPayload(palette, photoBase64);
  if (publishPayload.colors.length === 0) {
    throw createCommunityServiceError("Palette colors are missing.", { code: "MISSING_COLORS" });
  }

  try {
    const payload = await postCatchToCommunity({
      token,
      ...publishPayload,
    });

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
      moderationStatus: nextModerationStatus,
      postedAt: nowIso,
      moderationUpdatedAt: nowIso,
      lastModerationCheckAt: nowIso,
    };

    await updatePaletteRemoteState(palette.id, nextRemoteState);
    applyPaletteRemoteState(palette, nextRemoteState);

    return {
      remoteCatchId: nextRemoteCatchId,
      moderationStatus: nextModerationStatus,
    };
  } catch (error) {
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error);
  }
}

/**
 * @param {Palette} palette
 * @returns {Promise<{ remoteCatchId: string, moderationStatus: ModerationStatus }>}
 */
export async function unpublishPaletteFromCommunityFeed(palette) {
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

  const token = getAuthTokenOrThrow();

  try {
    await unpublishCatchFromCommunity({
      token,
      remoteCatchId,
    });

    const nowIso = new Date().toISOString();
    const nextModerationStatus = CATCH_MODERATION_STATUSES.PRIVATE;
    const nextRemoteState = {
      moderationStatus: nextModerationStatus,
      moderationUpdatedAt: nowIso,
      lastModerationCheckAt: nowIso,
    };

    await updatePaletteRemoteState(palette.id, nextRemoteState);
    applyPaletteRemoteState(palette, nextRemoteState);

    return {
      remoteCatchId,
      moderationStatus: nextModerationStatus,
    };
  } catch (error) {
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error);
  }
}
