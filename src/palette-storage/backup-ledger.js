import { db } from "./db.js";
import {
  normalizeBackupRemoteHash,
  parseStoredPaletteMetadataRecord,
  pickSyncedPaletteFields,
} from "./records.js";

export const MAX_BACKUP_QUEUE_BATCH = 50;

function getBackupBatchLimit(limit) {
  const normalized = Math.floor(Number(limit));
  if (!Number.isFinite(normalized) || normalized < 1) {
    return MAX_BACKUP_QUEUE_BATCH;
  }
  return Math.min(MAX_BACKUP_QUEUE_BATCH, normalized);
}

/**
 * Oldest-dirty-first upload queue. The `backupDirtyAt` index contains exactly
 * the records awaiting upload (`null` rows are excluded from the index, see
 * db.js), so this never scans clean palettes. Rows that fail the strict parse
 * are skipped rather than surfaced: the flush loop must not choke on one
 * corrupt record.
 * @returns {Promise<Palette[]>}
 */
export async function listPalettesAwaitingBackup(limit = MAX_BACKUP_QUEUE_BATCH) {
  const rows = await db.palettes
    .orderBy("backupDirtyAt")
    .limit(getBackupBatchLimit(limit))
    .toArray();
  return rows
    .map((row) => parseStoredPaletteMetadataRecord(row))
    .filter((palette) => palette !== null);
}

/**
 * Progress counts for the "N of M backed up" settings row.
 * @returns {Promise<{total: number, dirty: number, backedUp: number}>}
 */
export async function countBackupProgress() {
  return db.transaction("r", db.palettes, async () => {
    const total = await db.palettes.count();
    const dirty = await db.palettes.orderBy("backupDirtyAt").count();
    return { total, dirty, backedUp: total - dirty };
  });
}

/**
 * Every readable palette, for the sync pass to diff against the manifest.
 * Rows are metadata only (photos and previews live in other tables).
 * @returns {Promise<Palette[]>}
 */
export async function listBackupSyncIndex() {
  const rows = await db.palettes.toArray();
  return rows
    .map((row) => parseStoredPaletteMetadataRecord(row))
    .filter((palette) => palette !== null);
}

/**
 * Clears the dirty flag only when the record is unchanged since the upload
 * read it. A palette edited mid-upload keeps its newer dirty stamp and is
 * picked up again by the next flush.
 * @param {number} paletteId
 * @param {{dirtyAtSeen: string, uploadedAt?: string, remoteHash?: string | null}} options
 * @returns {Promise<boolean>} whether the record was marked clean
 */
export async function markPaletteBackedUp(
  paletteId,
  { dirtyAtSeen, uploadedAt = new Date().toISOString(), remoteHash = null },
) {
  if (typeof dirtyAtSeen !== "string" || !dirtyAtSeen) {
    throw new TypeError("The dirty stamp observed at upload time is required.");
  }

  return db.transaction("rw", db.palettes, async () => {
    const row = await db.palettes.get(paletteId);
    if (!row || row.backupDirtyAt !== dirtyAtSeen) {
      return false;
    }

    await db.palettes.update(paletteId, {
      backupDirtyAt: null,
      backupUploadedAt: uploadedAt,
      backupRemoteHash: normalizeBackupRemoteHash(remoteHash),
    });
    return true;
  });
}

/**
 * Copies another device's version of a palette onto the local row. It only
 * applies while the row still carries `expectedDirtyAt` (`null` for a clean
 * row), so a local edit made during the download is never overwritten.
 * @param {number} paletteId
 * @param {{expectedDirtyAt: string | null, remotePalette: object, remoteHash: string | null}} options
 * @returns {Promise<boolean>} whether the row was updated
 */
export async function applyRemotePaletteState(
  paletteId,
  { expectedDirtyAt, remotePalette, remoteHash },
) {
  return db.transaction("rw", db.palettes, async () => {
    const row = await db.palettes.get(paletteId);
    if (!row || (row.backupDirtyAt ?? null) !== expectedDirtyAt) {
      return false;
    }
    await db.palettes.update(paletteId, {
      ...pickSyncedPaletteFields(remotePalette),
      backupDirtyAt: null,
      backupRemoteHash: normalizeBackupRemoteHash(remoteHash),
    });
    return true;
  });
}

/**
 * Gives a local palette the server identity of a duplicate with a lower uid.
 * Two devices that imported the same file then converge on one uid without
 * deleting local data. The old uid gets a local tombstone, so the next flush
 * removes it from the server.
 * @param {number} paletteId
 * @param {{fromUid: string, toUid: string, fields: object, remoteHash: string | null, dirty: boolean}} options
 * @returns {Promise<boolean>} whether the row was re-keyed
 */
export async function rekeyPaletteBackupUid(
  paletteId,
  { fromUid, toUid, fields, remoteHash, dirty },
) {
  return db.transaction("rw", db.palettes, db.backupTombstones, async () => {
    const row = await db.palettes.get(paletteId);
    if (!row || row.backupUid !== fromUid) {
      return false;
    }
    if ((await db.palettes.where("backupUid").equals(toUid).primaryKeys()).length > 0) {
      return false;
    }

    const nowIso = new Date().toISOString();
    await db.palettes.update(paletteId, {
      ...pickSyncedPaletteFields(fields),
      backupUid: toUid,
      backupRemoteHash: normalizeBackupRemoteHash(remoteHash),
      backupDirtyAt: dirty ? (row.backupDirtyAt ?? nowIso) : null,
    });
    await db.backupTombstones.put({ backupUid: fromUid, deletedAt: nowIso });
    return true;
  });
}

