import { deleteBackupPalette, fetchBackupAsset, fetchBackupPalette } from "./backup-api.js";
import { getAppSettings } from "./app-settings.js";
import { clientLog } from "./modules/client-log.js";
import { beginCriticalOperation } from "./modules/critical-operation.js";
import {
  applyRemotePaletteState,
  deletePalettesForRemoteTombstones,
  listAllPendingBackupTombstoneUids,
  listBackupSyncIndex,
  markPalettesForBackup,
  markPalettesPulled,
  rekeyPaletteBackupUid,
} from "./palette-storage/backup-ledger.js";
import {
  abortImportSession,
  beginImportSession,
  commitImportSession,
  PALETTE_IMPORT_STAGING_BATCH_SIZE,
  PaletteImportConflictError,
  stageImportBatch,
} from "./palette-storage/import-staging.js";
import { pickSyncedPaletteFields } from "./palette-storage/records.js";

// A server bug or a rollback must not empty the phone. Above this count, a
// pass that would delete more than half the collection deletes nothing.
// ponytail: blunt ratio guard. Add a confirm prompt if it blocks a real mass delete.
export const REMOTE_DELETE_GUARD_MIN = 10;

/**
 * Two copies of one capture (one file imported on two devices) share the
 * capture timestamp and the colors. Their uids differ.
 */
export function getPaletteContentKey(palette) {
  const colors = Array.isArray(palette?.colors) ? palette.colors : [];
  return `${palette?.timestamp || ""}|${colors.map((color) => `${color?.r},${color?.g},${color?.b}`).join(";")}`;
}

function scorePaletteState(palette) {
  return (palette?.favoritedAt ? 1 : 0) + (palette?.remoteCatchId ? 1 : 0);
}

function syncedFieldsDiffer(left, right) {
  return (
    JSON.stringify(pickSyncedPaletteFields(left)) !== JSON.stringify(pickSyncedPaletteFields(right))
  );
}

function compareUids(left, right) {
  return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0;
}

/**
 * Picks one survivor among copies of the same capture. The lowest uid wins on
 * every device, so devices that dedupe at the same time never delete each
 * other's survivor. The state (favourite, publication) comes from the most
 * complete copy, so the uid order never drops a star.
 * @template {{uid: string, palette: object}} Member
 * @param {Member[]} members
 */
export function chooseDuplicateWinner(members) {
  const sorted = [...members].sort(compareUids);
  const winner = sorted[0];
  const stateSource = sorted.reduce(
    (best, member) =>
      scorePaletteState(member.palette) > scorePaletteState(best.palette) ? member : best,
    winner,
  );
  return { winner, losers: sorted.slice(1), fields: pickSyncedPaletteFields(stateSource.palette) };
}

async function fetchRemotePaletteOrNull(credentials, backupUid) {
  try {
    const remote = await fetchBackupPalette(credentials, backupUid);
    const palette = remote?.envelope?.palette;
    return palette && typeof palette === "object" && !Array.isArray(palette) ? remote : null;
  } catch (error) {
    // Deleted between the manifest read and this request.
    if (error?.code === "not_found") return null;
    throw error;
  }
}

