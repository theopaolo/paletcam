import { t } from "../i18n.js";
import { CATCH_MODERATION_STATUSES, normalizeCatchStatus } from "../community-api.js";

export function getPaletteRemoteCatchId(palette) {
  return String(palette?.remoteCatchId || "").trim();
}

export function applyPaletteRemoteState(palette, patch) {
  if (!palette || typeof palette !== "object" || !patch || typeof patch !== "object") {
    return;
  }

  if (Object.hasOwn(patch, "remoteCatchId")) {
    palette.remoteCatchId = patch.remoteCatchId || null;
    if (!palette.remoteCatchId && !Object.hasOwn(patch, "remoteOwnerAccountKey")) {
      palette.remoteOwnerAccountKey = null;
    }
  }

  if (Object.hasOwn(patch, "remoteOwnerAccountKey")) {
    palette.remoteOwnerAccountKey = patch.remoteOwnerAccountKey || null;
  }

  if (Object.hasOwn(patch, "moderationStatus")) {
    palette.moderationStatus = patch.moderationStatus || null;
  }

  if (Object.hasOwn(patch, "postedAt")) {
    palette.postedAt = patch.postedAt || null;
  }

  if (Object.hasOwn(patch, "moderationUpdatedAt")) {
    palette.moderationUpdatedAt = patch.moderationUpdatedAt || null;
  }

  if (Object.hasOwn(patch, "lastModerationCheckAt")) {
    palette.lastModerationCheckAt = patch.lastModerationCheckAt || null;
  }
}

/**
 * @param {Palette} palette
 * @returns {PublicationAction}
 */
export function getPalettePublicationAction(palette) {
  const remoteCatchId = getPaletteRemoteCatchId(palette);
  const moderationStatus = normalizeCatchStatus(palette?.moderationStatus);

  if (remoteCatchId && moderationStatus === CATCH_MODERATION_STATUSES.PUBLIC) {
    return "unpublish";
  }

  return "publish";
}

/**
 * @param {Palette} palette
 * @returns {PublicationMeta | null}
 */
export function getPalettePublicationMeta(palette) {
  const remoteCatchId = getPaletteRemoteCatchId(palette);
  if (!remoteCatchId) {
    return null;
  }

  const moderationStatus = normalizeCatchStatus(palette?.moderationStatus);

  if (moderationStatus === CATCH_MODERATION_STATUSES.PUBLIC) {
    return {
      tone: "public",
      label: t("publication.status.public"),
      status: moderationStatus,
    };
  }

  if (moderationStatus === CATCH_MODERATION_STATUSES.REJECTED) {
    return {
      tone: "rejected",
      label: t("publication.status.rejected"),
      status: moderationStatus,
    };
  }

  if (moderationStatus === CATCH_MODERATION_STATUSES.PRIVATE) {
    return {
      tone: "private",
      label: t("publication.status.private"),
      status: moderationStatus,
    };
  }

  return {
    tone: "pending",
    label: t("publication.status.pending"),
    status: CATCH_MODERATION_STATUSES.TO_MODERATE,
  };
}
