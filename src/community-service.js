import {
  CATCH_MODERATION_STATUSES,
  fetchCatchModerationStatuses,
  normalizeCatchStatus,
  postCatchToCommunity,
  requestCommunityLoginCode,
  unpublishCatchFromCommunity,
  verifyCommunityLoginCode,
} from "./community-api.js";
import {
  clearCommunitySession,
  getCommunityAccessToken,
  getCommunitySession,
  setCommunitySession,
  subscribeCommunitySession,
} from "./community-session.js";
import {
  getSavedPalettes,
  updatePaletteRemoteState,
} from "./palette-storage.js";
import {
  buildCommunityCatchPublishPayload,
} from "./modules/community-publish-payload.js";

function createCommunityServiceError(message, { code = "UNKNOWN", cause = /** @type {any} */ (undefined) } = {}) {
  const error = /** @type {Error & CommunityServiceError} */ (new Error(message));
  error.name = "CommunityServiceError";
  error.code = code;
  error.cause = cause;
  error.status = Number(cause?.status || 0);
  return error;
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase();
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function getAuthTokenOrThrow() {
  const token = getCommunityAccessToken();
  if (!token) {
    throw createCommunityServiceError(
      "Authentication required.",
      { code: "NOT_AUTHENTICATED" },
    );
  }

  return token;
}

function mapApiError(error) {
  if (Number(error?.status) === 401) {
    clearCommunitySession();
    return createCommunityServiceError(
      "Authentication expired.",
      { code: "AUTH_EXPIRED", cause: error },
    );
  }

  return createCommunityServiceError(
    error?.message || "Community API request failed.",
    { code: "API_ERROR", cause: error },
  );
}

function getPaletteRemoteCatchId(palette) {
  return String(palette?.remoteCatchId || "").trim();
}

function applyPaletteRemoteState(palette, patch) {
  if (!palette || typeof palette !== "object" || !patch || typeof patch !== "object") {
    return;
  }

  if (Object.hasOwn(patch, "remoteCatchId")) {
    palette.remoteCatchId = patch.remoteCatchId || null;
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

  if (
    remoteCatchId
    && moderationStatus === CATCH_MODERATION_STATUSES.PUBLIC
  ) {
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
      label: "publié",
      status: moderationStatus,
    };
  }

  if (moderationStatus === CATCH_MODERATION_STATUSES.REJECTED) {
    return {
      tone: "rejected",
      label: "refuse",
      status: moderationStatus,
    };
  }

  if (moderationStatus === CATCH_MODERATION_STATUSES.PRIVATE) {
    return {
      tone: "private",
      label: "privé",
      status: moderationStatus,
    };
  }

  return {
    tone: "pending",
    label: "en modération",
    status: CATCH_MODERATION_STATUSES.TO_MODERATE,
  };
}

export async function sendCommunityLoginOtp(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw createCommunityServiceError(
      "Email is required.",
      { code: "MISSING_EMAIL" },
    );
  }

  try {
    await requestCommunityLoginCode({ email: normalizedEmail });
    return normalizedEmail;
  } catch (error) {
    throw mapApiError(error);
  }
}

export async function verifyCommunityLoginOtp({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail) {
    throw createCommunityServiceError(
      "Email is required.",
      { code: "MISSING_EMAIL" },
    );
  }

  if (!normalizedCode) {
    throw createCommunityServiceError(
      "Code is required.",
      { code: "MISSING_CODE" },
    );
  }

  try {
    const payload = await verifyCommunityLoginCode({
      email: normalizedEmail,
      code: normalizedCode,
    });
    const token = String(payload?.token || "").trim();
    if (!token) {
      throw createCommunityServiceError(
        "Missing token in verification response.",
        { code: "MISSING_TOKEN" },
      );
    }

    const session = setCommunitySession({
      token,
      email: normalizedEmail,
      user: payload?.user ?? null,
    });

    return session;
  } catch (error) {
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error);
  }
}

export function logoutCommunity() {
  clearCommunitySession();
}

export function getCurrentCommunitySession() {
  return getCommunitySession();
}

export { subscribeCommunitySession };

/**
 * @param {Palette} palette
 * @returns {Promise<{ remoteCatchId: string, moderationStatus: ModerationStatus }>}
 */
export async function publishPaletteToCommunityFeed(palette) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError(
      "Palette is required.",
      { code: "MISSING_PALETTE" },
    );
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  const canRepublish = currentModerationStatus === CATCH_MODERATION_STATUSES.REJECTED
    || currentModerationStatus === CATCH_MODERATION_STATUSES.PRIVATE;

  if (remoteCatchId && !canRepublish) {
    throw createCommunityServiceError(
      "Palette already published.",
      { code: "ALREADY_PUBLISHED" },
    );
  }

  if (!(palette.photoBlob instanceof Blob)) {
    throw createCommunityServiceError(
      "Photo data is missing.",
      { code: "MISSING_PHOTO" },
    );
  }

  const token = getAuthTokenOrThrow();
  const photoBase64 = await blobToBase64(palette.photoBlob);

  if (!photoBase64) {
    throw createCommunityServiceError(
      "Unable to encode photo.",
      { code: "INVALID_PHOTO" },
    );
  }

  const publishPayload = buildCommunityCatchPublishPayload(palette, photoBase64);
  if (publishPayload.colors.length === 0) {
    throw createCommunityServiceError(
      "Palette colors are missing.",
      { code: "MISSING_COLORS" },
    );
  }

  try {
    const payload = await postCatchToCommunity({
      token,
      ...publishPayload,
    });

    const nextRemoteCatchId = String(payload?.catch?.id || "").trim();
    if (!nextRemoteCatchId) {
      throw createCommunityServiceError(
        "Missing remote catch id in response.",
        { code: "MISSING_REMOTE_ID" },
      );
    }

    const nextModerationStatus = (
      normalizeCatchStatus(payload?.catch?.status)
      || CATCH_MODERATION_STATUSES.TO_MODERATE
    );
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
    throw createCommunityServiceError(
      "Palette is required.",
      { code: "MISSING_PALETTE" },
    );
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  if (!remoteCatchId) {
    throw createCommunityServiceError(
      "Palette has not been published yet.",
      { code: "NOT_PUBLISHED" },
    );
  }

  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  if (currentModerationStatus !== CATCH_MODERATION_STATUSES.PUBLIC) {
    throw createCommunityServiceError(
      "Palette is not public.",
      { code: "NOT_PUBLIC" },
    );
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
        updateOperations.push(updatePaletteRemoteState(palette.id, {
          moderationStatus: CATCH_MODERATION_STATUSES.PRIVATE,
          moderationUpdatedAt: nowIso,
          lastModerationCheckAt: nowIso,
        }));
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
    updateOperations.push(updatePaletteRemoteState(palette.id, {
      moderationStatus: nextStatus,
      moderationUpdatedAt: nowIso,
      lastModerationCheckAt: nowIso,
    }));
  });

  await Promise.all(updateOperations);

  return {
    pendingCount,
    updatedCount,
  };
}
