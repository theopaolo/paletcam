const KNOWN_MODERATION_STATUSES = new Set(["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"]);
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

export function normalizeRemoteCatchId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeModerationStatus(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return KNOWN_MODERATION_STATUSES.has(normalized) ? normalized : null;
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

export function normalizePolaroidRenderSettings(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const footerLabel = typeof value.footerLabel === "string" ? value.footerLabel.trim() : "";
  return { footerLabel };
}

export function getPreviewVariantFieldKeys(variant) {
  return PREVIEW_VARIANT_FIELD_KEYS[normalizePreviewVariant(variant)];
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
  const normalized = {
    ...palette,
    captureCropRect: normalizeCaptureCropRect(palette?.captureCropRect),
    polaroidRenderSettings: normalizePolaroidRenderSettings(palette?.polaroidRenderSettings),
    remoteCatchId: normalizeRemoteCatchId(palette?.remoteCatchId),
    moderationStatus: normalizeModerationStatus(palette?.moderationStatus),
    postedAt: normalizeIsoString(palette?.postedAt),
    moderationUpdatedAt: normalizeIsoString(palette?.moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(palette?.lastModerationCheckAt),
    previewFooterLabel: normalizePreviewFooterLabel(palette?.previewFooterLabel),
    hasPhotoAsset: Boolean(
      palette?.hasPhotoAsset || photoBlob instanceof Blob || palette?.photoBlob instanceof Blob,
    ),
  };

  delete normalized.previewBlob;
  delete normalized.previewFooterLabel;
  delete normalized.previewSwatchBlob;
  delete normalized.polaroidColorNames;

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

export function createPaletteMetadataRecord({
  id,
  timestamp,
  colors,
  captureAspectRatio = "4:3",
  captureCropRect = null,
  captureMode,
  ralMatch = null,
  remoteCatchId = null,
  moderationStatus = null,
  postedAt = null,
  moderationUpdatedAt = null,
  lastModerationCheckAt = null,
  polaroidRenderSettings = null,
  previewGalleryBlob = null,
  previewGalleryFooterLabel = null,
  previewViewerBlob = null,
  previewViewerFooterLabel = null,
  hasPhotoAsset = false,
}) {
  const record = {
    ...(id !== undefined && id !== null ? { id } : {}),
    timestamp,
    colors: [...(Array.isArray(colors) ? colors : [])],
    captureAspectRatio,
    captureCropRect: normalizeCaptureCropRect(captureCropRect),
    ...(captureMode === "ral" ? { captureMode: "ral", ralMatch } : {}),
    polaroidRenderSettings: normalizePolaroidRenderSettings(polaroidRenderSettings),
    remoteCatchId: normalizeRemoteCatchId(remoteCatchId),
    moderationStatus: normalizeModerationStatus(moderationStatus),
    postedAt: normalizeIsoString(postedAt),
    moderationUpdatedAt: normalizeIsoString(moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(lastModerationCheckAt),
    hasPhotoAsset: Boolean(hasPhotoAsset),
  };

  if (previewViewerBlob instanceof Blob) {
    record.previewViewerBlob = previewViewerBlob;
  }

  if (normalizePreviewFooterLabel(previewViewerFooterLabel)) {
    record.previewViewerFooterLabel = normalizePreviewFooterLabel(previewViewerFooterLabel);
  }

  if (previewGalleryBlob instanceof Blob) {
    record.previewGalleryBlob = previewGalleryBlob;
  }

  if (normalizePreviewFooterLabel(previewGalleryFooterLabel)) {
    record.previewGalleryFooterLabel = normalizePreviewFooterLabel(previewGalleryFooterLabel);
  }

  return record;
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
