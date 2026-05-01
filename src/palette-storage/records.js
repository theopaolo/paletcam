const KNOWN_MODERATION_STATUSES = new Set([
  'TO_MODERATE',
  'PUBLIC',
  'REJECTED',
  'PRIVATE',
]);

export function normalizeRemoteCatchId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeModerationStatus(value) {
  if (typeof value !== 'string') {
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
  return typeof value === 'string' ? value : null;
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
  {
    includePhotoBlob = false,
    photoBlob = undefined,
  } = {},
) {
  const normalized = {
    ...palette,
    captureCropRect: normalizeCaptureCropRect(palette?.captureCropRect),
    remoteCatchId: normalizeRemoteCatchId(palette?.remoteCatchId),
    moderationStatus: normalizeModerationStatus(palette?.moderationStatus),
    postedAt: normalizeIsoString(palette?.postedAt),
    moderationUpdatedAt: normalizeIsoString(palette?.moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(palette?.lastModerationCheckAt),
    previewFooterLabel: normalizePreviewFooterLabel(palette?.previewFooterLabel),
    hasPhotoAsset: Boolean(
      palette?.hasPhotoAsset
      || photoBlob instanceof Blob
      || palette?.photoBlob instanceof Blob,
    ),
  };

  if (palette?.previewBlob instanceof Blob) {
    normalized.previewBlob = palette.previewBlob;
  } else {
    delete normalized.previewBlob;
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
  captureAspectRatio = '4:3',
  captureCropRect = null,
  captureMode,
  ralMatch = null,
  remoteCatchId = null,
  moderationStatus = null,
  postedAt = null,
  moderationUpdatedAt = null,
  lastModerationCheckAt = null,
  previewBlob = null,
  previewFooterLabel = null,
  hasPhotoAsset = false,
}) {
  const record = {
    ...(id !== undefined && id !== null ? { id } : {}),
    timestamp,
    colors: [...(Array.isArray(colors) ? colors : [])],
    captureAspectRatio,
    captureCropRect: normalizeCaptureCropRect(captureCropRect),
    ...(captureMode === 'ral' ? { captureMode: 'ral', ralMatch } : {}),
    remoteCatchId: normalizeRemoteCatchId(remoteCatchId),
    moderationStatus: normalizeModerationStatus(moderationStatus),
    postedAt: normalizeIsoString(postedAt),
    moderationUpdatedAt: normalizeIsoString(moderationUpdatedAt),
    lastModerationCheckAt: normalizeIsoString(lastModerationCheckAt),
    previewFooterLabel: normalizePreviewFooterLabel(previewFooterLabel),
    hasPhotoAsset: Boolean(hasPhotoAsset),
  };

  if (previewBlob instanceof Blob) {
    record.previewBlob = previewBlob;
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
    throw new Error('Invalid palette id.');
  }

  return paletteId;
}
