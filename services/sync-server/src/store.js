import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACCOUNT_ID_PATTERN } from "./accounts.js";

export const PALETTE_UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
export const ASSET_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_ASSETS_PER_PALETTE = 8;
const DELETED_ACCOUNT_DIR_PATTERN = /^[a-f0-9]{16}\.deleted$/;

export class BackupQuotaExceededError extends Error {
  constructor() {
    super("The account storage quota is exceeded.");
    this.name = "BackupQuotaExceededError";
  }
}

/** A conditional palette write found a different state than the client expected. */
export class BackupConflictError extends Error {
  constructor({ current, tombstoned }) {
    super("The palette changed since the client last read it.");
    this.name = "BackupConflictError";
    this.current = current;
    this.tombstoned = tombstoned;
  }
}

export function sha256HexOfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createEmptyManifest() {
  return { palettes: {}, assets: {}, tombstones: {}, usageBytes: 0 };
}

/**
 * Filesystem-backed backup store. One directory per account:
 *
 *   <dataDir>/<accountId>/
 *     account.json            credentials (owned by accounts.js)
 *     manifest.json           authoritative index, written atomically
 *     palettes/<uid>/*.json   versioned metadata documents, newest kept last
 *     assets/<sha256>         immutable content-addressed photo blobs
 *   <dataDir>/<accountId>.deleted/   a deleted account awaiting removal
 *
 * All mutating operations on one account are serialized through an in-process
 * lock; the manifest is rewritten via tmp-file + rename so a crash can never
 * leave a half-written index.
 */
