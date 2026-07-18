import { getAppSettings } from "../app-settings.js";
import { registerAppTermination } from "../modules/app-terminal-lifecycle.js";
import { createPaletteJsonWorkerController } from "../modules/palette-json-worker.js";
import { createPaletteBackupAbortError } from "./backup-transfer-errors.js";
import { db } from "./db.js";
import {
  PaletteBackupSizeLimitError,
  PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
  assertPaletteImportStringSize,
  assertPaletteExportCount,
  deserializePalettesFromImport,
  deserializePalettesFromImportBlob,
  PaletteBackupIntegrityError,
  serializePalettesForExport,
  serializePalettesForExportBlob,
} from "./json-transfer.js";
import {
  abortImportSession,
  beginImportSession,
  commitImportSession,
  PALETTE_IMPORT_STAGING_BATCH_SIZE,
  stageImportBatch,
} from "./import-staging.js";
import { normalizeStoredPaletteRecord } from "./records.js";

const paletteJsonWorkerController = createPaletteJsonWorkerController();
const EXPORT_OUTPUT_BLOB = "blob";
const EXPORT_OUTPUT_STRING = "string";
const EXPORT_ASSET_READ_BATCH_SIZE = 25;
const backupLifetimeAbortController = new AbortController();
const backupLifetimeSignal = backupLifetimeAbortController.signal;

/** @typedef {(progress: PaletteExportProgress) => void} ExportProgressCallback */
/** @typedef {{maxJsonBytes?: number, onProgress?: ExportProgressCallback, output?: "blob" | "string"}} ExportOptions */

