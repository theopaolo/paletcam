import {
  deleteBackupPalette,
  fetchBackupAsset,
  fetchBackupManifest,
  fetchBackupPalette,
} from "./backup-api.js";
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

function getEnvelopeContentKey(envelope) {
  const assetHash = Array.isArray(envelope.assets) ? envelope.assets[0] || "" : "";
  return `${assetHash}|${envelope?.palette?.timestamp || ""}`;
}

function scoreEnvelope(envelope) {
  const palette = envelope?.palette ?? {};
  return (palette.favoritedAt ? 1 : 0) + (palette.remoteCatchId ? 1 : 0);
}

/**
 * Re-importing the same export file mints fresh backup uids, so the server can
 * hold several copies of one capture (same photo hash + same capture
 * timestamp). Restore keeps one winner per content key — the copy carrying
 * favourite/publication state, older upload as tiebreak — and reports the
 * losers so they can be tombstoned server-side.
 */
export function deduplicateEnvelopes(entries, manifestPalettes) {
  const winnersByKey = new Map();
  const duplicateUids = [];

  const getUploadedAtMs = (uid) => {
    const uploadedAtMs = Date.parse(manifestPalettes?.[uid]?.updatedAt || "");
    return Number.isFinite(uploadedAtMs) ? uploadedAtMs : Number.MAX_SAFE_INTEGER;
  };

  for (const entry of entries) {
    const key = getEnvelopeContentKey(entry.envelope);
    const currentWinner = winnersByKey.get(key);
    if (!currentWinner) {
      winnersByKey.set(key, entry);
      continue;
    }

    const challengerScore = scoreEnvelope(entry.envelope);
    const winnerScore = scoreEnvelope(currentWinner.envelope);
    const challengerWins =
      challengerScore > winnerScore ||
      (challengerScore === winnerScore &&
        getUploadedAtMs(entry.uid) < getUploadedAtMs(currentWinner.uid));

    if (challengerWins) {
      duplicateUids.push(currentWinner.uid);
      winnersByKey.set(key, entry);
    } else {
      duplicateUids.push(entry.uid);
    }
  }

  return { uniqueEntries: [...winnersByKey.values()], duplicateUids };
}

/**
 * Downloads the full server collection and lands it through the staged,
 * transactional import path. Palettes whose backupUid already exists locally
 * are skipped, so restore is idempotent and safe to re-run after an
 * interruption. Restored records keep their server identity and are marked
 * clean so the flush loop never re-uploads them.
 *
 * @param {{onProgress?: (progress: {phase: "preparing" | "downloading", fetched: number, total: number}) => void}} [options]
 * @returns {Promise<{restored: number, skipped: number, missingPhoto: number, deduplicated: number}>}
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
    if (uidsToRestore.length === 0) {
      return { restored: 0, skipped: existingUids.size, missingPhoto: 0, deduplicated: 0 };
    }

    // Metadata documents are ~1KB each; fetching them all first lets the
    // collection land in capture order, so restored local ids stay roughly
    // chronological.
    const fetchedEnvelopes = [];
    for (const [index, uid] of uidsToRestore.entries()) {
      const envelope = await fetchBackupPalette(credentials, uid);
      if (envelope?.palette && typeof envelope.palette === "object") {
        fetchedEnvelopes.push({ uid, envelope });
      }
      onProgress?.({ phase: "preparing", fetched: index + 1, total: uidsToRestore.length });
    }

    const { uniqueEntries: envelopes, duplicateUids } = deduplicateEnvelopes(
      fetchedEnvelopes,
      manifest.palettes,
    );
    envelopes.sort(
      (left, right) =>
        getEnvelopeTimestampMs(left.envelope) - getEnvelopeTimestampMs(right.envelope),
    );
    const total = envelopes.length;

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
      onProgress?.({ phase: "downloading", fetched, total });
      if (batch.length >= PALETTE_IMPORT_STAGING_BATCH_SIZE) {
        await flushBatch();
      }
    }

    await flushBatch();
    let restored = 0;
    if (restoredUids.length === 0) {
      await abortImportSession(sessionId);
      sessionId = null;
    } else {
      const fallbackRenderSettings = { footerLabel: getAppSettings().polaroidFooterLabel };
      restored = await commitImportSession(sessionId, fallbackRenderSettings);
      sessionId = null;
      await markPalettesRestoredClean(restoredUids);
    }

    // The losing duplicates become server tombstones only after the winners
    // landed locally, so an interrupted restore never discards server data.
    for (const duplicateUid of duplicateUids) {
      await deleteBackupPalette(credentials, duplicateUid);
    }

    return {
      restored,
      skipped: existingUids.size,
      missingPhoto,
      deduplicated: duplicateUids.length,
    };
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
