import { getAppSettings } from '../app-settings.js';
import { reportAppError } from '../modules/error-reporting.js';
import { dataUrlToBlob } from './blob.js';
import {
  ensurePaletteMasterPhotoBlob,
  readPaletteMetadataRecord,
  readPalettePhotoBlobById,
} from './assets.js';
import { db } from './db.js';
import {
  createPaletteAssetRecord,
  createPaletteMetadataRecord,
  getPaletteIdOrThrow,
  normalizeIsoString,
  normalizeModerationStatus,
  normalizePolaroidRenderSettings,
  normalizeRemoteCatchId,
  normalizeStoredPaletteRecord,
} from './records.js';

function getCurrentPolaroidRenderSettings() {
  const settings = getAppSettings();
  return {
    footerLabel: settings.polaroidFooterLabel,
    showColorNames: Boolean(settings.polaroidShowColorNames),
  };
}

async function freezeMissingPolaroidRenderSettings(paletteRecords) {
  const missingRecords = paletteRecords.filter(
    (palette) => !normalizePolaroidRenderSettings(palette?.polaroidRenderSettings),
  );

  if (missingRecords.length === 0) {
    return paletteRecords;
  }

  const polaroidRenderSettings = getCurrentPolaroidRenderSettings();
  const nextRecords = paletteRecords.map((palette) =>
    missingRecords.includes(palette)
      ? { ...palette, polaroidRenderSettings }
      : palette);

  await Promise.all(
    missingRecords
      .filter((palette) => palette?.id !== undefined && palette?.id !== null)
      .map((palette) => db.palettes.update(palette.id, { polaroidRenderSettings })),
  );

  return nextRecords;
}

/** @returns {Promise<Palette[]>} */
export async function getSavedPalettes() {
  try {
    const palettes = await freezeMissingPolaroidRenderSettings(
      await db.palettes.orderBy('timestamp').reverse().toArray(),
    );
    return palettes.map((palette) =>
      normalizeStoredPaletteRecord(palette, { includePhotoBlob: false }));
  } catch (error) {
    reportAppError(error, {
      consoleMessage: 'Failed to read saved palettes:',
      includeClientLog: false,
    });
    throw error;
  }
}

/**
 * @param {number | string} id
 * @param {object} [options]
 * @param {boolean} [options.includePhotoBlob]
 * @returns {Promise<Palette | undefined>}
 */
export async function getSavedPaletteById(id, { includePhotoBlob = true } = {}) {
  const paletteId = getPaletteIdOrThrow(id);

  try {
    const paletteRecord = await readPaletteMetadataRecord(paletteId);
    if (!paletteRecord) {
      return undefined;
    }

    const [frozenPaletteRecord] = await freezeMissingPolaroidRenderSettings([paletteRecord]);
    const palette = normalizeStoredPaletteRecord(frozenPaletteRecord, { includePhotoBlob: false });
    if (!includePhotoBlob) {
      return palette;
    }

    const photoBlob = await readPalettePhotoBlobById(paletteId);
    return normalizeStoredPaletteRecord(frozenPaletteRecord, {
      includePhotoBlob: true,
      photoBlob,
    });
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to read palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw error;
  }
}

/**
 * @param {RgbColor[]} colors
 * @param {object} [options]
 * @param {string} [options.photoDataUrl]
 * @param {Blob | null} [options.photoBlob]
 * @param {Blob | null} [options.previewBlob]
 * @param {string | null} [options.previewFooterLabel]
 * @param {Blob | null} [options.previewGalleryBlob]
 * @param {string | null} [options.previewGalleryFooterLabel]
 * @param {Blob | null} [options.previewViewerBlob]
 * @param {string | null} [options.previewViewerFooterLabel]
 * @param {string} [options.captureAspectRatio]
 * @param {CropRect | null} [options.captureCropRect]
 * @param {CaptureMode} [options.captureMode]
 * @param {RalMatchRecord | null} [options.ralMatch]
 * @param {PolaroidRenderSettings | null} [options.polaroidRenderSettings]
 * @param {string[] | null} [options.polaroidColorNames]
 * @returns {Promise<Palette>}
 */
