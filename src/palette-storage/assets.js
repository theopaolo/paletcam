import { reportAppError } from '../modules/error-reporting.js';
import { db } from './db.js';
import {
  createPaletteAssetRecord,
  getPreviewVariantFieldKeys,
  getPaletteIdOrThrow,
  normalizePolaroidColorNames,
  normalizePreviewFooterLabel,
  normalizeStoredPaletteRecord,
} from './records.js';

export async function readPaletteMetadataRecord(paletteId) {
  return db.palettes.get(paletteId);
}

async function repairLegacyPaletteAssetRecord(paletteId, legacyPaletteRecord) {
  if (!(legacyPaletteRecord?.photoBlob instanceof Blob)) {
    return legacyPaletteRecord?.photoBlob ?? null;
  }

  await db.transaction('rw', db.palettes, db.paletteAssets, async () => {
    const currentPaletteRecord = await db.palettes.get(paletteId);
    if (!(currentPaletteRecord?.photoBlob instanceof Blob)) {
      return;
    }

    await db.paletteAssets.put(
      createPaletteAssetRecord(paletteId, currentPaletteRecord.photoBlob),
    );
    await db.palettes.put(
      normalizeStoredPaletteRecord({
        ...currentPaletteRecord,
        hasPhotoAsset: true,
      }, { includePhotoBlob: false }),
    );
  });

  return legacyPaletteRecord.photoBlob;
}

export async function readPalettePhotoBlobById(paletteId) {
  const paletteAsset = await db.paletteAssets.get(paletteId);
  if (paletteAsset?.photoBlob instanceof Blob) {
    return paletteAsset.photoBlob;
  }

  const legacyPaletteRecord = await db.palettes.get(paletteId);
  if (legacyPaletteRecord?.photoBlob instanceof Blob) {
    return repairLegacyPaletteAssetRecord(paletteId, legacyPaletteRecord);
  }

  return null;
}

/**
 * @param {Palette} palette
 * @returns {Promise<Blob | null>}
 */
export async function ensurePaletteMasterPhotoBlob(palette) {
  if (!palette || typeof palette !== 'object') {
    return null;
  }

  if (palette.photoBlob instanceof Blob) {
    palette.hasPhotoAsset = true;
    return palette.photoBlob;
  }

  const paletteId = Number(palette.id);
  if (!Number.isFinite(paletteId)) {
    return null;
  }

  try {
    const photoBlob = await readPalettePhotoBlobById(paletteId);
    if (photoBlob instanceof Blob) {
      palette.photoBlob = photoBlob;
      palette.hasPhotoAsset = true;
      return photoBlob;
    }

    return null;
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to hydrate photo asset for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw error;
  }
}

/**
 * @param {number} id
 * @param {Blob | null} previewBlob
 * @param {string | null} [previewFooterLabel]
 * @param {object} [options]
 * @param {"gallery" | "viewer"} [options.variant]
 * @returns {Promise<Palette | undefined>}
 */
export async function updatePalettePreviewBlob(
  id,
  previewBlob,
  previewFooterLabel = null,
  { variant = 'viewer' } = {},
) {
  const paletteId = getPaletteIdOrThrow(id);
  const { blobKey, footerKey } = getPreviewVariantFieldKeys(variant);
  const previewPatch = {
    [blobKey]: previewBlob instanceof Blob ? previewBlob : undefined,
    [footerKey]: normalizePreviewFooterLabel(previewFooterLabel),
  };

  try {
    if (previewBlob instanceof Blob) {
      await db.palettes.update(paletteId, previewPatch);
    } else {
      const paletteRecord = await db.palettes.get(paletteId);
      if (!paletteRecord) {
        return undefined;
      }

      const nextPaletteRecord = normalizeStoredPaletteRecord({
        ...paletteRecord,
        [footerKey]: normalizePreviewFooterLabel(previewFooterLabel),
      }, { includePhotoBlob: false });
      delete nextPaletteRecord[blobKey];
      await db.palettes.put(nextPaletteRecord);
    }

    const nextPaletteRecord = await db.palettes.get(paletteId);
    return nextPaletteRecord
      ? normalizeStoredPaletteRecord(nextPaletteRecord, { includePhotoBlob: false })
      : undefined;
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to update preview blob for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error('Unable to update palette preview blob.', { cause: error });
  }
}

export async function updatePalettePolaroidColorNames(id, colorNames) {
  const paletteId = getPaletteIdOrThrow(id);
  const polaroidColorNames = normalizePolaroidColorNames(colorNames);

  try {
    await db.palettes.update(paletteId, { polaroidColorNames });
    const nextPaletteRecord = await db.palettes.get(paletteId);
    return nextPaletteRecord
      ? normalizeStoredPaletteRecord(nextPaletteRecord, { includePhotoBlob: false })
      : undefined;
  } catch (error) {
    reportAppError(error, {
      consoleMessage: `Failed to update color names for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error('Unable to update palette color names.', { cause: error });
  }
}
