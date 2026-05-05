import { createPaletteJsonWorkerController } from '../modules/palette-json-worker.js';
import { readPalettePhotoBlobById } from './assets.js';
import { db } from './db.js';
import {
  deserializePalettesFromImport,
  serializePalettesForExport,
} from './json-transfer.js';
import {
  createPaletteAssetRecord,
  createPaletteMetadataRecord,
  normalizeStoredPaletteRecord,
} from './records.js';

const paletteJsonWorkerController = createPaletteJsonWorkerController();

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
  if (typeof onProgress === 'function') {
    onProgress(progress);
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
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

/** @returns {Promise<string>} JSON string of all palettes */
export async function exportAllPalettes({ onProgress } = {}) {
  const palettes = await db.palettes.toArray();
  const preparedPalettes = [];
  const startedAtMs = Date.now();
  const total = palettes.length;

  notifyExportProgress(onProgress, {
    completed: 0,
    elapsedMs: 0,
    phase: 'preparing',
    total,
  });

  await waitForNextPaint();

  for (let index = 0; index < palettes.length; index += 1) {
    const paletteRecord = palettes[index];
    const palette = normalizeStoredPaletteRecord(paletteRecord, { includePhotoBlob: false });
    const masterPhotoBlob = await readPalettePhotoBlobById(palette.id);
    const fallbackPhotoBlob = masterPhotoBlob instanceof Blob
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
      ...(fallbackPhotoBlob instanceof Blob
        ? { photoBlob: fallbackPhotoBlob }
        : {}),
    };
    preparedPalettes.push(entry);

    const completed = index + 1;
    notifyExportProgress(onProgress, {
      completed,
      elapsedMs: getElapsedTimeMs(startedAtMs),
      phase: 'serializing',
      total,
    });

    if (shouldYieldExportProgress(completed, total)) {
      await waitForNextPaint();
    }
  }

  notifyExportProgress(onProgress, {
    completed: total,
    elapsedMs: getElapsedTimeMs(startedAtMs),
    phase: 'finalizing',
    total,
  });
  await waitForNextPaint();

  const workerRequest = paletteJsonWorkerController.exportPalettes(preparedPalettes);

  if (workerRequest) {
    try {
      const result = await workerRequest;
      return result.json;
    } catch (error) {
      if (paletteJsonWorkerController.isEnabled()) {
        throw error;
      }
    }
  }

  return serializePalettesForExport(preparedPalettes);
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

  await db.transaction('rw', db.palettes, db.paletteAssets, async () => {
    for (const { palette, importedPhotoBlob } of palettesWithPhotoAssets) {
      const { photoBlob: _photoBlob, ...paletteMetadata } = palette;

      const nextPaletteMetadata = createPaletteMetadataRecord({
        timestamp: paletteMetadata.timestamp || new Date().toISOString(),
        colors: paletteMetadata.colors || [],
        captureAspectRatio: paletteMetadata.captureAspectRatio || '4:3',
        captureCropRect: paletteMetadata.captureCropRect || null,
        captureMode: paletteMetadata.captureMode,
        ralMatch: paletteMetadata.ralMatch ?? null,
        remoteCatchId: paletteMetadata.remoteCatchId ?? null,
        moderationStatus: paletteMetadata.moderationStatus ?? null,
        postedAt: paletteMetadata.postedAt ?? null,
        moderationUpdatedAt: paletteMetadata.moderationUpdatedAt ?? null,
        lastModerationCheckAt: paletteMetadata.lastModerationCheckAt ?? null,
        hasPhotoAsset: true,
      });

      const paletteId = await db.palettes.add(nextPaletteMetadata);
      await db.paletteAssets.put(createPaletteAssetRecord(paletteId, importedPhotoBlob));

      importedCount += 1;
    }
  });

  return importedCount;
}