export async function savePalette(
  colors,
  {
    photoDataUrl,
    photoBlob: providedPhotoBlob = null,
    previewBlob = null,
    previewFooterLabel = null,
    previewGalleryBlob = null,
    previewGalleryFooterLabel = null,
    previewViewerBlob = previewBlob,
    previewViewerFooterLabel = previewFooterLabel,
    captureAspectRatio = '4:3',
    captureCropRect = null,
    captureMode,
    ralMatch = null,
    polaroidRenderSettings = getCurrentPolaroidRenderSettings(),
    polaroidColorNames = null,
  } = {},
) {
  const timestamp = new Date().toISOString();
  const photoBlob = providedPhotoBlob instanceof Blob
    ? providedPhotoBlob
    : typeof photoDataUrl === 'string' && photoDataUrl.length > 0
      ? dataUrlToBlob(photoDataUrl)
      : null;

  if (!(photoBlob instanceof Blob)) {
    throw new Error('Missing photo data.');
  }

  const nextPaletteMetadata = createPaletteMetadataRecord({
    timestamp,
    colors,
    captureAspectRatio,
    captureCropRect,
    captureMode,
    ralMatch,
    polaroidRenderSettings,
    polaroidColorNames,
    previewGalleryBlob,
    previewGalleryFooterLabel,
    previewViewerBlob,
    previewViewerFooterLabel,
    hasPhotoAsset: true,
  });

  try {
    let savedPaletteId = 0;

    await db.transaction('rw', db.palettes, db.paletteAssets, async () => {
      savedPaletteId = await db.palettes.add(nextPaletteMetadata);
      await db.paletteAssets.put(createPaletteAssetRecord(savedPaletteId, photoBlob));
    });

    return normalizeStoredPaletteRecord({
      ...nextPaletteMetadata,
      id: savedPaletteId,
    }, {
      includePhotoBlob: true,
      photoBlob,
    });
  } catch (error) {
    reportAppError(error, {
      consoleMessage: 'Failed to save palette:',
      includeClientLog: false,
    });
    throw new Error('Unable to save palette.', { cause: error });
  }
}

/**
 * @param {number} id
 * @param {Partial<Pick<Palette, 'remoteCatchId' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>} [patch]
 * @returns {Promise<Palette | undefined>}
 */
export async function updatePaletteRemoteState(id, patch = {}) {
  const paletteId = getPaletteIdOrThrow(id);
  const nextPatch = {};

  if (Object.hasOwn(patch, 'remoteCatchId')) {
    nextPatch.remoteCatchId = normalizeRemoteCatchId(patch.remoteCatchId);
  }

  if (Object.hasOwn(patch, 'moderationStatus')) {
    nextPatch.moderationStatus = normalizeModerationStatus(patch.moderationStatus);
  }

  if (Object.hasOwn(patch, 'postedAt')) {
    nextPatch.postedAt = normalizeIsoString(patch.postedAt);
  }

  if (Object.hasOwn(patch, 'moderationUpdatedAt')) {
    nextPatch.moderationUpdatedAt = normalizeIsoString(patch.moderationUpdatedAt);
  }

  if (Object.hasOwn(patch, 'lastModerationCheckAt')) {
    nextPatch.lastModerationCheckAt = normalizeIsoString(patch.lastModerationCheckAt);
  }

  if (Object.keys(nextPatch).length === 0) {
    return getSavedPaletteById(paletteId, { includePhotoBlob: false });
  }

  try {
    await db.palettes.update(paletteId, nextPatch);
    return getSavedPaletteById(paletteId, { includePhotoBlob: false });
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to update remote state for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error('Unable to update palette remote state.', { cause: error });
  }
}

export async function deletePalette(id) {
  const paletteId = getPaletteIdOrThrow(id);

  try {
    await db.transaction('rw', db.palettes, db.paletteAssets, async () => {
      await db.paletteAssets.delete(paletteId);
      await db.palettes.delete(paletteId);
    });
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to delete palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error('Unable to delete palette.', { cause: error });
  }
}

export async function clearSavedPalettes() {
  try {
    await db.transaction('rw', db.palettes, db.paletteAssets, async () => {
      await db.paletteAssets.clear();
      await db.palettes.clear();
    });
  } catch (error) {
    reportAppError(error, {
      consoleMessage: 'Failed to clear saved palettes:',
      includeClientLog: false,
    });
    throw new Error('Unable to clear saved palettes.', { cause: error });
  }
}

export { ensurePaletteMasterPhotoBlob };
