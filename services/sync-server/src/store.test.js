import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupConflictError,
  BackupQuotaExceededError,
  createBackupStore,
  sha256HexOfBytes,
} from "./store.js";

const ACCOUNT_ID = "0123456789abcdef";
const PALETTE_UID = "aaaabbbb-cccc-dddd";
const temporaryDirs = [];

async function createStore(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "sync-store-"));
  temporaryDirs.push(dataDir);
  return { dataDir, store: createBackupStore({ dataDir, ...options }) };
}

function paletteDocument(overrides = {}) {
  return JSON.stringify({ palette: { colors: [{ r: 1, g: 2, b: 3 }] }, ...overrides });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("sync-server store", () => {
  test("stores palette versions, prunes beyond the cap, and serves the latest", async () => {
    const { dataDir, store } = await createStore({ maxPaletteVersions: 2 });

    for (const label of ["one", "two", "three"]) {
      await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
        documentText: paletteDocument({ label }),
        referencedAssets: [],
      });
    }

    const versions = await readdir(join(dataDir, ACCOUNT_ID, "palettes", PALETTE_UID));
    expect(versions).toHaveLength(2);
    const latest = await store.getPaletteDocument(ACCOUNT_ID, PALETTE_UID);
    expect(JSON.parse(latest.documentText).label).toBe("three");

    const manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(Object.keys(manifest.palettes)).toEqual([PALETTE_UID]);
    expect(manifest.palettes[PALETTE_UID].hash).toHaveLength(64);
    expect(latest.hash).toBe(manifest.palettes[PALETTE_UID].hash);
  });

  test("conditional writes check the live version atomically", async () => {
    const { store } = await createStore();
    const first = await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument({ label: "one" }),
      referencedAssets: [],
      expectAbsent: true,
    });

    // Two devices edit the same version: exactly one wins.
    const results = await Promise.allSettled(
      ["two", "three"].map((label) =>
        store.putPalette(ACCOUNT_ID, PALETTE_UID, {
          documentText: paletteDocument({ label }),
          referencedAssets: [],
          expectedHash: first.hash,
        }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const conflict = results[1].reason;
    expect(conflict).toBeInstanceOf(BackupConflictError);
    expect(conflict.current.hash).toBe(results[0].value.hash);
    expect(conflict.tombstoned).toBe(false);

    await expect(
      store.putPalette(ACCOUNT_ID, PALETTE_UID, {
        documentText: paletteDocument(),
        referencedAssets: [],
        expectAbsent: true,
      }),
    ).rejects.toBeInstanceOf(BackupConflictError);
  });

  test("re-uploading a tombstoned palette revives it", async () => {
    const { store } = await createStore();
    await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [],
    });
    await store.tombstonePalette(ACCOUNT_ID, PALETTE_UID);

    let manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.palettes[PALETTE_UID]).toBeUndefined();
    expect(manifest.tombstones[PALETTE_UID]).toBeDefined();

    await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [],
    });
    manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.palettes[PALETTE_UID]).toBeDefined();
    expect(manifest.tombstones[PALETTE_UID]).toBeUndefined();
  });

  test("sweep purges expired tombstones and their orphaned assets but keeps the uid", async () => {
    const { dataDir, store } = await createStore({ tombstoneRetentionDays: 30 });
    const assetBytes = new Uint8Array([1, 2, 3, 4]);
    const assetHash = sha256HexOfBytes(assetBytes);
    await store.putAsset(ACCOUNT_ID, assetHash, assetBytes);
    await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [assetHash],
    });
    await store.tombstonePalette(ACCOUNT_ID, PALETTE_UID);

    const tombstonedAtMs = Date.now();
    await store.sweepAccount(ACCOUNT_ID, { nowMs: tombstonedAtMs + 24 * 60 * 60 * 1000 });
    let manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.tombstones[PALETTE_UID]).toBeDefined();
    expect(manifest.assets).toEqual([assetHash]);

    const { deletedAt } = manifest.tombstones[PALETTE_UID];
    const purgeAtMs = tombstonedAtMs + 31 * 24 * 60 * 60 * 1000;
    await expect(store.sweepAccount(ACCOUNT_ID, { nowMs: purgeAtMs })).resolves.toEqual({
      purgedPalettes: 1,
      purgedAssets: 1,
    });
    manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.tombstones[PALETTE_UID]).toEqual({ deletedAt });
    expect(manifest.assets).toEqual([]);
    expect(manifest.usageBytes).toBe(0);
    expect(await store.getPaletteDocument(ACCOUNT_ID, PALETTE_UID)).toBeNull();
    expect(
      JSON.parse(await readFile(join(dataDir, ACCOUNT_ID, "manifest.json"), "utf8")).tombstones,
    ).toEqual({ [PALETTE_UID]: { deletedAt, purgedAt: new Date(purgeAtMs).toISOString() } });

    // Later sweeps and deletes leave a purged tombstone as it is.
    await expect(
      store.sweepAccount(ACCOUNT_ID, { nowMs: purgeAtMs + 24 * 60 * 60 * 1000 }),
    ).resolves.toEqual({ purgedPalettes: 0, purgedAssets: 0 });
    await expect(store.tombstonePalette(ACCOUNT_ID, PALETTE_UID)).resolves.toEqual({
      tombstoned: true,
    });
    expect((await store.getManifestSnapshot(ACCOUNT_ID)).tombstones[PALETTE_UID]).toEqual({
      deletedAt,
    });

    await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [],
      expectAbsent: true,
    });
    manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.palettes[PALETTE_UID]).toBeDefined();
    expect(manifest.tombstones[PALETTE_UID]).toBeUndefined();
  });

  test("asset writes deduplicate and enforce the account quota", async () => {
    const { store } = await createStore({ maxAccountBytes: 10 });
    const smallAsset = new Uint8Array([1, 2, 3]);
    const smallHash = sha256HexOfBytes(smallAsset);

    await expect(store.putAsset(ACCOUNT_ID, smallHash, smallAsset)).resolves.toEqual({
      stored: true,
    });
    await expect(store.putAsset(ACCOUNT_ID, smallHash, smallAsset)).resolves.toEqual({
      stored: false,
    });

    const bigAsset = new Uint8Array(9);
    await expect(
      store.putAsset(ACCOUNT_ID, sha256HexOfBytes(bigAsset), bigAsset),
    ).rejects.toBeInstanceOf(BackupQuotaExceededError);
  });

  test("a write queued behind an account delete does not recreate the account", async () => {
    const { dataDir, store } = await createStore();
    await store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [],
    });

    const deleting = store.deleteAccount(ACCOUNT_ID);
    const queuedWrite = store.putPalette(ACCOUNT_ID, PALETTE_UID, {
      documentText: paletteDocument(),
      referencedAssets: [],
    });

    await deleting;
    await expect(queuedWrite).rejects.toThrow("deleted");
    expect(await readdir(dataDir)).toEqual([]);
  });

  test("the sweep finishes an account removal that stopped after the rename", async () => {
    const { dataDir, store } = await createStore();
    const leftover = join(dataDir, `${ACCOUNT_ID}.deleted`, "palettes", PALETTE_UID);
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, "v1.json"), paletteDocument());

    await store.sweepAllAccounts();

    expect(await readdir(dataDir)).toEqual([]);
  });

  test("usage counts the latest metadata and assets", async () => {
    const { store } = await createStore();
    const assetBytes = new Uint8Array([9, 9, 9, 9, 9]);
    await store.putAsset(ACCOUNT_ID, sha256HexOfBytes(assetBytes), assetBytes);
    const documentText = paletteDocument();
    await store.putPalette(ACCOUNT_ID, PALETTE_UID, { documentText, referencedAssets: [] });

    const manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.usageBytes).toBe(assetBytes.byteLength + Buffer.byteLength(documentText));
  });
});
