import {
  CATCH_MODERATION_STATUSES,
  fetchCatchModerationStatuses,
  isEndpointMissingError,
  normalizeCatchStatus,
  postCatchToCommunity,
  requestCommunityLoginCode,
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

function createCommunityServiceError(message, { code, cause } = {}) {
  const error = new Error(message);
  error.name = "CommunityServiceError";
  error.code = code || "UNKNOWN";
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

function normalizeColor(color) {
  if (!color || typeof color !== "object") {
    return null;
  }

  const r = Number(color.r);
  const g = Number(color.g);
  const b = Number(color.b);

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

function normalizeColorsForApi(colors) {
  const paletteColors = Array.isArray(colors)
    ? colors.map((color) => normalizeColor(color)).filter(Boolean)
    : [];

  if (paletteColors.length === 0) {
    throw createCommunityServiceError(
      "Palette colors are missing.",
      { code: "MISSING_COLORS" },
    );
  }

  const normalized = paletteColors.slice(0, 4);

  while (normalized.length < 4) {
    normalized.push({ ...normalized[normalized.length - 1] });
  }

  return normalized;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Unable to read image blob."));
    };

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result);
    };

    reader.readAsDataURL(blob);
  });
}

function extractBase64Payload(dataUrl) {
  if (typeof dataUrl !== "string") {
    return "";
  }

  const payload = dataUrl.includes(",")
    ? dataUrl.slice(dataUrl.indexOf(",") + 1)
    : dataUrl;

  return payload.trim();
}

function getPaletteTimestamp(palette) {
  const parsedDate = new Date(palette?.timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString();
  }

  return parsedDate.toISOString();
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

function getRemoteCatchIdFromPostResponse(payload) {
  return String(
    payload?.catch?.id || payload?.catchId || payload?.id || "",
  ).trim();
}

function getModerationStatusFromPostResponse(payload) {
  return normalizeCatchStatus(
    payload?.catch?.moderationStatus
      || payload?.catch?.status
      || payload?.moderationStatus
      || payload?.status
      || null,
  );
}

function getPaletteRemoteCatchId(palette) {
  return String(palette?.remoteCatchId || "").trim();
}

export function getPalettePublicationMeta(palette) {
  const remoteCatchId = getPaletteRemoteCatchId(palette);
  if (!remoteCatchId) {
    return null;
  }

  const moderationStatus = normalizeCatchStatus(palette?.moderationStatus);

  if (moderationStatus === CATCH_MODERATION_STATUSES.VALID) {
    return {
      tone: "valid",
      label: "publie",
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

  return {
    tone: "pending",
    label: "en moderation",
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

export async function publishPaletteToCommunityFeed(palette) {
  if (!palette || typeof palette !== "object") {
    throw createCommunityServiceError(
      "Palette is required.",
      { code: "MISSING_PALETTE" },
    );
  }

  const remoteCatchId = getPaletteRemoteCatchId(palette);
  const currentModerationStatus = normalizeCatchStatus(palette?.moderationStatus);
  const canRepublish = currentModerationStatus === CATCH_MODERATION_STATUSES.REJECTED;

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
  const photoDataUrl = await blobToDataUrl(palette.photoBlob);
  const photoBase64 = extractBase64Payload(photoDataUrl);

  if (!photoBase64) {
    throw createCommunityServiceError(
      "Unable to encode photo.",
      { code: "INVALID_PHOTO" },
    );
  }

  const colors = normalizeColorsForApi(palette.colors);
  const timestamp = getPaletteTimestamp(palette);

  try {
    const payload = await postCatchToCommunity({
      token,
      photoBase64,
      timestamp,
      colors,
    });

    const nextRemoteCatchId = getRemoteCatchIdFromPostResponse(payload);
    if (!nextRemoteCatchId) {
      throw createCommunityServiceError(
        "Missing remote catch id in response.",
        { code: "MISSING_REMOTE_ID" },
      );
    }

    const nextModerationStatus = (
      getModerationStatusFromPostResponse(payload)
      || CATCH_MODERATION_STATUSES.TO_MODERATE
    );
    const nowIso = new Date().toISOString();

    await updatePaletteRemoteState(palette.id, {
      remoteCatchId: nextRemoteCatchId,
      moderationStatus: nextModerationStatus,
      postedAt: nowIso,
      moderationUpdatedAt: nowIso,
      lastModerationCheckAt: nowIso,
    });

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

export async function syncPublishedPalettesModerationStatus() {
  const token = getCommunityAccessToken();
  if (!token) {
    return {
      pendingCount: 0,
      updatedCount: 0,
    };
  }

  const palettes = await getSavedPalettes();
  const pendingPalettes = palettes.filter((palette) => {
    const remoteCatchId = getPaletteRemoteCatchId(palette);
    if (!remoteCatchId) {
      return false;
    }

    const moderationStatus = normalizeCatchStatus(palette?.moderationStatus);
    return !moderationStatus || moderationStatus === CATCH_MODERATION_STATUSES.TO_MODERATE;
  });

  if (pendingPalettes.length === 0) {
    return {
      pendingCount: 0,
      updatedCount: 0,
    };
  }

  const remoteCatchIds = pendingPalettes.map((palette) => getPaletteRemoteCatchId(palette));

  let moderationEntries;

  try {
    moderationEntries = await fetchCatchModerationStatuses({
      token,
      remoteCatchIds,
    });
  } catch (error) {
    if (isEndpointMissingError(error)) {
      return {
        pendingCount: pendingPalettes.length,
        updatedCount: 0,
      };
    }

    throw mapApiError(error);
  }

  const statusByRemoteCatchId = new Map(
    moderationEntries.map((entry) => [entry.remoteCatchId, entry.status]),
  );

  let updatedCount = 0;
  let pendingCount = 0;
  const nowIso = new Date().toISOString();
  const updateOperations = [];

  pendingPalettes.forEach((palette) => {
    const remoteCatchId = getPaletteRemoteCatchId(palette);
    const incomingStatus = statusByRemoteCatchId.get(remoteCatchId);
    const currentStatus = normalizeCatchStatus(palette?.moderationStatus);
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
