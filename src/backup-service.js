import {
  deleteBackupAccount,
  deleteBackupPalette,
  fetchBackupManifest,
  fetchBackupPalette,
  putBackupAsset,
  putBackupPalette,
} from "./backup-api.js";
import {
  clearBackupCredentials,
  getBackupCredentials,
  saveBackupCredentials,
} from "./backup-credentials.js";
import { pullBackupChanges } from "./backup-pull.js";
import { registerAppTermination } from "./modules/app-terminal-lifecycle.js";
import { clientLog } from "./modules/client-log.js";
import { PALETTES_SYNCED_EVENT } from "./modules/collection/collection-events.js";
import { readPalettePhotoBlobById } from "./palette-storage/assets.js";
import {
  applyRemotePaletteState,
  countBackupProgress,
  forgetBackupRemoteHashes,
  listPalettesAwaitingBackup,
  listPendingBackupTombstones,
  markPaletteBackedUp,
  resetBackupLedger,
  resolveBackupTombstones,
} from "./palette-storage/backup-ledger.js";

export const BACKUP_FLUSH_BATCH_SIZE = 10;
const MAX_BATCHES_PER_FLUSH = 50;
const MAX_CONFLICT_ATTEMPTS = 3;
const FLUSH_INTERVAL_MS = 5 * 60_000;
const STARTUP_FLUSH_DELAY_MS = 8_000;
const REQUEST_FLUSH_DEBOUNCE_MS = 5_000;

/** @type {Set<(status: BackupServiceStatus) => void>} */
const statusListeners = new Set();
/** @type {BackupServiceStatus} */
let status = {
  phase: "idle",
  paired: false,
  errorCode: null,
  progress: null,
  pullProgress: null,
  lastFlushAt: null,
};
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

/** Lets an open collection reload after another device's changes landed. */
function announceSyncedPalettes() {
  globalThis.dispatchEvent?.(new CustomEvent(PALETTES_SYNCED_EVENT));
}

async function sha256HexOfBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function createPaletteEnvelope(palette, assets) {
  // The local auto-increment id is meaningless on another device; identity
  // travels as backupUid, and restore assigns a fresh local id. The remote
  // hash is this device's bookkeeping about the server, not palette data.
  const { id: _localId, backupRemoteHash: _remoteHash, ...portablePalette } = palette;
  return { schemaVersion: 1, palette: portablePalette, assets };
}

function getChangeTimeMs(palette) {
  const changeTimeMs = Date.parse(palette?.backupDirtyAt || "");
  return Number.isFinite(changeTimeMs) ? changeTimeMs : 0;
}

async function flushTombstones(credentials) {
  const tombstones = await listPendingBackupTombstones();
  for (const tombstone of tombstones) {
    await deleteBackupPalette(credentials, tombstone.backupUid);
    await resolveBackupTombstones([tombstone.backupUid]);
  }
}

/**
 * Uploads one dirty palette with a conditional write against the server
 * version this device last saw. When another device wrote in between, the
 * newest change wins, compared on the `backupDirtyAt` stamp each envelope
 * carries: an older local change takes the server version, a newer one
 * retries against it. A palette deleted elsewhere but edited here comes back.
 * @returns {Promise<"uploaded" | "took-remote" | "gave-up">}
 */
async function pushPalette(credentials, palette, referencedAssets) {
  const envelope = createPaletteEnvelope(palette, referencedAssets);
  let baseHash = palette.backupRemoteHash ?? null;

  for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt += 1) {
    try {
      const remoteHash = await putBackupPalette(credentials, palette.backupUid, envelope, {
        baseHash,
      });
      await markPaletteBackedUp(palette.id, { dirtyAtSeen: palette.backupDirtyAt, remoteHash });
      return "uploaded";
    } catch (error) {
      if (error?.code !== "conflict") throw error;
    }

    let remote = null;
    try {
      remote = await fetchBackupPalette(credentials, palette.backupUid);
    } catch (error) {
      if (error?.code !== "not_found") throw error;
    }
    if (!remote?.envelope?.palette) {
      baseHash = null;
      continue;
    }
    if (getChangeTimeMs(remote.envelope.palette) > getChangeTimeMs(palette)) {
      await applyRemotePaletteState(palette.id, {
        expectedDirtyAt: palette.backupDirtyAt,
        remotePalette: remote.envelope.palette,
        remoteHash: remote.hash,
      });
      return "took-remote";
    }
    baseHash = remote.hash;
  }

  // Another device keeps writing the same palette. It stays dirty, and the
  // next pass tries again.
  return "gave-up";
}

