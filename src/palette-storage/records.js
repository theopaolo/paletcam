/** @type {ReadonlySet<ModerationStatus>} */
const KNOWN_MODERATION_STATUSES = new Set(["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"]);
const REMOTE_OWNER_ACCOUNT_KEY_PATTERN = /^account:[a-f0-9]{16}$/;
const PREVIEW_VARIANT_FIELD_KEYS = Object.freeze({
  gallery: Object.freeze({
    blobKey: "previewGalleryBlob",
    footerKey: "previewGalleryFooterLabel",
  }),
  viewer: Object.freeze({
    blobKey: "previewViewerBlob",
    footerKey: "previewViewerFooterLabel",
  }),
});
const PALETTE_PREVIEW_FIELD_KEYS = Object.freeze([
  "previewBlob",
  "previewFooterLabel",
  "previewGalleryBlob",
  "previewGalleryFooterLabel",
  "previewViewerBlob",
  "previewViewerFooterLabel",
]);
// Imported legacy backups can contain more colors than the current capture UI.
// Keep the durable read boundary aligned with the bounded import contract so
// those palettes remain readable after they have been restored.
const STORED_PALETTE_MAX_COLORS = 16;
const STORED_PALETTE_MAX_REMOTE_ID_LENGTH = 256;
const STORED_PALETTE_MAX_RAL_CODE_LENGTH = 64;
const STORED_PALETTE_MAX_RAL_NAME_LENGTH = 160;
const STORED_PALETTE_MAX_FOOTER_LABEL_LENGTH = 160;

/**
 * The metadata shape written to the palettes table. The database assigns `id`
 * when a new record is added.
 * @typedef {Omit<Palette, "id"> & {id?: number}} PaletteMetadataRecord
 */
/** @typedef {Partial<Palette> & Pick<Palette, "timestamp" | "colors">} PaletteMetadataInput */

export function normalizeRemoteCatchId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeRemoteOwnerAccountKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return REMOTE_OWNER_ACCOUNT_KEY_PATTERN.test(normalized) ? normalized : null;
}

/** @returns {ModerationStatus | null} */
export function normalizeModerationStatus(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return KNOWN_MODERATION_STATUSES.has(/** @type {ModerationStatus} */ (normalized))
    ? /** @type {ModerationStatus} */ (normalized)
    : null;
}

export function normalizeIsoString(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function normalizePreviewFooterLabel(value) {
  return typeof value === "string" ? value : null;
}

export function normalizePreviewVariant(variant) {
  return variant === "gallery" ? "gallery" : "viewer";
}

export function getPalettePreviewMutationVariantOrThrow(variant) {
  if (variant === "gallery" || variant === "viewer") {
    return variant;
  }

  throw new RangeError(`Unsupported palette preview variant: ${String(variant)}.`);
}

export function normalizePolaroidRenderSettings(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const footerLabel = typeof value.footerLabel === "string" ? value.footerLabel.trim() : "";
  return {
    footerLabel,
    ...(typeof value.showColorNames === "boolean" ? { showColorNames: value.showColorNames } : {}),
  };
}

export function getPreviewVariantFieldKeys(variant) {
  return PREVIEW_VARIANT_FIELD_KEYS[normalizePreviewVariant(variant)];
}

export function stripPalettePreviewFields(palette) {
  const leanPalette = { ...(palette && typeof palette === "object" ? palette : {}) };

  for (const fieldKey of PALETTE_PREVIEW_FIELD_KEYS) {
    delete leanPalette[fieldKey];
  }

  return leanPalette;
}

export function normalizeCaptureCropRect(captureCropRect) {
  return captureCropRect
    ? {
        x: Number(captureCropRect.x) || 0,
        y: Number(captureCropRect.y) || 0,
        width: Number(captureCropRect.width) || 0,
        height: Number(captureCropRect.height) || 0,
      }
    : null;
}

function parseStoredTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestampMs = new Date(value).getTime();
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function parseStoredColors(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > STORED_PALETTE_MAX_COLORS) {
    return null;
  }

  const colors = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }

    const { r, g, b } = candidate;
    if (
      ![r, g, b].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
    ) {
      return null;
    }

    const color = { r, g, b };
    if (candidate.population !== undefined) {
      if (!Number.isFinite(candidate.population) || candidate.population < 0) {
        return null;
      }
      color.population = candidate.population;
    }
    if (candidate.deltaE !== undefined) {
      if (!Number.isFinite(candidate.deltaE) || candidate.deltaE < 0) {
        return null;
      }
      color.deltaE = candidate.deltaE;
    }
    colors.push(color);
  }
  return colors;
}