function getElapsedTimeMs(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

function throwIfBackupTerminated() {
  if (!backupLifetimeSignal.aborted) {
    return;
  }
  throw backupLifetimeSignal.reason instanceof Error
    ? backupLifetimeSignal.reason
    : createPaletteBackupAbortError();
}

export function destroyPaletteBackupOperations() {
  if (backupLifetimeSignal.aborted) {
    return false;
  }
  const abortError = createPaletteBackupAbortError();
  backupLifetimeAbortController.abort(abortError);
  paletteJsonWorkerController.destroy?.(abortError);
  return true;
}

registerAppTermination(destroyPaletteBackupOperations);

function notifyExportProgress(onProgress, progress) {
  if (typeof onProgress === "function") {
    onProgress(progress);
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

function shouldYieldExportProgress(completed, total) {
  if (completed <= 0 || completed >= total) {
    return false;
  }

  return completed % 20 === 0;
}

function createElapsedProgressReporter(onProgress, startedAtMs) {
  return (progress) => {
    notifyExportProgress(onProgress, {
      ...progress,
      elapsedMs: getElapsedTimeMs(startedAtMs),
    });
  };
}

function createSerializationProgressReporter(onProgress, startedAtMs) {
  const reportProgress = createElapsedProgressReporter(onProgress, startedAtMs);

  return (progress) => {
    reportProgress({
      completed: progress?.completed ?? 0,
      phase: progress?.phase || "serializing",
      total: progress?.total ?? 0,
    });
  };
}

function createExportPaletteEntry(palette, fallbackPhotoBlob) {
  const {
    previewBlob: _previewBlob,
    previewFooterLabel: _previewFooterLabel,
    previewGalleryBlob: _previewGalleryBlob,
    previewGalleryFooterLabel: _previewGalleryFooterLabel,
    previewViewerBlob: _previewViewerBlob,
    previewViewerFooterLabel: _previewViewerFooterLabel,
    ...exportPalette
  } = palette;

  if (fallbackPhotoBlob instanceof Blob) {
    exportPalette.photoBlob = fallbackPhotoBlob;
  }

  return exportPalette;
}

async function readTableRecordsByKeys(table, keys) {
  const records = [];
  for (let index = 0; index < keys.length; index += EXPORT_ASSET_READ_BATCH_SIZE) {
    const batchKeys = keys.slice(index, index + EXPORT_ASSET_READ_BATCH_SIZE);
    const batchRecords =
      typeof table.bulkGet === "function"
        ? await table.bulkGet(batchKeys)
        : await Promise.all(batchKeys.map((key) => table.get(key)));
    records.push(...batchRecords);
  }
  return records;
}

async function readPaletteExportSnapshot() {
  let snapshot = {
    palettes: [],
    photoBlobsById: new Map(),
  };

  await db.transaction("r", db.palettes, db.paletteAssets, async () => {
    const palettes = await db.palettes.toArray();
    assertPaletteExportCount(palettes);
    const paletteIds = palettes.map((palette) => Number(palette?.id)).filter(Number.isFinite);
    const assetRecords = await readTableRecordsByKeys(db.paletteAssets, paletteIds);
    const photoBlobsById = new Map();
    paletteIds.forEach((paletteId, index) => {
      const photoBlob = assetRecords[index]?.photoBlob;
      photoBlobsById.set(paletteId, photoBlob instanceof Blob ? photoBlob : null);
    });

    snapshot = {
      palettes,
      photoBlobsById,
    };
  });

  return snapshot;
}

function getExportPhotoBlobOrThrow(photoBlob, index) {
  if (photoBlob instanceof Blob) {
    return photoBlob;
  }

  const paletteNumber = Number(index) + 1;
  throw new PaletteBackupIntegrityError(
    `Cannot export palette ${paletteNumber} without its master photo data.`,
  );
}

async function preparePalettesForExport({ onProgress, startedAtMs }) {
  throwIfBackupTerminated();
  const { palettes, photoBlobsById } = await readPaletteExportSnapshot();
  throwIfBackupTerminated();
  const preparedPalettes = [];
  const total = palettes.length;

  notifyExportProgress(onProgress, {
    completed: 0,
    elapsedMs: 0,
    phase: "preparing",
    total,
  });

  await waitForNextPaint();
  throwIfBackupTerminated();

  for (let index = 0; index < palettes.length; index += 1) {
    throwIfBackupTerminated();
    const paletteRecord = palettes[index];
    const palette = normalizeStoredPaletteRecord(paletteRecord, { includePhotoBlob: false });
    const masterPhotoBlob = photoBlobsById.get(palette.id);
    const fallbackPhotoBlob =
      masterPhotoBlob instanceof Blob
        ? masterPhotoBlob
        : paletteRecord?.photoBlob instanceof Blob
          ? paletteRecord.photoBlob
          : null;
    preparedPalettes.push(
      createExportPaletteEntry(palette, getExportPhotoBlobOrThrow(fallbackPhotoBlob, index)),
    );

    const completed = index + 1;
    notifyExportProgress(onProgress, {
      completed,
      elapsedMs: getElapsedTimeMs(startedAtMs),
      phase: "preparing",
      total,
    });

    if (shouldYieldExportProgress(completed, total)) {
      await waitForNextPaint();
      throwIfBackupTerminated();
    }
  }

  return {
    palettes: preparedPalettes,
    total,
  };
}

/** @param {object[]} preparedPalettes @param {ExportOptions & {startedAtMs: number, total: number}} options */
async function runSerializedPaletteExport(
  preparedPalettes,
  { maxJsonBytes, onProgress, output, startedAtMs, total },
) {
  const reportProgress = createElapsedProgressReporter(onProgress, startedAtMs);
  const onSerializationProgress = createSerializationProgressReporter(onProgress, startedAtMs);

  reportProgress({
    completed: 0,
    phase: "serializing",
    total,
  });
  await waitForNextPaint();
  throwIfBackupTerminated();

  const workerRequest =
    output === EXPORT_OUTPUT_BLOB
      ? paletteJsonWorkerController.exportPalettesBlob(preparedPalettes, {
          maxJsonBytes,
          onProgress: onSerializationProgress,
        })
      : paletteJsonWorkerController.exportPalettes(preparedPalettes, {
          maxJsonBytes,
          onProgress: onSerializationProgress,
        });

  if (workerRequest) {
    try {
      const result = await workerRequest;
      reportProgress({
        completed: total,
        phase: "finalizing",
        total,
      });
      await waitForNextPaint();
      throwIfBackupTerminated();
      return output === EXPORT_OUTPUT_BLOB ? result.blob : result.json;
    } catch (error) {
      throwIfBackupTerminated();
      if (paletteJsonWorkerController.isEnabled()) {
        throw error;
      }
    }
  }

  const fallbackResult =
    output === EXPORT_OUTPUT_BLOB
      ? await serializePalettesForExportBlob(preparedPalettes, {
          maxJsonBytes,
          onProgress: onSerializationProgress,
        })
      : await serializePalettesForExport(preparedPalettes, {
          maxJsonBytes,
          onProgress: onSerializationProgress,
        });
  throwIfBackupTerminated();

  reportProgress({
    completed: total,
    phase: "finalizing",
    total,
  });
  await waitForNextPaint();
  throwIfBackupTerminated();

  return fallbackResult;
}

/** @param {ExportOptions} [options] */
async function exportPalettes({ maxJsonBytes, onProgress, output = EXPORT_OUTPUT_STRING } = {}) {
  throwIfBackupTerminated();
  const startedAtMs = Date.now();
  const prepared = await preparePalettesForExport({ onProgress, startedAtMs });

  return runSerializedPaletteExport(prepared.palettes, {
    maxJsonBytes,
    onProgress,
    output,
    startedAtMs,
    total: prepared.total,
  });
}

/** @param {{maxJsonBytes?: number, onProgress?: ExportProgressCallback}} [options] @returns {Promise<string>} JSON string of all palettes */
export async function exportAllPalettes({ maxJsonBytes, onProgress } = {}) {
  return exportPalettes({ maxJsonBytes, onProgress, output: EXPORT_OUTPUT_STRING });
}

/** @param {{maxJsonBytes?: number, onProgress?: ExportProgressCallback}} [options] @returns {Promise<Blob>} JSON Blob of all palettes */
export async function exportAllPalettesBlob({ maxJsonBytes, onProgress } = {}) {
  return exportPalettes({ maxJsonBytes, onProgress, output: EXPORT_OUTPUT_BLOB });
}

/**
 * @param {string | Blob} importSource
 * @returns {Promise<number>} number of palettes imported
 */
export async function importAllPalettes(importSource) {
  throwIfBackupTerminated();
  if (
    typeof importSource !== "string" &&
    (!(importSource instanceof Blob) ||
      !Number.isSafeInteger(importSource.size) ||
      importSource.size > PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES)
  ) {
    throw new PaletteBackupSizeLimitError("Palette backup exceeds the import size limit.");
  }
  if (typeof importSource === "string") {
    assertPaletteImportStringSize(importSource);
  }

  const fallbackRenderSettings = {
    footerLabel: getAppSettings().polaroidFooterLabel,
  };
  let sessionId = null;

  async function stagePalettes(palettes) {
    if (!Array.isArray(palettes)) {
      return;
    }
    for (let index = 0; index < palettes.length; index += PALETTE_IMPORT_STAGING_BATCH_SIZE) {
      throwIfBackupTerminated();
      await stageImportBatch(
        sessionId,
        palettes.slice(index, index + PALETTE_IMPORT_STAGING_BATCH_SIZE),
      );
      throwIfBackupTerminated();
    }
  }

  try {
    sessionId = await beginImportSession();
    throwIfBackupTerminated();
    const workerRequest = paletteJsonWorkerController.importPalettes(importSource, {
      collect: typeof importSource === "string",
      onBatch: stagePalettes,
    });

    if (workerRequest) {
      try {
        const result = await workerRequest;
        throwIfBackupTerminated();
        await stagePalettes(result.palettes);
        return await commitImportSession(sessionId, fallbackRenderSettings, {
          signal: backupLifetimeSignal,
        });
      } catch (error) {
        throwIfBackupTerminated();
        if (paletteJsonWorkerController.isEnabled()) {
          throw error;
        }

        // A worker can become unavailable after staging provisional batches.
        // Discard them before restarting the bounded parser on the main thread.
        await abortImportSession(sessionId);
        throwIfBackupTerminated();
        sessionId = await beginImportSession();
        throwIfBackupTerminated();
      }
    }

    if (importSource instanceof Blob) {
      await deserializePalettesFromImportBlob(importSource, {
        collect: false,
        onBatch: stagePalettes,
      });
    } else {
      await stagePalettes(await deserializePalettesFromImport(importSource));
    }

    throwIfBackupTerminated();
    return await commitImportSession(sessionId, fallbackRenderSettings, {
      signal: backupLifetimeSignal,
    });
  } catch (error) {
    if (sessionId) {
      await abortImportSession(sessionId).catch(() => false);
    }
    throw error;
  }
}
