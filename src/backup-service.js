import {
  deleteBackupPalette,
  fetchBackupManifest,
  putBackupAsset,
  putBackupPalette,
} from "./backup-api.js";
import { getBackupCredentials, saveBackupCredentials } from "./backup-credentials.js";
import { registerAppTermination } from "./modules/app-terminal-lifecycle.js";
import { clientLog } from "./modules/client-log.js";
import { readPalettePhotoBlobById } from "./palette-storage/assets.js";
import {
  countBackupProgress,
  listPalettesAwaitingBackup,
  listPendingBackupTombstones,
  markPaletteBackedUp,
  resolveBackupTombstones,
} from "./palette-storage/backup-ledger.js";

export const BACKUP_FLUSH_BATCH_SIZE = 10;
const MAX_BATCHES_PER_FLUSH = 50;
const FLUSH_INTERVAL_MS = 5 * 60_000;
const STARTUP_FLUSH_DELAY_MS = 8_000;
const REQUEST_FLUSH_DEBOUNCE_MS = 5_000;

/** @type {Set<(status: BackupServiceStatus) => void>} */
const statusListeners = new Set();
/** @type {BackupServiceStatus} */
let status = { phase: "idle", paired: false, errorCode: null, progress: null, lastFlushAt: null };
/** @type {Promise<BackupServiceStatus> | null} */
let activeFlush = null;

function notifyStatus(patch) {
  status = { ...status, ...patch };
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (error) {
      console.error("Backup status listener failed:", error);
    }
  }
}

export function getBackupStatusSnapshot() {
  return status;
}

/** @param {(status: BackupServiceStatus) => void} listener */
export function subscribeBackupStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

async function sha256HexOfBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function createPaletteEnvelope(palette, assets) {
  // The local auto-increment id is meaningless on another device; identity
  // travels as backupUid, and restore assigns a fresh local id.
  const { id: _localId, ...portablePalette } = palette;
  return { schemaVersion: 1, palette: portablePalette, assets };
}

async function flushTombstones(credentials) {
  const tombstones = await listPendingBackupTombstones();
  for (const tombstone of tombstones) {
    await deleteBackupPalette(credentials, tombstone.backupUid);
    await resolveBackupTombstones([tombstone.backupUid]);
  }
}

async function flushDirtyPalettes(credentials, uploadedAssets) {
  for (let batch = 0; batch < MAX_BATCHES_PER_FLUSH; batch += 1) {
    const palettes = await listPalettesAwaitingBackup(BACKUP_FLUSH_BATCH_SIZE);
    if (palettes.length === 0) {
      return;
    }

    let progressed = false;
    for (const palette of palettes) {
      if (!palette.backupUid || !palette.backupDirtyAt) {
        continue;
      }

      let referencedAssets = [];
      if (palette.hasPhotoAsset) {
        const photoBlob = await readPalettePhotoBlobById(palette.id);
        if (photoBlob instanceof Blob) {
          const assetHash = await sha256HexOfBlob(photoBlob);
          if (!uploadedAssets.has(assetHash)) {
            await putBackupAsset(credentials, assetHash, photoBlob);
            uploadedAssets.add(assetHash);
          }
          referencedAssets = [assetHash];
        }
      }

      await putBackupPalette(
        credentials,
        palette.backupUid,
        createPaletteEnvelope(palette, referencedAssets),
      );
      await markPaletteBackedUp(palette.id, { dirtyAtSeen: palette.backupDirtyAt });
      progressed = true;
      notifyStatus({ progress: await countBackupProgress() });
    }

    // A batch that only contained skippable rows would loop forever; bail and
    // let the next scheduled flush retry after the ledger changes.
    if (!progressed) {
      return;
    }
  }
}

/**
 * Uploads pending tombstones and dirty palettes until the ledger is clean.
 * Single-flight: concurrent calls share the running flush. Every object is
 * independent, so an interrupted flush resumes exactly where it stopped.
 */
export function runBackupFlush() {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = (async () => {
    const credentials = getBackupCredentials();
    if (!credentials) {
      notifyStatus({ phase: "idle", paired: false, errorCode: null });
      return status;
    }

    notifyStatus({ phase: "flushing", paired: true, errorCode: null });
    try {
      const manifest = await fetchBackupManifest(credentials);
      const uploadedAssets = new Set(manifest.assets);
      await flushTombstones(credentials);
      await flushDirtyPalettes(credentials, uploadedAssets);
      notifyStatus({
        phase: "idle",
        errorCode: null,
        progress: await countBackupProgress(),
        lastFlushAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorCode = typeof error?.code === "string" ? error.code : "unknown";
      clientLog("backup:flush-failed", { errorCode });
      notifyStatus({ phase: "idle", errorCode, progress: await countBackupProgress() });
    }
    return status;
  })().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

/**
 * Validates a recovery code against the server before storing it, so a typo
 * can never silently replace working credentials.
 * @param {BackupCredentials} credentials
 */
export async function connectBackupAccount(credentials) {
  await fetchBackupManifest(credentials);
  saveBackupCredentials(credentials);
  notifyStatus({ paired: true, errorCode: null });
  void runBackupFlush();
}

let debouncedFlushTimer = null;

/** Debounced trigger for after-mutation nudges and the manual backup button. */
export function requestBackupFlush({ immediate = false } = {}) {
  if (immediate) {
    clearTimeout(debouncedFlushTimer);
    debouncedFlushTimer = null;
    return runBackupFlush();
  }

  clearTimeout(debouncedFlushTimer);
  debouncedFlushTimer = setTimeout(() => {
    debouncedFlushTimer = null;
    void runBackupFlush();
  }, REQUEST_FLUSH_DEBOUNCE_MS);
  return null;
}

export function initializeBackupService() {
  notifyStatus({ paired: getBackupCredentials() !== null });
  void countBackupProgress().then(
    (progress) => notifyStatus({ progress }),
    () => {},
  );

  const startupTimer = setTimeout(() => void runBackupFlush(), STARTUP_FLUSH_DELAY_MS);
  const intervalTimer = setInterval(() => void runBackupFlush(), FLUSH_INTERVAL_MS);

  const cleanup = () => {
    clearTimeout(startupTimer);
    clearInterval(intervalTimer);
    clearTimeout(debouncedFlushTimer);
    debouncedFlushTimer = null;
  };
  registerAppTermination(cleanup);
  return cleanup;
}
