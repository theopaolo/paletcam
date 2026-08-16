import { db } from "./db.js";
import { parseStoredPaletteMetadataRecord } from "./records.js";

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
 * Clears the dirty flag only when the record is unchanged since the upload
 * read it. A palette edited mid-upload keeps its newer dirty stamp and is
 * picked up again by the next flush.
 * @param {number} paletteId
 * @param {{dirtyAtSeen: string, uploadedAt?: string}} options
 * @returns {Promise<boolean>} whether the record was marked clean
 */
export async function markPaletteBackedUp(
  paletteId,
  { dirtyAtSeen, uploadedAt = new Date().toISOString() },
) {
  if (typeof dirtyAtSeen !== "string" || !dirtyAtSeen) {
    throw new TypeError("The dirty stamp observed at upload time is required.");
  }

  return db.transaction("rw", db.palettes, async () => {
    const row = await db.palettes.get(paletteId);
    if (!row || row.backupDirtyAt !== dirtyAtSeen) {
      return false;
    }

    await db.palettes.update(paletteId, { backupDirtyAt: null, backupUploadedAt: uploadedAt });
    return true;
  });
}

/**
 * Which of the given server uids already exist locally — restore skips them
 * instead of tripping the unique `backupUid` index.
 * @param {string[]} backupUids
 * @returns {Promise<Set<string>>}
 */
export async function listExistingBackupUids(backupUids) {
  const uids = (Array.isArray(backupUids) ? backupUids : []).filter(
    (uid) => typeof uid === "string" && uid,
  );
  if (uids.length === 0) {
    return new Set();
  }
  const presentKeys = await db.palettes.where("backupUid").anyOf(uids).keys();
  return new Set(presentKeys.map((key) => String(key)));
}

/**
 * Marks freshly restored palettes clean: their content already lives on the
 * server, so the flush loop must not re-upload it.
 * @param {string[]} backupUids
 */
export async function markPalettesRestoredClean(backupUids, restoredAt = new Date().toISOString()) {
  const uids = (Array.isArray(backupUids) ? backupUids : []).filter(
    (uid) => typeof uid === "string" && uid,
  );
  if (uids.length === 0) {
    return 0;
  }
  return db.palettes.where("backupUid").anyOf(uids).modify({
    backupDirtyAt: null,
    backupUploadedAt: restoredAt,
  });
}

/** @returns {Promise<BackupTombstoneRecord[]>} */
export async function listPendingBackupTombstones(limit = MAX_BACKUP_QUEUE_BATCH) {
  return db.backupTombstones.limit(getBackupBatchLimit(limit)).toArray();
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