export function createBackupStore({
  dataDir,
  maxPaletteVersions = 5,
  maxAccountBytes = Infinity,
  tombstoneRetentionDays = 30,
  now = () => new Date(),
}) {
  /** @type {Map<string, Promise<unknown>>} */
  const accountLocks = new Map();
  // A write that authenticated before the delete ran is still queued on the
  // lock. Without this check its mkdir would recreate the account directory.
  /** @type {Set<string>} */
  const deletedAccountIds = new Set();

  function assertAccountNotDeleted(accountId) {
    if (deletedAccountIds.has(accountId)) {
      throw new Error("The account was deleted.");
    }
  }

  function withAccountLock(accountId, operation) {
    const previous = accountLocks.get(accountId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    accountLocks.set(
      accountId,
      next.catch(() => {}),
    );
    return next;
  }

  function accountDir(accountId) {
    return join(dataDir, accountId);
  }

  function manifestPath(accountId) {
    return join(accountDir(accountId), "manifest.json");
  }

  function paletteDir(accountId, uid) {
    return join(accountDir(accountId), "palettes", uid);
  }

  function assetPath(accountId, assetHash) {
    return join(accountDir(accountId), "assets", assetHash);
  }

  async function readManifest(accountId) {
    try {
      const parsed = JSON.parse(await readFile(manifestPath(accountId), "utf8"));
      return {
        palettes: parsed?.palettes && typeof parsed.palettes === "object" ? parsed.palettes : {},
        assets: parsed?.assets && typeof parsed.assets === "object" ? parsed.assets : {},
        tombstones:
          parsed?.tombstones && typeof parsed.tombstones === "object" ? parsed.tombstones : {},
        usageBytes: Number.isFinite(parsed?.usageBytes) ? parsed.usageBytes : 0,
      };
    } catch {
      return createEmptyManifest();
    }
  }

  async function writeManifest(accountId, manifest) {
    const path = manifestPath(accountId);
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest)}\n`);
    await rename(temporaryPath, path);
  }

  function recomputeUsageBytes(manifest) {
    let usageBytes = 0;
    for (const entry of Object.values(manifest.palettes)) usageBytes += entry.bytes || 0;
    for (const entry of Object.values(manifest.assets)) usageBytes += entry.bytes || 0;
    manifest.usageBytes = usageBytes;
  }

  async function prunePaletteVersions(accountId, uid, keepFile) {
    const directory = paletteDir(accountId, uid);
    let files;
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    } catch {
      return;
    }

    const excess = files.length - maxPaletteVersions;
    for (const file of files.slice(0, Math.max(0, excess))) {
      if (file === keepFile) continue;
      await unlink(join(directory, file)).catch(() => {});
    }
  }

  /**
   * Stores one metadata document as a new immutable version and updates the
   * manifest. Only the latest version counts toward the quota. Older
   * versions are few (`maxPaletteVersions`) and small by contract.
   *
   * `expectedHash` writes only over that exact live version, `expectAbsent`
   * only when the uid is not live. The check runs under the account lock, so
   * of two writes against the same version only the first succeeds.
   */
  function putPalette(
    accountId,
    uid,
    { documentText, referencedAssets, expectedHash, expectAbsent = false },
  ) {
    return withAccountLock(accountId, async () => {
      assertAccountNotDeleted(accountId);
      const documentBytes = Buffer.byteLength(documentText, "utf8");
      const manifest = await readManifest(accountId);
      const live = manifest.palettes[uid];
      if ((expectedHash !== undefined && live?.hash !== expectedHash) || (expectAbsent && live)) {
        throw new BackupConflictError({
          current: live ? { hash: live.hash, updatedAt: live.updatedAt } : null,
          tombstoned: Object.hasOwn(manifest.tombstones, uid),
        });
      }
      const replacedBytes = live?.bytes || 0;
      if (manifest.usageBytes - replacedBytes + documentBytes > maxAccountBytes) {
        throw new BackupQuotaExceededError();
      }

      const directory = paletteDir(accountId, uid);
      await mkdir(directory, { recursive: true });
      const versionFile = `${now().toISOString().replaceAll(":", "-")}-${Math.random()
        .toString(16)
        .slice(2, 8)}.json`;
      await writeFile(join(directory, versionFile), documentText);
      await prunePaletteVersions(accountId, uid, versionFile);

      manifest.palettes[uid] = {
        hash: sha256HexOfBytes(Buffer.from(documentText, "utf8")),
        bytes: documentBytes,
        updatedAt: now().toISOString(),
        assets: [...referencedAssets],
        file: versionFile,
      };
      // A re-upload revives a tombstoned palette (the restore/undelete path).
      delete manifest.tombstones[uid];
      recomputeUsageBytes(manifest);
      await writeManifest(accountId, manifest);

      return { hash: manifest.palettes[uid].hash };
    });
  }

  /** Returns the latest document with the hash from the same manifest entry. */
  async function getPaletteDocument(accountId, uid) {
    const manifest = await readManifest(accountId);
    const entry = manifest.palettes[uid];
    if (!entry?.file) return null;
    try {
      const documentText = await readFile(join(paletteDir(accountId, uid), entry.file), "utf8");
      return { documentText, hash: entry.hash };
    } catch {
      return null;
    }
  }

  /**
   * Tombstones a palette: it leaves the manifest's live set but its files and
   * assets survive until the retention sweep, so an accidental mass-delete
   * cannot destroy the backup inside the grace window.
   */
  function tombstonePalette(accountId, uid) {
    return withAccountLock(accountId, async () => {
      const manifest = await readManifest(accountId);
      const entry = manifest.palettes[uid];
      if (!entry) {
        return { tombstoned: Object.hasOwn(manifest.tombstones, uid) };
      }

      manifest.tombstones[uid] = {
        deletedAt: now().toISOString(),
        assets: entry.assets || [],
        file: entry.file,
        bytes: entry.bytes || 0,
      };
      delete manifest.palettes[uid];
      recomputeUsageBytes(manifest);
      await writeManifest(accountId, manifest);
      return { tombstoned: true };
    });
  }

  function putAsset(accountId, assetHash, bytes) {
    return withAccountLock(accountId, async () => {
      assertAccountNotDeleted(accountId);
      const manifest = await readManifest(accountId);
      if (manifest.assets[assetHash]) {
        return { stored: false };
      }
      if (manifest.usageBytes + bytes.byteLength > maxAccountBytes) {
        throw new BackupQuotaExceededError();
      }

      await mkdir(join(accountDir(accountId), "assets"), { recursive: true });
      const path = assetPath(accountId, assetHash);
      const temporaryPath = `${path}.tmp`;
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, path);

      manifest.assets[assetHash] = { bytes: bytes.byteLength };
      recomputeUsageBytes(manifest);
      await writeManifest(accountId, manifest);
      return { stored: true };
    });
  }

  async function hasAsset(accountId, assetHash) {
    const manifest = await readManifest(accountId);
    return Boolean(manifest.assets[assetHash]);
  }

  function getAssetPath(accountId, assetHash) {
    return assetPath(accountId, assetHash);
  }

  async function getManifestSnapshot(accountId) {
    const manifest = await readManifest(accountId);
    return {
      palettes: Object.fromEntries(
        Object.entries(manifest.palettes).map(([uid, entry]) => [
          uid,
          { hash: entry.hash, updatedAt: entry.updatedAt, assets: entry.assets || [] },
        ]),
      ),
      assets: Object.keys(manifest.assets),
      tombstones: Object.fromEntries(
        Object.entries(manifest.tombstones).map(([uid, entry]) => [
          uid,
          { deletedAt: entry.deletedAt },
        ]),
      ),
      usageBytes: manifest.usageBytes,
      maxAccountBytes: Number.isFinite(maxAccountBytes) ? maxAccountBytes : null,
    };
  }

  /**
   * Removes the files of tombstones older than the retention window, then
   * garbage-collects assets no live palette or unpurged tombstone references.
   * The tombstone uid stays in the manifest for good, so a device that was
   * offline longer than the window still learns the palette was deleted.
   */
  function sweepAccount(accountId, { nowMs = now().getTime() } = {}) {
    return withAccountLock(accountId, async () => {
      const manifest = await readManifest(accountId);
      const retentionMs = tombstoneRetentionDays * 24 * 60 * 60 * 1000;
      let purgedPalettes = 0;

      // ponytail: the sweep keeps purged tombstones, so the manifest grows by
      // about 100 bytes per deleted palette. Compact them if that ever matters.
      for (const [uid, tombstone] of Object.entries(manifest.tombstones)) {
        if (tombstone.purgedAt) continue;
        const deletedAtMs = Date.parse(tombstone.deletedAt || "");
        if (!Number.isFinite(deletedAtMs) || nowMs - deletedAtMs >= retentionMs) {
          await rm(paletteDir(accountId, uid), { recursive: true, force: true });
          const purgedAt = new Date(nowMs).toISOString();
          // Dropping assets, file and bytes frees the photos for the GC below.
          manifest.tombstones[uid] = {
            deletedAt: Number.isFinite(deletedAtMs) ? tombstone.deletedAt : purgedAt,
            purgedAt,
          };
          purgedPalettes += 1;
        }
      }

      const referencedAssets = new Set();
      for (const entry of Object.values(manifest.palettes)) {
        for (const assetHash of entry.assets || []) referencedAssets.add(assetHash);
      }
      for (const entry of Object.values(manifest.tombstones)) {
        for (const assetHash of entry.assets || []) referencedAssets.add(assetHash);
      }

      let purgedAssets = 0;
      for (const assetHash of Object.keys(manifest.assets)) {
        if (referencedAssets.has(assetHash)) continue;
        await unlink(assetPath(accountId, assetHash)).catch(() => {});
        delete manifest.assets[assetHash];
        purgedAssets += 1;
      }

      recomputeUsageBytes(manifest);
      await writeManifest(accountId, manifest);
      return { purgedPalettes, purgedAssets };
    });
  }

  function deletedAccountDir(accountId) {
    return join(dataDir, `${accountId}.deleted`);
  }

  async function removeDeletedAccountDir(path) {
    await rm(path, { recursive: true, force: true }).catch((error) => {
      console.error(`[sync-server] removing ${path} failed, the next sweep retries:`, error);
    });
  }

  /**
   * Deletes an account with everything it stored: credentials, palette
   * versions, tombstones, assets and quota usage all live in its directory.
   * Renaming that directory is the commit point. account.json moves with it,
   * so the secret and the recovery code stop working in one atomic step. The
   * removal that follows may fail halfway, and `sweepAllAccounts` then finishes it.
   */
  function deleteAccount(accountId) {
    return withAccountLock(accountId, async () => {
      try {
        await rename(accountDir(accountId), deletedAccountDir(accountId));
      } catch (error) {
        // ENOENT: a concurrent delete of the same account already committed.
        if (error?.code !== "ENOENT") throw error;
      }
      deletedAccountIds.add(accountId);
      await removeDeletedAccountDir(deletedAccountDir(accountId));
    });
  }

  async function sweepAllAccounts(options = {}) {
    let entries = [];
    try {
      entries = await readdir(dataDir);
    } catch {
      return { accounts: 0 };
    }

    for (const entry of entries.filter((name) => DELETED_ACCOUNT_DIR_PATTERN.test(name))) {
      await removeDeletedAccountDir(join(dataDir, entry));
    }

    const accountIds = entries.filter((entry) => ACCOUNT_ID_PATTERN.test(entry));

    for (const accountId of accountIds) {
      await sweepAccount(accountId, options).catch((error) => {
        console.error(`[sync-server] sweep failed for account ${accountId}:`, error);
      });
    }
    return { accounts: accountIds.length };
  }

  return {
    deleteAccount,
    getAssetPath,
    getManifestSnapshot,
    getPaletteDocument,
    hasAsset,
    putAsset,
    putPalette,
    sweepAccount,
    sweepAllAccounts,
    tombstonePalette,
  };
}
