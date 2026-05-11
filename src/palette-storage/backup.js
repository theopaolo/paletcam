import { createPaletteJsonWorkerController } from "../modules/palette-json-worker.js";
import { readPalettePhotoBlobById } from "./assets.js";
import { db } from "./db.js";
import {
  deserializePalettesFromImport,
  serializePalettesForExportBlob,
  serializePalettesForExport,
} from "./json-transfer.js";
import {
  createPaletteAssetRecord,
  createPaletteMetadataRecord,
  normalizeStoredPaletteRecord,
} from "./records.js";

const paletteJsonWorkerController = createPaletteJsonWorkerController();
const EXPORT_OUTPUT_BLOB = "blob";
const EXPORT_OUTPUT_STRING = "string";

function getImportedPalettePhotoBlobOrThrow(palette, index) {
  if (palette?.photoBlob instanceof Blob) {
    return palette.photoBlob;
  }

  const paletteNumber = Number(index) + 1;
  throw new Error(`Cannot import palette ${paletteNumber} without photo data.`);
}

function getElapsedTimeMs(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

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

async function preparePalettesForExport({ onProgress, startedAtMs }) {
  const palettes = await db.palettes.toArray();
  const preparedPalettes = [];
  const total = palettes.length;

  notifyExportProgress(onProgress, {
    completed: 0,
    elapsedMs: 0,
    phase: "preparing",
    total,
  });

  await waitForNextPaint();

  for (let index = 0; index < palettes.length; index += 1) {
    const paletteRecord = palettes[index];
    const palette = normalizeStoredPaletteRecord(paletteRecord, { includePhotoBlob: false });
    const masterPhotoBlob = await readPalettePhotoBlobById(palette.id);
    const fallbackPhotoBlob =
      masterPhotoBlob instanceof Blob
        ? masterPhotoBlob
        : palette.previewViewerBlob instanceof Blob
          ? palette.previewViewerBlob
          : palette.previewGalleryBlob instanceof Blob
            ? palette.previewGalleryBlob
            : palette.previewBlob instanceof Blob
              ? palette.previewBlob
              : null;
    const entry = {
      ...palette,
      ...(fallbackPhotoBlob instanceof Blob ? { photoBlob: fallbackPhotoBlob } : {}),
    };
    preparedPalettes.push(entry);

    const completed = index + 1;
    notifyExportProgress(onProgress, {
      completed,
      elapsedMs: getElapsedTimeMs(startedAtMs),
      phase: "preparing",
      total,
    });

    if (shouldYieldExportProgress(completed, total)) {
      await waitForNextPaint();
    }
  }

  return {
    palettes: preparedPalettes,
    total,
  };
}

async function runSerializedPaletteExport(
  preparedPalettes,
  { onProgress, output, startedAtMs, total },
) {
  const reportProgress = createElapsedProgressReporter(onProgress, startedAtMs);
  const onSerializationProgress = createSerializationProgressReporter(onProgress, startedAtMs);

  reportProgress({
    completed: 0,
    phase: "serializing",
    total,
  });
  await waitForNextPaint();

  const workerRequest =
    output === EXPORT_OUTPUT_BLOB
      ? paletteJsonWorkerController.exportPalettesBlob(preparedPalettes, {
          onProgress: onSerializationProgress,
        })
      : paletteJsonWorkerController.exportPalettes(preparedPalettes, {
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
      return output === EXPORT_OUTPUT_BLOB ? result.blob : result.json;
    } catch (error) {
      if (paletteJsonWorkerController.isEnabled()) {
        throw error;
      }
    }
  }

  const fallbackResult =
    output === EXPORT_OUTPUT_BLOB
      ? await serializePalettesForExportBlob(preparedPalettes, {
          onProgress: onSerializationProgress,
        })
      : await serializePalettesForExport(preparedPalettes, {
          onProgress: onSerializationProgress,
        });

  reportProgress({
    completed: total,
    phase: "finalizing",
    total,
  });
  await waitForNextPaint();

  return fallbackResult;
}

async function exportPalettes({ onProgress, output = EXPORT_OUTPUT_STRING } = {}) {
  const startedAtMs = Date.now();
  const prepared = await preparePalettesForExport({ onProgress, startedAtMs });

  return runSerializedPaletteExport(prepared.palettes, {
    onProgress,
    output,
    startedAtMs,
    total: prepared.total,
  });
}

/** @returns {Promise<string>} JSON string of all palettes */
export async function exportAllPalettes({ onProgress } = {}) {
  return exportPalettes({ onProgress, output: EXPORT_OUTPUT_STRING });
}

/** @returns {Promise<Blob>} JSON Blob of all palettes */
export async function exportAllPalettesBlob({ onProgress } = {}) {
  return exportPalettes({ onProgress, output: EXPORT_OUTPUT_BLOB });
}

/**
 * @param {string} jsonString
 * @returns {Promise<number>} number of palettes imported
 */
export async function importAllPalettes(jsonString) {
  let palettes = null;
  const workerRequest = paletteJsonWorkerController.importPalettes(jsonString);

  if (workerRequest) {
    try {
      const result = await workerRequest;
      palettes = result.palettes;
    } catch (error) {
      if (paletteJsonWorkerController.isEnabled()) {
        throw error;
      }
    }
  }

  if (!palettes) {
    palettes = await deserializePalettesFromImport(jsonString);
  }

  let importedCount = 0;
  const palettesWithPhotoAssets = palettes.map((palette, index) => ({
    palette,
    importedPhotoBlob: getImportedPalettePhotoBlobOrThrow(palette, index),
  }));

  await db.transaction("rw", db.palettes, db.paletteAssets, async () => {
    for (const { palette, importedPhotoBlob } of palettesWithPhotoAssets) {
      const { photoBlob: _photoBlob, ...paletteMetadata } = palette;

      const nextPaletteMetadata = createPaletteMetadataRecord({
        timestamp: paletteMetadata.timestamp || new Date().toISOString(),
        colors: paletteMetadata.colors || [],
        captureAspectRatio: paletteMetadata.captureAspectRatio || "4:3",
        captureCropRect: paletteMetadata.captureCropRect || null,
        captureMode: paletteMetadata.captureMode,
        ralMatch: paletteMetadata.ralMatch ?? null,
        remoteCatchId: paletteMetadata.remoteCatchId ?? null,
        moderationStatus: paletteMetadata.moderationStatus ?? null,
        postedAt: paletteMetadata.postedAt ?? null,
        moderationUpdatedAt: paletteMetadata.moderationUpdatedAt ?? null,
        lastModerationCheckAt: paletteMetadata.lastModerationCheckAt ?? null,
        polaroidRenderSettings: paletteMetadata.polaroidRenderSettings ?? null,
        polaroidColorNames: paletteMetadata.polaroidColorNames ?? null,
        hasPhotoAsset: true,
      });

      const paletteId = await db.palettes.add(nextPaletteMetadata);
      await db.paletteAssets.put(createPaletteAssetRecord(paletteId, importedPhotoBlob));

      importedCount += 1;
    }
  });

  return importedCount;
}
