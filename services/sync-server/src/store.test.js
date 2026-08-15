import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupQuotaExceededError, createBackupStore, sha256HexOfBytes } from "./store.js";

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
    expect(JSON.parse(await store.getPaletteDocument(ACCOUNT_ID, PALETTE_UID)).label).toBe("three");

    const manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(Object.keys(manifest.palettes)).toEqual([PALETTE_UID]);
    expect(manifest.palettes[PALETTE_UID].hash).toHaveLength(64);
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

  test("sweep keeps fresh tombstones and purges expired ones with their orphaned assets", async () => {
    const { store } = await createStore({ tombstoneRetentionDays: 30 });
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

    await store.sweepAccount(ACCOUNT_ID, { nowMs: tombstonedAtMs + 31 * 24 * 60 * 60 * 1000 });
    manifest = await store.getManifestSnapshot(ACCOUNT_ID);
    expect(manifest.tombstones[PALETTE_UID]).toBeUndefined();
    expect(manifest.assets).toEqual([]);
    expect(await store.getPaletteDocument(ACCOUNT_ID, PALETTE_UID)).toBeNull();
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