function parseStoredCaptureAspectRatio(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "1:1" || value === "4:3") {
    return value;
  }
  return Number.isFinite(value) && value >= 0.25 && value <= 4 ? value : null;
}

function parseStoredCaptureCropRect(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const { x, y, width, height } = value;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 ||
    y + height > 1
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

function parseStoredRalMatch(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const code = typeof value.code === "string" ? value.code.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const channels = [value.r, value.g, value.b];
  if (
    !code ||
    !name ||
    code.length > STORED_PALETTE_MAX_RAL_CODE_LENGTH ||
    name.length > STORED_PALETTE_MAX_RAL_NAME_LENGTH ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255) ||
    !Number.isFinite(value.deltaE) ||
    value.deltaE < 0
  ) {
    return undefined;
  }
  return { code, name, r: value.r, g: value.g, b: value.b, deltaE: value.deltaE };
}

function parseStoredPolaroidRenderSettings(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.footerLabel !== "string" ||
    value.footerLabel.trim().length > STORED_PALETTE_MAX_FOOTER_LABEL_LENGTH ||
    (value.showColorNames !== undefined && typeof value.showColorNames !== "boolean")
  ) {
    return undefined;
  }
  return normalizePolaroidRenderSettings(value);
}

function parseStoredOptionalIsoString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return parseStoredTimestamp(value) ?? undefined;
}

/**
 * Parses untrusted IndexedDB palette metadata without mutating or repairing the
 * authoritative row. Invalid rows return `null` so callers can omit them from
 * UI results while preserving the original data for explicit recovery tooling.
 * @returns {Palette | null}
 */
export function parseStoredPaletteMetadataRecord(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const id = candidate.id;
  const timestamp = parseStoredTimestamp(candidate.timestamp);
  const colors = parseStoredColors(candidate.colors);
  const captureAspectRatio = parseStoredCaptureAspectRatio(candidate.captureAspectRatio);
  const captureCropRect = parseStoredCaptureCropRect(candidate.captureCropRect);
  const captureMode = candidate.captureMode ?? "palette";
  const ralMatch = parseStoredRalMatch(candidate.ralMatch);
  const polaroidRenderSettings = parseStoredPolaroidRenderSettings(
    candidate.polaroidRenderSettings,
  );
  const remoteCatchId = normalizeRemoteCatchId(candidate.remoteCatchId);
  const remoteOwnerAccountKey = normalizeRemoteOwnerAccountKey(candidate.remoteOwnerAccountKey);
  const moderationStatus = normalizeModerationStatus(candidate.moderationStatus);
  const postedAt = parseStoredOptionalIsoString(candidate.postedAt);
  const moderationUpdatedAt = parseStoredOptionalIsoString(candidate.moderationUpdatedAt);
  const lastModerationCheckAt = parseStoredOptionalIsoString(candidate.lastModerationCheckAt);
  const rawRemoteCatchId =
    typeof candidate.remoteCatchId === "string" ? candidate.remoteCatchId.trim() : null;
  const hasValidRemoteCatchId =
    candidate.remoteCatchId === undefined ||
    candidate.remoteCatchId === null ||
    (typeof candidate.remoteCatchId === "string" &&
      (rawRemoteCatchId === "" ||
        (remoteCatchId !== null && remoteCatchId.length <= STORED_PALETTE_MAX_REMOTE_ID_LENGTH)));
  const hasValidRemoteOwnerAccountKey =
    candidate.remoteOwnerAccountKey === undefined ||
    candidate.remoteOwnerAccountKey === null ||
    (typeof candidate.remoteOwnerAccountKey === "string" && remoteOwnerAccountKey !== null);
  const rawModerationStatus =
    typeof candidate.moderationStatus === "string" ? candidate.moderationStatus.trim() : null;
  const hasValidModerationStatus =
    candidate.moderationStatus === undefined ||
    candidate.moderationStatus === null ||
    (typeof candidate.moderationStatus === "string" &&
      (rawModerationStatus === "" || moderationStatus !== null));

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !timestamp ||
    !colors ||
    captureAspectRatio === null ||
    captureCropRect === undefined ||
    (captureMode !== "palette" && captureMode !== "ral") ||
    ralMatch === undefined ||
    (captureMode !== "ral" && ralMatch !== null) ||
    polaroidRenderSettings === undefined ||
    !hasValidRemoteCatchId ||
    !hasValidRemoteOwnerAccountKey ||
    (remoteCatchId === null && remoteOwnerAccountKey !== null) ||
    !hasValidModerationStatus ||
    postedAt === undefined ||
    moderationUpdatedAt === undefined ||
    lastModerationCheckAt === undefined ||
    (candidate.hasPhotoAsset !== undefined && typeof candidate.hasPhotoAsset !== "boolean")
  ) {
    return null;
  }

  return createLeanPaletteMetadataRecord({
    id,
    timestamp,
    colors,
    captureAspectRatio,
    captureCropRect,
    captureMode,
    ralMatch,
    polaroidRenderSettings,
    remoteCatchId,
    remoteOwnerAccountKey,
    moderationStatus,
    postedAt,
    moderationUpdatedAt,
    lastModerationCheckAt,
    hasPhotoAsset: candidate.hasPhotoAsset === true,
  });
}

