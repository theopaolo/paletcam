import { reportAppError } from "../modules/error-reporting.js";
import { recordIndexedDbFailure } from "../modules/operational-metrics.js";
import { db } from "./db.js";
import {
  createPaletteAssetRecord,
  createPalettePreviewRecord,
  getPaletteIdOrThrow,
  getPalettePreviewMutationVariantOrThrow,
  normalizePreviewFooterLabel,
  normalizePreviewVariant,
  normalizeStoredPaletteRecord,
} from "./records.js";

const ASSET_BULK_READ_BATCH_SIZE = 25;
const LEGACY_PREVIEW_FIELDS = Object.freeze({
  gallery: Object.freeze(["previewGalleryBlob", "previewGalleryFooterLabel"]),
  viewer: Object.freeze([
    "previewViewerBlob",
    "previewViewerFooterLabel",
    "previewBlob",
    "previewFooterLabel",
  ]),
});

export async function readPaletteMetadataRecord(paletteId) {
  return db.palettes.get(paletteId);
}

async function repairLegacyPaletteAssetRecord(paletteId, legacyPaletteRecord) {
  if (!(legacyPaletteRecord?.photoBlob instanceof Blob)) {
    return legacyPaletteRecord?.photoBlob ?? null;
  }

  await db.transaction("rw", db.palettes, db.paletteAssets, async () => {
    const currentPaletteRecord = await db.palettes.get(paletteId);
    if (!(currentPaletteRecord?.photoBlob instanceof Blob)) {
      return;
    }

    await db.paletteAssets.put(createPaletteAssetRecord(paletteId, currentPaletteRecord.photoBlob));
    await db.palettes.put(
      normalizeStoredPaletteRecord(
        {
          ...currentPaletteRecord,
          hasPhotoAsset: true,
        },
        { includePhotoBlob: false },
      ),
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

function getNormalizedPaletteIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  return [...new Set(ids.map(Number).filter(Number.isFinite))];
}

async function bulkGetTableRecords(table, keys) {
  return typeof table.bulkGet === "function"
    ? table.bulkGet(keys)
    : Promise.all(keys.map((key) => table.get(key)));
}

/**
 * Reads master photo blobs in bounded batches. Legacy rows are repaired only
 * for missing entries, keeping the normal path to one bulk read per batch.
 * @param {Array<number | string>} ids
 * @returns {Promise<Map<number, Blob | null>>}
 */
export async function readPalettePhotoBlobsByIds(ids) {
  const paletteIds = getNormalizedPaletteIds(ids);
  const photoBlobs = new Map();

  for (let index = 0; index < paletteIds.length; index += ASSET_BULK_READ_BATCH_SIZE) {
    const batchIds = paletteIds.slice(index, index + ASSET_BULK_READ_BATCH_SIZE);
    const paletteAssets = await bulkGetTableRecords(db.paletteAssets, batchIds);
    const missingIds = [];

    batchIds.forEach((paletteId, batchIndex) => {
      const photoBlob = paletteAssets[batchIndex]?.photoBlob;
      if (photoBlob instanceof Blob) {
        photoBlobs.set(paletteId, photoBlob);
      } else {
        missingIds.push(paletteId);
      }
    });
    if (missingIds.length === 0) {
      continue;
    }

    const legacyPaletteRecords = await bulkGetTableRecords(db.palettes, missingIds);
    await Promise.all(
      missingIds.map(async (paletteId, missingIndex) => {
        const legacyPaletteRecord = legacyPaletteRecords[missingIndex];
        const photoBlob =
          legacyPaletteRecord?.photoBlob instanceof Blob
            ? await repairLegacyPaletteAssetRecord(paletteId, legacyPaletteRecord)
            : null;
        photoBlobs.set(paletteId, photoBlob instanceof Blob ? photoBlob : null);
      }),
    );
  }

  return photoBlobs;
}

function getLegacyPreviewValue(paletteRecord, variant) {
  if (!paletteRecord || typeof paletteRecord !== "object") {
    return null;
  }

  if (variant === "gallery") {
    return paletteRecord.previewGalleryBlob instanceof Blob
      ? {
          blob: paletteRecord.previewGalleryBlob,
          footerLabel: normalizePreviewFooterLabel(paletteRecord.previewGalleryFooterLabel),
        }
      : null;
  }

  const hasViewerSpecificPreview = paletteRecord.previewViewerBlob instanceof Blob;
  const blob = hasViewerSpecificPreview
    ? paletteRecord.previewViewerBlob
    : paletteRecord.previewBlob;
  if (!(blob instanceof Blob)) {
    return null;
  }

  return {
    blob,
    footerLabel: normalizePreviewFooterLabel(
      hasViewerSpecificPreview
        ? paletteRecord.previewViewerFooterLabel
        : paletteRecord.previewFooterLabel,
    ),
  };
}

async function scrubLegacyPreviewFields(paletteRecord, variant) {
  if (!paletteRecord || typeof paletteRecord !== "object") {
    return false;
  }

  const legacyFields = LEGACY_PREVIEW_FIELDS[variant];
  if (!legacyFields.some((field) => Object.hasOwn(paletteRecord, field))) {
    return false;
  }

  const nextPaletteRecord = { ...paletteRecord };
  legacyFields.forEach((field) => {
    delete nextPaletteRecord[field];
  });
  await db.palettes.put(nextPaletteRecord);
  return true;
}

async function repairLegacyPalettePreviewRecord(paletteId, variant) {
  /** @type {{blob: Blob, footerLabel: string | null} | null} */
  let repairedPreview = null;

  await db.transaction("rw", db.palettes, db.palettePreviews, async () => {
    const currentPreviewRecord = await db.palettePreviews.get([paletteId, variant]);
    if (currentPreviewRecord?.blob instanceof Blob) {
      repairedPreview = {
        blob: currentPreviewRecord.blob,
        footerLabel: normalizePreviewFooterLabel(currentPreviewRecord.footerLabel),
      };
      return;
    }

    const currentPaletteRecord = await db.palettes.get(paletteId);
    const legacyPreview = getLegacyPreviewValue(currentPaletteRecord, variant);
    if (legacyPreview) {
      await db.palettePreviews.put(
        createPalettePreviewRecord(
          paletteId,
          variant,
          legacyPreview.blob,
          legacyPreview.footerLabel,
        ),
      );
    }

    await scrubLegacyPreviewFields(currentPaletteRecord, variant);
    repairedPreview = legacyPreview;
  });

  return repairedPreview;
}

/**
 * Reads a single palette preview blob from IDB without materializing the full
 * record into memory afterwards. Returns the blob and its footer label, or
 * null when no blob exists.
 * @param {number | string} id
 * @param {"gallery" | "viewer"} variant
 * @returns {Promise<{ blob: Blob, footerLabel: string | null } | null>}
 */
export async function readPalettePreviewBlobById(id, variant = "viewer") {
  const paletteId = Number(id);
  if (!Number.isFinite(paletteId)) {
    return null;
  }

  const normalizedVariant = normalizePreviewVariant(variant);
  const previewRecord = await db.palettePreviews.get([paletteId, normalizedVariant]);
  if (previewRecord?.blob instanceof Blob) {
    return {
      blob: previewRecord.blob,
      footerLabel: normalizePreviewFooterLabel(previewRecord.footerLabel),
    };
  }

  return repairLegacyPalettePreviewRecord(paletteId, normalizedVariant);
}

/**
 * Reads one preview variant in bounded batches. The map includes every valid,
 * unique requested id and stores null for palettes without that preview.
 * @param {Array<number | string>} ids
 * @param {"gallery" | "viewer"} variant
 * @returns {Promise<Map<number, {blob: Blob, footerLabel: string | null} | null>>}
 */
export async function readPalettePreviewBlobsByIds(ids, variant = "viewer") {
  const paletteIds = getNormalizedPaletteIds(ids);
  const normalizedVariant = normalizePreviewVariant(variant);
  const previews = new Map();

  for (let index = 0; index < paletteIds.length; index += ASSET_BULK_READ_BATCH_SIZE) {
    const batchIds = paletteIds.slice(index, index + ASSET_BULK_READ_BATCH_SIZE);
    const previewKeys = batchIds.map((paletteId) => [paletteId, normalizedVariant]);
    const previewRecords = await bulkGetTableRecords(db.palettePreviews, previewKeys);
    const missingIds = [];

    batchIds.forEach((paletteId, batchIndex) => {
      const previewRecord = previewRecords[batchIndex];
      if (previewRecord?.blob instanceof Blob) {
        previews.set(paletteId, {
          blob: previewRecord.blob,
          footerLabel: normalizePreviewFooterLabel(previewRecord.footerLabel),
        });
      } else {
        missingIds.push(paletteId);
      }
    });
    if (missingIds.length === 0) {
      continue;
    }

    const legacyPaletteRecords = await bulkGetTableRecords(db.palettes, missingIds);
    await Promise.all(
      missingIds.map(async (paletteId, missingIndex) => {
        const legacyPaletteRecord = legacyPaletteRecords[missingIndex];
        const hasLegacyFields = LEGACY_PREVIEW_FIELDS[normalizedVariant].some((field) =>
          Object.hasOwn(legacyPaletteRecord ?? {}, field),
        );
        const legacyPreview = hasLegacyFields
          ? await repairLegacyPalettePreviewRecord(paletteId, normalizedVariant)
          : null;
        previews.set(paletteId, legacyPreview);
      }),
    );
  }

  return previews;
}

/**
 * @param {Palette} palette
 * @returns {Promise<Blob | null>}
 */
export async function ensurePaletteMasterPhotoBlob(palette) {
  if (!palette || typeof palette !== "object") {
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
    recordIndexedDbFailure("asset-read", error);
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
 * @returns {Promise<PalettePreviewRecord | null>}
 */
export async function updatePalettePreviewBlob(
  id,
  previewBlob,
  previewFooterLabel = null,
  { variant = "viewer" } = {},
) {
  const paletteId = getPaletteIdOrThrow(id);
  const normalizedVariant = getPalettePreviewMutationVariantOrThrow(variant);
  const previewRecord = /** @type {PalettePreviewRecord | null} */ (
    createPalettePreviewRecord(paletteId, normalizedVariant, previewBlob, previewFooterLabel)
  );

  try {
    let didUpdatePreview = false;
    await db.transaction("rw", db.palettes, db.palettePreviews, async () => {
      const paletteRecord = await db.palettes.get(paletteId);
      if (!paletteRecord) {
        return;
      }

      if (previewRecord) {
        await db.palettePreviews.put(previewRecord);
      } else {
        await db.palettePreviews.delete([paletteId, normalizedVariant]);
      }

      await scrubLegacyPreviewFields(paletteRecord, normalizedVariant);
      didUpdatePreview = true;
    });

    return didUpdatePreview ? previewRecord : null;
  } catch (error) {
    recordIndexedDbFailure("asset-write", error);
    reportAppError(error, {
      consoleMessage: `Failed to update preview blob for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error("Unable to update palette preview blob.", { cause: error });
  }
}
