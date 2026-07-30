import { getAppSettings } from "../app-settings.js";
import { clientLog } from "../modules/client-log.js";
import { reportAppError } from "../modules/error-reporting.js";
import { recordIndexedDbFailure } from "../modules/operational-metrics.js";
import { dataUrlToBlob } from "./blob.js";
import {
  ensurePaletteMasterPhotoBlob,
  readPaletteMetadataRecord,
  readPalettePhotoBlobById,
} from "./assets.js";
import { db } from "./db.js";
import {
  createPaletteAssetRecord,
  createPaletteMetadataRecord,
  createPalettePreviewRecord,
  getPaletteIdOrThrow,
  normalizeIsoString,
  normalizeModerationStatus,
  normalizeRemoteCatchId,
  normalizeRemoteOwnerAccountKey,
  normalizeStoredPaletteRecord,
  parseStoredPaletteMetadataRecord,
} from "./records.js";

const MAX_BULK_REMOTE_STATE_UPDATES = 2_000;
const MAX_BULK_FAVORITE_UPDATES = 2_000;
const MAX_REPORTED_INVALID_PALETTE_RECORDS = 2_000;
const INVALID_PALETTE_REPORT_THROTTLE_MS = 60_000;

export class PaletteRecordMissingError extends Error {
  constructor(paletteId) {
    super(`Palette ${paletteId} no longer exists.`);
    this.name = "PaletteRecordMissingError";
    this.code = "PALETTE_RECORD_MISSING";
    this.paletteId = paletteId;
  }
}

function getCurrentPolaroidRenderSettings() {
  const settings = getAppSettings();
  return { footerLabel: settings.polaroidFooterLabel };
}

function reportInvalidStoredPaletteRecords(invalidCount) {
  if (invalidCount <= 0) {
    return;
  }

  reportAppError(null, {
    logMessage: "Ignored invalid stored palette metadata records.",
    includeConsole: false,
    clientLogKey: "palette-storage-invalid-metadata",
    clientLogThrottleMs: INVALID_PALETTE_REPORT_THROTTLE_MS,
    context: {
      invalidCount: Math.min(invalidCount, MAX_REPORTED_INVALID_PALETTE_RECORDS),
      invalidCountCapped: invalidCount > MAX_REPORTED_INVALID_PALETTE_RECORDS,
    },
  });
}

/**
 * @returns {Promise<Palette[]>}
 */
