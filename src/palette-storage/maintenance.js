import { clientLog } from "../modules/client-log.js";
import { reportAppError } from "../modules/error-reporting.js";
import { recordIndexedDbFailure } from "../modules/operational-metrics.js";
import { db } from "./db.js";
import { cleanupStaleImportSessions } from "./import-staging.js";
import { normalizePolaroidRenderSettings } from "./records.js";

let activeMaintenancePromise = null;
const LEGACY_RENDER_SETTINGS_MARKER_KEY = "legacy-polaroid-render-settings:v1";
const LEGACY_RENDER_SETTINGS_MARKER_VERSION = 1;

function getCompletedMaintenanceVersion(marker) {
  return typeof marker?.version === "number" &&
    Number.isSafeInteger(marker.version) &&
    marker.version >= 0
    ? marker.version
    : -1;
}

/**
 * Deletes only photo assets that cannot be reached from any palette record.
 * Palette metadata is authoritative; no age, quota, MIME, or denormalized
 * `hasPhotoAsset` heuristic is allowed to delete a user's master photo.
 * Primary keys are read instead of full records so Blob payloads are not
 * materialized during explicit repair.
 *
 * @returns {Promise<{deletedCount: number, deletedPreviewCount: number}>}
 */
export async function pruneOrphanPaletteAssets() {
  let deletedCount = 0;
  let deletedPreviewCount = 0;
  const previewTable = db.palettePreviews ?? null;
  const transactionTables = /** @type {PaletcamDexieTable<any, any>[]} */ ([
    db.palettes,
    db.paletteAssets,
  ]);
  if (previewTable) {
    transactionTables.push(previewTable);
  }

  await db.transaction("rw", ...transactionTables, async () => {
    const paletteKeys = await db.palettes.toCollection().primaryKeys();
    const paletteKeySet = new Set(paletteKeys.map(String));
    const assetKeys = await db.paletteAssets.toCollection().primaryKeys();

    for (const assetKey of assetKeys) {
      if (paletteKeySet.has(String(assetKey))) {
        continue;
      }
      await db.paletteAssets.delete(Number(assetKey));
      deletedCount += 1;
    }

    if (previewTable) {
      const previewKeys = await previewTable.toCollection().primaryKeys();
      for (const previewKey of previewKeys) {
        const previewPaletteId = Array.isArray(previewKey) ? previewKey[0] : previewKey;
        if (paletteKeySet.has(String(previewPaletteId))) {
          continue;
        }
        await previewTable.delete(previewKey);
        deletedPreviewCount += 1;
      }
    }
  });
  return { deletedCount, deletedPreviewCount };
}

/**
 * Runs the legacy render-settings backfill once per database. The completion
 * marker is checked and written in the same transaction as the metadata scan,
 * so an interrupted attempt remains absent and retryable.
 *
 * @param {{polaroidRenderSettings?: PolaroidRenderSettings | null}} [options]
 * @returns {Promise<{updatedCount: number}>}
 */
export function initializePaletteStorage({ polaroidRenderSettings = null } = {}) {
  if (activeMaintenancePromise) {
    return activeMaintenancePromise;
  }

  const normalizedSettings = normalizePolaroidRenderSettings(polaroidRenderSettings);
  if (!normalizedSettings) {
    return Promise.resolve({ updatedCount: 0 });
  }

  const startedAt = performance.now();
  activeMaintenancePromise = (async () => {
    await cleanupStaleImportSessions();

    let updatedCount = 0;
    let markerSatisfied = false;
    await db.transaction("rw", db.palettes, db.paletteStorageMetadata, async () => {
      const marker = await db.paletteStorageMetadata.get(LEGACY_RENDER_SETTINGS_MARKER_KEY);
      if (getCompletedMaintenanceVersion(marker) >= LEGACY_RENDER_SETTINGS_MARKER_VERSION) {
        markerSatisfied = true;
        return;
      }

      await db.palettes.toCollection().modify((palette) => {
        if (normalizePolaroidRenderSettings(palette?.polaroidRenderSettings)) {
          return;
        }
        palette.polaroidRenderSettings = normalizedSettings;
        updatedCount += 1;
      });

      await db.paletteStorageMetadata.put({
        key: LEGACY_RENDER_SETTINGS_MARKER_KEY,
        version: LEGACY_RENDER_SETTINGS_MARKER_VERSION,
        completedAt: new Date().toISOString(),
      });
    });
    clientLog("paletteStorageMaintenance:success", {
      updatedCount,
      markerSatisfied,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { updatedCount };
  })().catch((error) => {
    activeMaintenancePromise = null;
    recordIndexedDbFailure("maintenance", error);
    reportAppError(error, {
      logMessage: "paletteStorageMaintenance:error",
      consoleMessage: "Palette storage maintenance failed:",
      clientLogKey: "paletteStorageMaintenance:error",
    });
    throw error;
  });

  return activeMaintenancePromise;
}

export function resetPaletteStorageMaintenanceForTests() {
  activeMaintenancePromise = null;
}
