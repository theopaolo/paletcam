import { fetchBackupAsset, fetchBackupManifest, fetchBackupPalette } from "./backup-api.js";
import { getBackupCredentials } from "./backup-credentials.js";
import { getAppSettings } from "./app-settings.js";
import { clientLog } from "./modules/client-log.js";
import { beginCriticalOperation } from "./modules/critical-operation.js";
import {
  listExistingBackupUids,
  markPalettesRestoredClean,
} from "./palette-storage/backup-ledger.js";
import {
  abortImportSession,
  beginImportSession,
  commitImportSession,
  PALETTE_IMPORT_STAGING_BATCH_SIZE,
  stageImportBatch,
} from "./palette-storage/import-staging.js";

export class BackupRestoreError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "BackupRestoreError";
    this.code = code;
  }
}

function getEnvelopeTimestampMs(envelope) {
  const timestampMs = Date.parse(envelope?.palette?.timestamp || "");
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

/**
 * Downloads the full server collection and lands it through the staged,
 * transactional import path. Palettes whose backupUid already exists locally
 * are skipped, so restore is idempotent and safe to re-run after an
 * interruption. Restored records keep their server identity and are marked
 * clean so the flush loop never re-uploads them.
 *
 * @param {{onProgress?: (progress: {fetched: number, total: number}) => void}} [options]
 * @returns {Promise<{restored: number, skipped: number, missingPhoto: number}>}
 */
export async function runBackupRestore({ onProgress } = {}) {
  const credentials = getBackupCredentials();
  if (!credentials) {
    throw new BackupRestoreError("No backup credentials are connected.", "unpaired");
  }

  const releaseCriticalOperation = beginCriticalOperation("backup-restore");
  let sessionId = null;
  try {
    const manifest = await fetchBackupManifest(credentials);
    const remoteUids = Object.keys(manifest.palettes);
    const existingUids = await listExistingBackupUids(remoteUids);
    const uidsToRestore = remoteUids.filter((uid) => !existingUids.has(uid));
    const total = uidsToRestore.length;
    if (total === 0) {
      return { restored: 0, skipped: existingUids.size, missingPhoto: 0 };
    }

    // Metadata documents are ~1KB each; fetching them all first lets the
    // collection land in capture order, so restored local ids stay roughly
    // chronological.
    const envelopes = [];
    for (const uid of uidsToRestore) {
      const envelope = await fetchBackupPalette(credentials, uid);
      if (envelope?.palette && typeof envelope.palette === "object") {
        envelopes.push({ uid, envelope });
      }
    }
    envelopes.sort(
      (left, right) =>
        getEnvelopeTimestampMs(left.envelope) - getEnvelopeTimestampMs(right.envelope),
    );

    sessionId = await beginImportSession();
    let fetched = 0;
    let missingPhoto = 0;
    let batch = [];
    const restoredUids = [];

    const flushBatch = async () => {
      if (batch.length > 0) {
        await stageImportBatch(sessionId, batch);
        batch = [];
      }
    };

    for (const { uid, envelope } of envelopes) {
      const assetHash = Array.isArray(envelope.assets) ? envelope.assets[0] : undefined;
      if (!assetHash) {
        missingPhoto += 1;
        continue;
      }

      const photoBlob = await fetchBackupAsset(credentials, assetHash);
      batch.push({ ...envelope.palette, backupUid: uid, photoBlob });
      restoredUids.push(uid);
      fetched += 1;
      onProgress?.({ fetched, total });
      if (batch.length >= PALETTE_IMPORT_STAGING_BATCH_SIZE) {
        await flushBatch();
      }
    }

    await flushBatch();
    if (restoredUids.length === 0) {
      await abortImportSession(sessionId);
      sessionId = null;
      return { restored: 0, skipped: existingUids.size, missingPhoto };
    }

    const fallbackRenderSettings = { footerLabel: getAppSettings().polaroidFooterLabel };
    const restored = await commitImportSession(sessionId, fallbackRenderSettings);
    sessionId = null;
    await markPalettesRestoredClean(restoredUids);

    return { restored, skipped: existingUids.size, missingPhoto };
  } catch (error) {
    if (sessionId) {
      await abortImportSession(sessionId).catch(() => {});
    }
    if (error instanceof BackupRestoreError) {
      clientLog("backup:restore-failed", { errorCode: error.code });
      throw error;
    }
    const code = typeof (/** @type {any} */ (error)?.code) === "string" ? error.code : "unknown";
    clientLog("backup:restore-failed", { errorCode: code, errorName: error?.name });
    throw new BackupRestoreError("The backup restore failed.", code);
  } finally {
    releaseCriticalOperation();
  }
}