export async function getSavedPalettes() {
  const startTime = performance.now();
  try {
    const dexieReadStartTime = performance.now();
    const rawRecords = await db.palettes.orderBy("timestamp").reverse().toArray();
    const dexieReadMs = performance.now() - dexieReadStartTime;

    const result = [];
    let invalidCount = 0;
    for (const rawRecord of rawRecords) {
      const palette = parseStoredPaletteMetadataRecord(rawRecord);
      if (palette) {
        result.push(palette);
      } else {
        invalidCount += 1;
      }
    }
    reportInvalidStoredPaletteRecords(invalidCount);

    clientLog("getSavedPalettes:success", {
      totalMs: Math.round(performance.now() - startTime),
      dexieReadMs: Math.round(dexieReadMs),
      rawCount: rawRecords.length,
      returnedCount: result.length,
    });

    return result;
  } catch (error) {
    recordIndexedDbFailure("read", error);
    clientLog("getSavedPalettes:error", {
      totalMs: Math.round(performance.now() - startTime),
      errorName: error?.name ?? "",
    });
    reportAppError(error, {
      consoleMessage: "Failed to read saved palettes:",
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

    const palette = parseStoredPaletteMetadataRecord(paletteRecord);
    if (!palette) {
      reportInvalidStoredPaletteRecords(1);
      return undefined;
    }
    if (!includePhotoBlob) {
      return palette;
    }

    const photoBlob = await readPalettePhotoBlobById(paletteId);
    return normalizeStoredPaletteRecord(palette, {
      includePhotoBlob: true,
      photoBlob,
    });
  } catch (error) {
    recordIndexedDbFailure("read", error);
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
    captureAspectRatio = "4:3",
    captureCropRect = null,
    captureMode,
    ralMatch = null,
    polaroidRenderSettings = getCurrentPolaroidRenderSettings(),
  } = {},
) {
  const timestamp = new Date().toISOString();
  const photoBlob =
    providedPhotoBlob instanceof Blob
      ? providedPhotoBlob
      : typeof photoDataUrl === "string" && photoDataUrl.length > 0
        ? dataUrlToBlob(photoDataUrl)
        : null;

  if (!(photoBlob instanceof Blob)) {
    throw new Error("Missing photo data.");
  }

  const nextPaletteMetadata = createPaletteMetadataRecord({
    timestamp,
    colors,
    captureAspectRatio,
    captureCropRect,
    captureMode,
    ralMatch,
    polaroidRenderSettings,
    hasPhotoAsset: true,
  });

  try {
    let savedPaletteId = 0;

    await db.transaction("rw", db.palettes, db.paletteAssets, db.palettePreviews, async () => {
      savedPaletteId = await db.palettes.add(nextPaletteMetadata);
      await db.paletteAssets.put(createPaletteAssetRecord(savedPaletteId, photoBlob));

      const previewRecords = [
        createPalettePreviewRecord(
          savedPaletteId,
          "gallery",
          previewGalleryBlob,
          previewGalleryFooterLabel,
        ),
        createPalettePreviewRecord(
          savedPaletteId,
          "viewer",
          previewViewerBlob,
          previewViewerFooterLabel,
        ),
      ].filter((record) => record !== null);
      if (previewRecords.length > 0) {
        await db.palettePreviews.bulkPut(previewRecords);
      }
    });

    return normalizeStoredPaletteRecord(
      {
        ...nextPaletteMetadata,
        id: savedPaletteId,
        ...(previewGalleryBlob instanceof Blob
          ? { previewGalleryBlob, previewGalleryFooterLabel }
          : {}),
        ...(previewViewerBlob instanceof Blob
          ? { previewViewerBlob, previewViewerFooterLabel }
          : {}),
      },
      {
        includePhotoBlob: true,
        photoBlob,
      },
    );
  } catch (error) {
    recordIndexedDbFailure("save", error);
    reportAppError(error, {
      consoleMessage: "Failed to save palette:",
      includeClientLog: false,
    });
    throw new Error("Unable to save palette.", { cause: error });
  }
}

/**
 * @param {Partial<Pick<Palette, 'remoteCatchId' | 'remoteOwnerAccountKey' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>} [patch]
 * @returns {Partial<Pick<Palette, 'remoteCatchId' | 'remoteOwnerAccountKey' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>}
 */
function normalizePaletteRemoteStatePatch(patch = {}) {
  const nextPatch = {};

  if (Object.hasOwn(patch, "remoteCatchId")) {
    nextPatch.remoteCatchId = normalizeRemoteCatchId(patch.remoteCatchId);
    if (nextPatch.remoteCatchId === null && !Object.hasOwn(patch, "remoteOwnerAccountKey")) {
      nextPatch.remoteOwnerAccountKey = null;
    }
  }

  if (Object.hasOwn(patch, "remoteOwnerAccountKey")) {
    nextPatch.remoteOwnerAccountKey = normalizeRemoteOwnerAccountKey(patch.remoteOwnerAccountKey);
  }

  if (Object.hasOwn(patch, "moderationStatus")) {
    nextPatch.moderationStatus = normalizeModerationStatus(patch.moderationStatus);
  }

  if (Object.hasOwn(patch, "postedAt")) {
    nextPatch.postedAt = normalizeIsoString(patch.postedAt);
  }

  if (Object.hasOwn(patch, "moderationUpdatedAt")) {
    nextPatch.moderationUpdatedAt = normalizeIsoString(patch.moderationUpdatedAt);
  }

  if (Object.hasOwn(patch, "lastModerationCheckAt")) {
    nextPatch.lastModerationCheckAt = normalizeIsoString(patch.lastModerationCheckAt);
  }

  return nextPatch;
}

/**
 * @param {number} id
 * @param {Partial<Pick<Palette, 'remoteCatchId' | 'remoteOwnerAccountKey' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>} [patch]
 * @returns {Promise<Palette | undefined>}
 */
export async function updatePaletteRemoteState(id, patch = {}) {
  const paletteId = getPaletteIdOrThrow(id);
  const nextPatch = normalizePaletteRemoteStatePatch(patch);

  if (Object.keys(nextPatch).length === 0) {
    return getSavedPaletteById(paletteId, { includePhotoBlob: false });
  }

  try {
    const updatedCount = await db.palettes.update(paletteId, nextPatch);
    if (updatedCount !== 1) {
      throw new PaletteRecordMissingError(paletteId);
    }
    const updatedPalette = await getSavedPaletteById(paletteId, { includePhotoBlob: false });
    if (!updatedPalette) {
      throw new PaletteRecordMissingError(paletteId);
    }
    return updatedPalette;
  } catch (error) {
    if (error instanceof PaletteRecordMissingError) {
      throw error;
    }
    recordIndexedDbFailure("update", error);
    reportAppError(error, {
      consoleMessage: `Failed to update remote state for palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw new Error("Unable to update palette remote state.", { cause: error });
  }
}

/**
 * Stars or unstars a bounded set of palettes in one transaction. Missing records
 * are skipped rather than throwing, so a stale selection stays harmless.
 * @param {Array<number | string>} paletteIds
 * @param {boolean} isFavorite
 * @returns {Promise<{favoritedAt: string | null, updatedIds: number[]}>}
 */
export async function setPaletteFavorites(paletteIds, isFavorite) {
  if (!Array.isArray(paletteIds)) {
    throw new TypeError("Palette favorite updates must be an array.");
  }
  if (paletteIds.length > MAX_BULK_FAVORITE_UPDATES) {
    throw new RangeError(
      `Palette favorite updates support at most ${MAX_BULK_FAVORITE_UPDATES} entries.`,
    );
  }

  const keys = [...new Set(paletteIds.map((paletteId) => getPaletteIdOrThrow(paletteId)))];
  const favoritedAt = isFavorite ? new Date().toISOString() : null;
  if (keys.length === 0) {
    return { favoritedAt, updatedIds: [] };
  }

  try {
    /** @type {number[]} */
    let updatedIds = [];
    await db.transaction("rw", db.palettes, async () => {
      const currentRows = await db.palettes.bulkGet(keys);
      const existingKeys = keys.filter((_key, index) => currentRows[index] !== undefined);
      if (existingKeys.length === 0) {
        return;
      }

      await db.palettes.bulkUpdate(existingKeys.map((key) => ({ key, changes: { favoritedAt } })));
      updatedIds = existingKeys;
    });
    return { favoritedAt, updatedIds };
  } catch (error) {
    recordIndexedDbFailure("update", error);
    reportAppError(error, {
      consoleMessage: "Failed to update palette favorites:",
      includeClientLog: false,
    });
    throw new Error("Unable to update palette favorites.", { cause: error });
  }
}

/**
 * Atomically applies a bounded set of normalized remote-state patches without
 * reading full palette records back into memory.
 * @param {Array<{id: number | string, patch: Partial<Pick<Palette, 'remoteCatchId' | 'remoteOwnerAccountKey' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>}>} updates
 * @returns {Promise<number>} number of existing records updated
 */
export async function bulkUpdatePaletteRemoteStates(updates) {
  if (!Array.isArray(updates)) {
    throw new TypeError("Palette remote-state updates must be an array.");
  }
  if (updates.length > MAX_BULK_REMOTE_STATE_UPDATES) {
    throw new RangeError(
      `Palette remote-state updates support at most ${MAX_BULK_REMOTE_STATE_UPDATES} entries.`,
    );
  }

  const normalizedUpdates = updates
    .map((update) => ({
      key: getPaletteIdOrThrow(update?.id),
      changes: normalizePaletteRemoteStatePatch(update?.patch),
    }))
    .filter((update) => Object.keys(update.changes).length > 0);

  if (normalizedUpdates.length === 0) {
    return 0;
  }

  try {
    let updatedCount = 0;
    await db.transaction("rw", db.palettes, async () => {
      updatedCount = await db.palettes.bulkUpdate(normalizedUpdates);
    });
    return updatedCount;
  } catch (error) {
    recordIndexedDbFailure("update", error);
    reportAppError(error, {
      consoleMessage: "Failed to bulk update palette remote states:",
      includeClientLog: false,
    });
    throw new Error("Unable to bulk update palette remote states.", { cause: error });
  }
}

/**
 * Applies moderation results only while the authoritative owner and remote id
 * still match the request snapshot. This prevents a late cross-tab response
 * from overwriting a republished palette.
 * @param {Array<{id: number | string, expectedRemoteCatchId: string, patch: Partial<Pick<Palette, 'moderationStatus' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>}>} updates
 * @param {{ownerAccountKey: string}} options
 */
export async function bulkUpdateOwnedPaletteRemoteStates(
  updates,
  { ownerAccountKey } = { ownerAccountKey: "" },
) {
  if (!Array.isArray(updates)) {
    throw new TypeError("Palette remote-state updates must be an array.");
  }
  if (updates.length > MAX_BULK_REMOTE_STATE_UPDATES) {
    throw new RangeError(
      `Palette remote-state updates support at most ${MAX_BULK_REMOTE_STATE_UPDATES} entries.`,
    );
  }
  const normalizedOwner = normalizeRemoteOwnerAccountKey(ownerAccountKey);
  if (!normalizedOwner) {
    throw new TypeError("A valid remote owner account key is required.");
  }

  const normalizedUpdates = updates.map((update) => {
    const expectedRemoteCatchId = normalizeRemoteCatchId(update?.expectedRemoteCatchId);
    if (!expectedRemoteCatchId) {
      throw new TypeError("A valid expected remote catch id is required.");
    }
    return {
      key: getPaletteIdOrThrow(update?.id),
      expectedRemoteCatchId,
      changes: normalizePaletteRemoteStatePatch(update?.patch),
    };
  });
  if (normalizedUpdates.length === 0) return 0;

  try {
    let updatedCount = 0;
    await db.transaction("rw", db.palettes, async () => {
      const currentRows = await db.palettes.bulkGet(normalizedUpdates.map((update) => update.key));
      const safeUpdates = normalizedUpdates
        .filter((update, index) => {
          const current = currentRows[index];
          return (
            normalizeRemoteOwnerAccountKey(current?.remoteOwnerAccountKey) === normalizedOwner &&
            normalizeRemoteCatchId(current?.remoteCatchId) === update.expectedRemoteCatchId
          );
        })
        .filter((update) => Object.keys(update.changes).length > 0)
        .map(({ key, changes }) => ({ key, changes }));
      updatedCount = safeUpdates.length > 0 ? await db.palettes.bulkUpdate(safeUpdates) : 0;
    });
    return updatedCount;
  } catch (error) {
    recordIndexedDbFailure("update", error);
    reportAppError(error, {
      consoleMessage: "Failed to conditionally update palette remote states:",
      includeClientLog: false,
    });
    throw new Error("Unable to conditionally update palette remote states.", { cause: error });
  }
}

export async function clearCommunityStateForAccount(ownerAccountKey) {
  const normalizedOwners = [
    ...new Set(
      (Array.isArray(ownerAccountKey) ? ownerAccountKey : [ownerAccountKey])
        .map(normalizeRemoteOwnerAccountKey)
        .filter(Boolean),
    ),
  ];
  if (normalizedOwners.length === 0) {
    return { clearedOutboxCount: 0, clearedPaletteCount: 0 };
  }

  const changes = {
    remoteCatchId: null,
    remoteOwnerAccountKey: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
  };
  try {
    let clearedOutboxCount = 0;
    let clearedPaletteCount = 0;
    await db.transaction("rw", db.palettes, db.communityDeleteOutbox, async () => {
      const palettes = await db.palettes.toArray();
      const ownedIds = palettes
        .filter((palette) =>
          normalizedOwners.includes(normalizeRemoteOwnerAccountKey(palette?.remoteOwnerAccountKey)),
        )
        .map((palette) => palette.id)
        .filter(Number.isSafeInteger);
      clearedPaletteCount =
        ownedIds.length > 0
          ? await db.palettes.bulkUpdate(ownedIds.map((key) => ({ key, changes })))
          : 0;
      for (const normalizedOwner of normalizedOwners) {
        clearedOutboxCount += await db.communityDeleteOutbox
          .where("accountKey")
          .equals(normalizedOwner)
          .delete();
      }
    });
    return { clearedOutboxCount, clearedPaletteCount };
  } catch (error) {
    recordIndexedDbFailure("update", error);
    reportAppError(error, {
      consoleMessage: "Failed to clear account-scoped community state:",
      includeClientLog: false,
    });
    throw new Error("Unable to clear account-scoped community state.", { cause: error });
  }
}

/** @param {number[]} paletteIds */
export async function clearPaletteRemoteStates(paletteIds) {
  const ids = [...new Set(paletteIds.map(Number).filter(Number.isSafeInteger))];
  if (ids.length === 0) return;

  const changes = {
    remoteCatchId: null,
    remoteOwnerAccountKey: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
  };
  await db.transaction("rw", db.palettes, async () => {
    await db.palettes.bulkUpdate(ids.map((key) => ({ key, changes })));
  });
}

export async function clearSavedPalettes() {
  try {
    await db.transaction(
      "rw",
      db.palettes,
      db.paletteAssets,
      db.palettePreviews,
      db.communityDeleteOutbox,
      db.paletteStorageMetadata,
      db.paletteImportStaging,
      async () => {
        await db.paletteImportStaging.clear();
        await db.paletteStorageMetadata.clear();
        await db.communityDeleteOutbox.clear();
        await db.palettePreviews.clear();
        await db.paletteAssets.clear();
        await db.palettes.clear();
      },
    );
  } catch (error) {
    recordIndexedDbFailure("clear", error);
    reportAppError(error, {
      consoleMessage: "Failed to clear saved palettes:",
      includeClientLog: false,
    });
    throw new Error("Unable to clear saved palettes.", { cause: error });
  }
}

export { ensurePaletteMasterPhotoBlob };