async function flushDirtyPalettes(credentials, uploadedAssets) {
  let tookRemote = false;
  for (let batch = 0; batch < MAX_BATCHES_PER_FLUSH; batch += 1) {
    const palettes = await listPalettesAwaitingBackup(BACKUP_FLUSH_BATCH_SIZE);
    if (palettes.length === 0) {
      return tookRemote;
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

      const outcome = await pushPalette(credentials, palette, referencedAssets);
      if (outcome === "gave-up") {
        continue;
      }
      tookRemote ||= outcome === "took-remote";
      progressed = true;
      notifyStatus({ progress: await countBackupProgress() });
    }

    // A batch that only contained skippable rows would loop forever; bail and
    // let the next scheduled flush retry after the ledger changes.
    if (!progressed) {
      return tookRemote;
    }
  }
  return tookRemote;
}

/**
 * One sync pass: read the manifest, apply what other devices changed, then
 * upload pending deletes and dirty palettes until the ledger is clean.
 * Single-flight: concurrent calls share the running pass. Every object is
 * independent, so an interrupted pass resumes exactly where it stopped.
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
    let localDataChanged = false;
    try {
      const manifest = await fetchBackupManifest(credentials);
      const pulled = await pullBackupChanges(credentials, manifest, {
        onProgress: (pullProgress) => notifyStatus({ pullProgress }),
      });
      localDataChanged = pulled.imported + pulled.updated + pulled.rekeyed + pulled.deleted > 0;
      notifyStatus({ pullProgress: null, progress: await countBackupProgress() });

      const uploadedAssets = new Set(manifest.assets);
      await flushTombstones(credentials);
      localDataChanged =
        (await flushDirtyPalettes(credentials, uploadedAssets)) || localDataChanged;
      notifyStatus({
        phase: "idle",
        errorCode: null,
        progress: await countBackupProgress(),
        lastFlushAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorCode = typeof error?.code === "string" ? error.code : "unknown";
      clientLog("backup:flush-failed", { errorCode });
      notifyStatus({
        phase: "idle",
        errorCode,
        pullProgress: null,
        progress: await countBackupProgress(),
      });
    } finally {
      if (localDataChanged) {
        announceSyncedPalettes();
      }
    }
    return status;
  })().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

/**
 * Validates a recovery code against the server before storing it, so a typo
 * can never silently replace working credentials. Every known server version
 * is then forgotten: the ledger cannot tell which account it came from. The
 * first sync pass downloads what the account holds and uploads what it lacks.
 * Photos the server already holds are skipped by hash.
 * @param {BackupCredentials} credentials
 */
export async function connectBackupAccount(credentials) {
  await fetchBackupManifest(credentials);
  await forgetBackupRemoteHashes();
  saveBackupCredentials(credentials);
  notifyStatus({ paired: true, errorCode: null });
  void runBackupFlush();
}

/**
 * Deletes the backup account on the server, then forgets it on this device.
 * Nothing local changes until the server confirms, so a failed request leaves
 * the app as it was. The ledger resets before the credentials go: if the reset
 * fails, the app still shows a paired backup instead of trusting server
 * versions that no longer exist.
 */
export async function removeBackupAccount() {
  const credentials = getBackupCredentials();
  if (!credentials) {
    return;
  }
  await deleteBackupAccount(credentials);
  await resetBackupLedger();
  clearBackupCredentials();
  notifyStatus({
    phase: "idle",
    paired: false,
    errorCode: null,
    progress: await countBackupProgress(),
  });
}

let debouncedFlushTimer = null;

/** Debounced trigger for after-mutation nudges and the manual sync button. */
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