/**
 * Records the server version of palettes the sync pass just imported. A row
 * whose merged state differs from that version stays dirty so it uploads.
 * @param {Array<{backupUid: string, remoteHash: string | null, clean: boolean}>} entries
 */
export async function markPalettesPulled(entries, pulledAt = new Date().toISOString()) {
  const validEntries = (Array.isArray(entries) ? entries : []).filter(
    (entry) => typeof entry?.backupUid === "string" && entry.backupUid,
  );
  if (validEntries.length === 0) {
    return;
  }
  await db.transaction("rw", db.palettes, async () => {
    for (const { backupUid, remoteHash, clean } of validEntries) {
      await db.palettes
        .where("backupUid")
        .equals(backupUid)
        .modify({
          backupRemoteHash: normalizeBackupRemoteHash(remoteHash),
          backupUploadedAt: pulledAt,
          ...(clean ? { backupDirtyAt: null } : {}),
        });
    }
  });
}

/**
 * Deletes local palettes that another device deleted. A row is removed only
 * while it is clean and still matches the server version this device last
 * saw, so a local edit or a palette of unknown origin always survives.
 * @param {Array<{id: number, backupUid: string, remoteHash: string}>} entries
 * @returns {Promise<number>} number of palettes deleted
 */
export async function deletePalettesForRemoteTombstones(entries) {
  const validEntries = Array.isArray(entries) ? entries : [];
  if (validEntries.length === 0) {
    return 0;
  }
  return db.transaction("rw", db.palettes, db.paletteAssets, db.palettePreviews, async () => {
    let deletedCount = 0;
    for (const { id, backupUid, remoteHash } of validEntries) {
      const row = await db.palettes.get(id);
      if (
        !row ||
        row.backupUid !== backupUid ||
        row.backupDirtyAt ||
        !remoteHash ||
        normalizeBackupRemoteHash(row.backupRemoteHash) !== remoteHash
      ) {
        continue;
      }
      await db.palettePreviews.bulkDelete([
        [id, "gallery"],
        [id, "viewer"],
      ]);
      await db.paletteAssets.delete(id);
      await db.palettes.delete(id);
      deletedCount += 1;
    }
    return deletedCount;
  });
}

/**
 * Queues clean palettes for upload with no known server version: the server
 * lacks them, or deleted them while this device could not know.
 * @param {number[]} paletteIds
 */
export async function markPalettesForBackup(paletteIds, markedAt = new Date().toISOString()) {
  const ids = [
    ...new Set((Array.isArray(paletteIds) ? paletteIds : []).filter(Number.isSafeInteger)),
  ];
  if (ids.length === 0) {
    return 0;
  }
  return db.transaction("rw", db.palettes, async () => {
    const rows = await db.palettes.bulkGet(ids);
    const cleanIds = ids.filter((_id, index) => rows[index] && !rows[index].backupDirtyAt);
    if (cleanIds.length === 0) {
      return 0;
    }
    return db.palettes.bulkUpdate(
      cleanIds.map((key) => ({
        key,
        changes: { backupDirtyAt: markedAt, backupRemoteHash: null },
      })),
    );
  });
}

/** @returns {Promise<BackupTombstoneRecord[]>} */
export async function listPendingBackupTombstones(limit = MAX_BACKUP_QUEUE_BATCH) {
  return db.backupTombstones.limit(getBackupBatchLimit(limit)).toArray();
}

/** @returns {Promise<string[]>} uids of every local delete not yet sent */
export async function listAllPendingBackupTombstoneUids() {
  const keys = await db.backupTombstones.toCollection().primaryKeys();
  return keys.map((key) => String(key));
}

/** @param {string[]} backupUids */
export async function resolveBackupTombstones(backupUids) {
  const uids = (Array.isArray(backupUids) ? backupUids : []).filter(
    (uid) => typeof uid === "string" && uid,
  );
  if (uids.length === 0) {
    return;
  }
  await db.backupTombstones.bulkDelete(uids);
}

/**
 * Forgets what the server held after the account was deleted: every server
 * version is unknown again and pending tombstones are dropped. Palette content
 * is untouched. The next sync pass queues every palette the new account lacks.
 */
export async function resetBackupLedger() {
  await db.transaction("rw", db.palettes, db.backupTombstones, async () => {
    await forgetBackupRemoteHashes();
    await db.backupTombstones.clear();
  });
}

/**
 * Marks every server version unknown. The ledger cannot tell which account a
 * hash came from, so connecting an account starts from here: the next sync
 * pass downloads what the account holds and uploads what it lacks. Dirty
 * stamps stay as they are, so a stale palette cannot look like a new edit.
 */
export async function forgetBackupRemoteHashes() {
  await db.palettes.toCollection().modify({ backupRemoteHash: null });
}