/** @returns {Palette} */
export function normalizeStoredPaletteRecord(
  palette,
  { includePhotoBlob = false, photoBlob = undefined, includeViewerPreviewBlob = true } = {},
) {
  const legacyPreviewBlob = palette?.previewBlob instanceof Blob ? palette.previewBlob : null;
  const legacyPreviewFooterLabel = normalizePreviewFooterLabel(palette?.previewFooterLabel);
  let previewViewerBlob = null;
  if (includeViewerPreviewBlob) {
    previewViewerBlob =
      palette?.previewViewerBlob instanceof Blob ? palette.previewViewerBlob : legacyPreviewBlob;
  }
  const previewViewerFooterLabel =
    normalizePreviewFooterLabel(palette?.previewViewerFooterLabel) ?? legacyPreviewFooterLabel;
  const previewGalleryBlob =
    palette?.previewGalleryBlob instanceof Blob ? palette.previewGalleryBlob : null;
  const previewGalleryFooterLabel = normalizePreviewFooterLabel(palette?.previewGalleryFooterLabel);
  const normalized = /** @type {Palette} */ ({
    id: palette?.id,
    timestamp: palette?.timestamp,
    colors: Array.isArray(palette?.colors) ? [...palette.colors] : [],
    captureAspectRatio: palette?.captureAspectRatio,
    captureCropRect: normalizeCaptureCropRect(palette?.captureCropRect),
    polaroidRenderSettings: normalizePolaroidRenderSettings(palette?.polaroidRenderSettings),
    remoteCatchId: normalizeRemoteCatchId(palette?.remoteCatchId),
    remoteOwnerAccountKey: normalizeRemoteCatchId(palette?.remoteCatchId)
      ? normalizeRemoteOwnerAccountKey(palette?.remoteOwnerAccountKey)
      : null,
    moderationStatus: normalizeModerationStatus(palette?.moderationStatus),
    postedAt: normalizeIsoString(palette?.postedAt),
    moderationUpdatedAt: normalizeIsoString(palette?.moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(palette?.lastModerationCheckAt),
    previewFooterLabel: normalizePreviewFooterLabel(palette?.previewFooterLabel),
    hasPhotoAsset: Boolean(
      palette?.hasPhotoAsset || photoBlob instanceof Blob || palette?.photoBlob instanceof Blob,
    ),
  });

  if (palette?.captureMode === "ral") {
    normalized.captureMode = "ral";
    normalized.ralMatch = palette?.ralMatch ?? null;
  }

  if (previewViewerBlob instanceof Blob) {
    normalized.previewViewerBlob = previewViewerBlob;
  } else {
    delete normalized.previewViewerBlob;
  }

  if (previewViewerFooterLabel) {
    normalized.previewViewerFooterLabel = previewViewerFooterLabel;
  } else {
    delete normalized.previewViewerFooterLabel;
  }

  if (previewGalleryBlob instanceof Blob) {
    normalized.previewGalleryBlob = previewGalleryBlob;
  } else {
    delete normalized.previewGalleryBlob;
  }

  if (previewGalleryFooterLabel) {
    normalized.previewGalleryFooterLabel = previewGalleryFooterLabel;
  } else {
    delete normalized.previewGalleryFooterLabel;
  }

  if (includePhotoBlob) {
    if (photoBlob instanceof Blob) {
      normalized.photoBlob = photoBlob;
    } else if (palette?.photoBlob instanceof Blob) {
      normalized.photoBlob = palette.photoBlob;
    } else {
      delete normalized.photoBlob;
    }
  } else {
    delete normalized.photoBlob;
  }

  return normalized;
}

/** @param {PaletteMetadataInput} input @returns {PaletteMetadataRecord} */
export function createPaletteMetadataRecord({
  id,
  timestamp,
  colors,
  captureAspectRatio = "4:3",
  captureCropRect = null,
  captureMode,
  ralMatch = null,
  remoteCatchId = null,
  remoteOwnerAccountKey = null,
  moderationStatus = null,
  postedAt = null,
  moderationUpdatedAt = null,
  lastModerationCheckAt = null,
  polaroidRenderSettings = null,
  hasPhotoAsset = false,
}) {
  /** @type {PaletteMetadataRecord} */
  const record = {
    ...(id !== undefined && id !== null ? { id } : {}),
    timestamp,
    colors: [...(Array.isArray(colors) ? colors : [])],
    captureAspectRatio,
    captureCropRect: normalizeCaptureCropRect(captureCropRect),
    ...(captureMode === "ral" ? { captureMode: "ral", ralMatch } : {}),
    polaroidRenderSettings: normalizePolaroidRenderSettings(polaroidRenderSettings),
    remoteCatchId: normalizeRemoteCatchId(remoteCatchId),
    remoteOwnerAccountKey: normalizeRemoteCatchId(remoteCatchId)
      ? normalizeRemoteOwnerAccountKey(remoteOwnerAccountKey)
      : null,
    moderationStatus: normalizeModerationStatus(moderationStatus),
    postedAt: normalizeIsoString(postedAt),
    moderationUpdatedAt: normalizeIsoString(moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(lastModerationCheckAt),
    hasPhotoAsset: Boolean(hasPhotoAsset),
  };

  return record;
}

export function createLeanPaletteMetadataRecord(palette) {
  return stripPalettePreviewFields(
    normalizeStoredPaletteRecord(palette, {
      includePhotoBlob: false,
      includeViewerPreviewBlob: false,
    }),
  );
}

export function createPalettePreviewRecord(paletteId, variant, blob, footerLabel = null) {
  const normalizedPaletteId = Number(paletteId);
  if (!Number.isFinite(normalizedPaletteId) || !(blob instanceof Blob)) {
    return null;
  }

  return {
    paletteId: normalizedPaletteId,
    variant: normalizePreviewVariant(variant),
    blob,
    footerLabel: normalizePreviewFooterLabel(footerLabel),
  };
}

export function createPaletteAssetRecord(paletteId, photoBlob) {
  return {
    paletteId,
    photoBlob,
  };
}

export function getPaletteIdOrThrow(id) {
  const paletteId = Number(id);
  if (!Number.isFinite(paletteId)) {
    throw new Error("Invalid palette id.");
  }

  return paletteId;
}