function getTimestampMs(palette) {
  const timestampMs = Date.parse(palette?.timestamp || "");
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

/**
 * Downloads and commits new palettes in chunks. Each chunk is its own
 * transactional import, so an interrupted pass keeps what already landed.
 */
async function importRemotePalettes(credentials, items, result, onProgress) {
  const fallbackRenderSettings = { footerLabel: getAppSettings().polaroidFooterLabel };
  let downloaded = 0;

  for (let start = 0; start < items.length; start += PALETTE_IMPORT_STAGING_BATCH_SIZE) {
    const chunk = [];
    for (const item of items.slice(start, start + PALETTE_IMPORT_STAGING_BATCH_SIZE)) {
      const assetHash = Array.isArray(item.envelope.assets) ? item.envelope.assets[0] : undefined;
      downloaded += 1;
      if (!assetHash) {
        result.missingPhoto += 1;
        continue;
      }
      const photoBlob = await fetchBackupAsset(credentials, assetHash);
      chunk.push({ item, photoBlob });
      onProgress?.({ phase: "downloading", fetched: downloaded, total: items.length });
    }
    if (chunk.length === 0) {
      continue;
    }

    let sessionId;
    try {
      sessionId = await beginImportSession();
    } catch (error) {
      // A file import is running. The next pass picks these palettes up.
      if (error instanceof PaletteImportConflictError) return;
      throw error;
    }
    try {
      await stageImportBatch(
        sessionId,
        chunk.map(({ item, photoBlob }) => ({
          ...item.envelope.palette,
          ...item.fields,
          backupUid: item.uid,
          photoBlob,
        })),
      );
      result.imported += await commitImportSession(sessionId, fallbackRenderSettings);
    } catch (error) {
      await abortImportSession(sessionId).catch(() => {});
      throw error;
    }

    await markPalettesPulled(
      chunk.map(({ item }) => ({ backupUid: item.uid, remoteHash: item.hash, clean: !item.dirty })),
    );
    // The losing copies leave the server only once the survivor is on the phone.
    for (const { item } of chunk) {
      for (const loserUid of item.loserUids) {
        await deleteBackupPalette(credentials, loserUid);
      }
    }
  }
}

/**
 * Brings this device up to date with the server before it uploads:
 * 1. palettes another device changed get the new favourite and publication state,
 * 2. palettes this device has never seen are downloaded (copies of a capture
 *    it already holds are merged by content instead),
 * 3. palettes another device deleted are deleted here, if untouched,
 * 4. clean palettes the server lacks are queued for upload.
 *
 * Dirty palettes are left to the upload, which resolves them against the
 * server version with a conditional write.
 *
 * @param {BackupCredentials} credentials
 * @param {{palettes?: Record<string, {hash: string}>, tombstones?: Record<string, object>}} manifest
 * @param {{onProgress?: (progress: {phase: "preparing" | "downloading", fetched: number, total: number}) => void}} [options]
 */
export async function pullBackupChanges(credentials, manifest, { onProgress } = {}) {
  const result = {
    imported: 0,
    updated: 0,
    rekeyed: 0,
    deleted: 0,
    deduplicated: 0,
    missingPhoto: 0,
  };
  const remotePalettes = manifest?.palettes ?? {};
  const remoteTombstones = manifest?.tombstones ?? {};
  const pendingTombstoneUids = new Set(await listAllPendingBackupTombstoneUids());
  const localPalettes = await listBackupSyncIndex();
  const localByUid = new Map(localPalettes.map((palette) => [palette.backupUid, palette]));

  const changedPalettes = localPalettes.filter(
    (palette) =>
      !palette.backupDirtyAt &&
      remotePalettes[palette.backupUid] &&
      remotePalettes[palette.backupUid].hash !== palette.backupRemoteHash,
  );
  const newUids = Object.keys(remotePalettes).filter(
    (uid) => !localByUid.has(uid) && !pendingTombstoneUids.has(uid),
  );
  const metadataTotal = changedPalettes.length + newUids.length;
  let metadataFetched = 0;
  const reportMetadataFetched = () => {
    metadataFetched += 1;
    onProgress?.({ phase: "preparing", fetched: metadataFetched, total: metadataTotal });
  };

  for (const palette of changedPalettes) {
    const remote = await fetchRemotePaletteOrNull(credentials, palette.backupUid);
    reportMetadataFetched();
    if (!remote) continue;
    const applied = await applyRemotePaletteState(palette.id, {
      expectedDirtyAt: null,
      remotePalette: remote.envelope.palette,
      remoteHash: remote.hash,
    });
    if (applied && syncedFieldsDiffer(palette, remote.envelope.palette)) {
      result.updated += 1;
    }
  }

  /** @type {Map<string, Array<{uid: string, hash: string | null, envelope: any}>>} */
  const newByContentKey = new Map();
  for (const uid of newUids) {
    const remote = await fetchRemotePaletteOrNull(credentials, uid);
    reportMetadataFetched();
    if (!remote) continue;
    const key = getPaletteContentKey(remote.envelope.palette);
    const group = newByContentKey.get(key) ?? [];
    group.push({ uid, hash: remote.hash, envelope: remote.envelope });
    newByContentKey.set(key, group);
  }

  /** @type {Map<string, Palette[]>} */
  const localByContentKey = new Map();
  for (const palette of localPalettes) {
    const key = getPaletteContentKey(palette);
    const group = localByContentKey.get(key) ?? [];
    group.push(palette);
    localByContentKey.set(key, group);
  }

  const toImport = [];
  const loserUidsToDelete = [];
  for (const [key, remoteEntries] of newByContentKey) {
    const localMembers = [...(localByContentKey.get(key) ?? [])].sort((left, right) =>
      left.backupUid < right.backupUid ? -1 : 1,
    );
    const members = [
      ...remoteEntries.map((entry) => ({
        uid: entry.uid,
        palette: entry.envelope.palette,
        entry,
        local: null,
      })),
      ...localMembers.map((palette) => ({
        uid: palette.backupUid,
        palette,
        entry: null,
        local: palette,
      })),
    ];
    const { winner, losers, fields } = chooseDuplicateWinner(members);
    const remoteLoserUids = losers.filter((member) => member.entry).map((member) => member.uid);
    result.deduplicated += remoteLoserUids.length;

    if (winner.local) {
      // This device holds the survivor. The remote copies go once the
      // survivor is on the server too, otherwise next pass.
      if (remotePalettes[winner.uid]) {
        loserUidsToDelete.push(...remoteLoserUids);
      }
      continue;
    }

    const dirty = syncedFieldsDiffer(fields, winner.entry.envelope.palette);
    if (localMembers.length > 0) {
      const rekeyed = await rekeyPaletteBackupUid(localMembers[0].id, {
        fromUid: localMembers[0].backupUid,
        toUid: winner.uid,
        fields,
        remoteHash: winner.entry.hash,
        dirty,
      });
      if (rekeyed) {
        result.rekeyed += 1;
        loserUidsToDelete.push(...remoteLoserUids);
      }
      continue;
    }

    toImport.push({ ...winner.entry, fields, dirty, loserUids: remoteLoserUids });
  }

  for (const loserUid of loserUidsToDelete) {
    await deleteBackupPalette(credentials, loserUid);
  }

  if (toImport.length > 0) {
    // Local ids then follow capture order.
    toImport.sort(
      (left, right) =>
        getTimestampMs(left.envelope.palette) - getTimestampMs(right.envelope.palette),
    );
    const releaseCriticalOperation = beginCriticalOperation("backup-restore");
    try {
      await importRemotePalettes(credentials, toImport, result, onProgress);
    } finally {
      releaseCriticalOperation();
    }
  }

  const syncedPalettes = await listBackupSyncIndex();
  const deletable = [];
  const uploadIds = [];
  for (const palette of syncedPalettes) {
    if (palette.backupDirtyAt) continue;
    const isTombstoned = Object.hasOwn(remoteTombstones, palette.backupUid);
    if (isTombstoned && palette.backupRemoteHash) {
      deletable.push({
        id: palette.id,
        backupUid: palette.backupUid,
        remoteHash: palette.backupRemoteHash,
      });
    } else if (isTombstoned || !remotePalettes[palette.backupUid]) {
      // Deleted remotely before this device ever synced it, or unknown to
      // the server: local data wins and goes back up.
      uploadIds.push(palette.id);
    }
  }

  if (deletable.length > REMOTE_DELETE_GUARD_MIN && deletable.length * 2 > syncedPalettes.length) {
    clientLog("backup:pull-delete-guard", {
      blockedCount: deletable.length,
      localCount: syncedPalettes.length,
    });
  } else {
    result.deleted = await deletePalettesForRemoteTombstones(deletable);
  }
  await markPalettesForBackup(uploadIds);

  return result;
}
