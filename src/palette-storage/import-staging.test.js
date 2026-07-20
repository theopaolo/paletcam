import { afterEach, describe, expect, mock, test } from "bun:test";

const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const stagingModuleUrl = new URL("./import-staging.js", import.meta.url).href;
const ACTIVE_MARKER_KEY = "palette-import-active:v1";

function compoundKey(sessionId, ordinal) {
  return `${sessionId}\u0000${String(ordinal).padStart(8, "0")}`;
}

function createFakeDatabase({ failAssetPutAt = 0, onAssetPut } = {}) {
  let nextPaletteId = 101;
  let assetPutCount = 0;
  const metadata = new Map();
  const staging = new Map();
  const palettes = new Map();
  const assets = new Map();

  const metadataTable = {
    get: mock(async (key) => metadata.get(key)),
    put: mock(async (record) => {
      metadata.set(record.key, structuredClone(record));
      return record.key;
    }),
    delete: mock(async (key) => {
      metadata.delete(key);
    }),
  };

  function collectionForSession(sessionId) {
    return {
      primaryKeys: mock(async () =>
        [...staging.values()]
          .filter((record) => record.sessionId === sessionId)
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((record) => [record.sessionId, record.ordinal]),
      ),
      delete: mock(async () => {
        let deletedCount = 0;
        for (const [key, record] of staging) {
          if (record.sessionId === sessionId) {
            staging.delete(key);
            deletedCount += 1;
          }
        }
        return deletedCount;
      }),
    };
  }

  const stagingTable = {
    bulkAdd: mock(async (records) => {
      for (const record of records) {
        const key = compoundKey(record.sessionId, record.ordinal);
        if (staging.has(key)) {
          throw new DOMException("Duplicate staging key", "ConstraintError");
        }
        staging.set(key, structuredClone(record));
      }
    }),
    clear: mock(async () => staging.clear()),
    get: mock(async ([sessionId, ordinal]) => staging.get(compoundKey(sessionId, ordinal))),
    toArray: mock(async () => {
      throw new Error("Commit must not materialize all staged blobs.");
    }),
    where: mock((index) => {
      if (index !== "sessionId") {
        throw new Error(`Unexpected staging index: ${index}`);
      }
      return {
        equals: (sessionId) => collectionForSession(sessionId),
      };
    }),
  };

  const paletteTable = {
    add: mock(async (record) => {
      const paletteId = nextPaletteId;
      nextPaletteId += 1;
      palettes.set(paletteId, structuredClone(record));
      return paletteId;
    }),
  };
  const assetTable = {
    put: mock(async (record) => {
      assetPutCount += 1;
      onAssetPut?.(assetPutCount);
      if (failAssetPutAt > 0 && assetPutCount === failAssetPutAt) {
        throw new DOMException("Injected asset failure", "QuotaExceededError");
      }
      assets.set(record.paletteId, structuredClone(record));
      return record.paletteId;
    }),
  };

  const transaction = mock(async (...args) => {
    const callback = args.at(-1);
    const snapshot = {
      metadata: structuredClone(metadata),
      staging: structuredClone(staging),
      palettes: structuredClone(palettes),
      assets: structuredClone(assets),
      nextPaletteId,
    };
    try {
      return await callback();
    } catch (error) {
      metadata.clear();
      snapshot.metadata.forEach((value, key) => {
        metadata.set(key, value);
      });
      staging.clear();
      snapshot.staging.forEach((value, key) => {
        staging.set(key, value);
      });
      palettes.clear();
      snapshot.palettes.forEach((value, key) => {
        palettes.set(key, value);
      });
      assets.clear();
      snapshot.assets.forEach((value, key) => {
        assets.set(key, value);
      });
      nextPaletteId = snapshot.nextPaletteId;
      throw error;
    }
  });

  return {
    assets,
    db: {
      transaction,
      paletteStorageMetadata: metadataTable,
      paletteImportStaging: stagingTable,
      palettes: paletteTable,
      paletteAssets: assetTable,
    },
    metadata,
    palettes,
    staging,
    stagingTable,
    transaction,
  };
}

async function loadStagingModule(options = {}) {
  const fake = createFakeDatabase(options);
  mock.module(dbModuleUrl, () => ({ db: fake.db }));
  const module = await import(`${stagingModuleUrl}?test=${Math.random()}`);
  return { ...fake, module };
}

function createImportedPalette(index) {
  return {
    timestamp: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    colors: [{ r: index, g: index + 1, b: index + 2 }],
    photoBlob: new Blob([`photo-${index}`], { type: "image/webp" }),
  };
}

afterEach(() => {
  mock.restore();
});

describe("palette import staging", () => {
  test("holds a durable exclusive lease across tabs and recovers it only after expiry", async () => {
    const { metadata, module, staging } = await loadStagingModule();
    const firstSession = await module.beginImportSession({ nowMs: 1_000 });
    await module.stageImportBatch(firstSession, [createImportedPalette(0)], { nowMs: 2_000 });

    await expect(module.beginImportSession({ nowMs: 2_500 })).rejects.toMatchObject({
      code: module.PALETTE_IMPORT_CONFLICT_ERROR_CODE,
    });
    expect(staging.size).toBe(1);

    const replacementSession = await module.beginImportSession({
      nowMs: 40_000,
      staleAfterMs: 30_000,
    });
    expect(replacementSession).not.toBe(firstSession);
    expect(staging.size).toBe(0);
    expect(metadata.get(ACTIVE_MARKER_KEY)).toMatchObject({
      sessionId: replacementSession,
      stagedCount: 0,
    });
  });

  test("stages bounded batches and atomically commits them with one-record-at-a-time reads", async () => {
    const { assets, metadata, module, palettes, staging, stagingTable } = await loadStagingModule();
    const sessionId = await module.beginImportSession({ nowMs: 1_000 });

    await expect(
      module.stageImportBatch(
        sessionId,
        Array.from({ length: module.PALETTE_IMPORT_STAGING_BATCH_SIZE + 1 }, (_, index) =>
          createImportedPalette(index),
        ),
      ),
    ).rejects.toThrow("cannot exceed 25 palettes");
    await expect(
      module.stageImportBatch(sessionId, [createImportedPalette(0), createImportedPalette(1)], {
        nowMs: 2_000,
      }),
    ).resolves.toBe(2);
    await expect(
      module.stageImportBatch(sessionId, [createImportedPalette(2)], { nowMs: 3_000 }),
    ).resolves.toBe(3);

    await expect(
      module.commitImportSession(sessionId, { footerLabel: "import fallback" }),
    ).resolves.toBe(3);

    expect(palettes.size).toBe(3);
    expect(assets.size).toBe(3);
    expect(staging.size).toBe(0);
    expect(metadata.has(ACTIVE_MARKER_KEY)).toBe(false);
    expect(stagingTable.toArray).not.toHaveBeenCalled();
    expect(stagingTable.get).toHaveBeenCalledTimes(3);
    expect(palettes.get(101)).toMatchObject({
      timestamp: "2026-07-01T10:00:00.000Z",
      polaroidRenderSettings: { footerLabel: "import fallback" },
      hasPhotoAsset: true,
    });
    expect(palettes.get(101)).not.toHaveProperty("photoBlob");
  });

  test("reports a broken palette's absolute position across staged batches", async () => {
    const { module, staging } = await loadStagingModule();
    const sessionId = await module.beginImportSession({ nowMs: 1_000 });
    await module.stageImportBatch(sessionId, [createImportedPalette(0), createImportedPalette(1)], {
      nowMs: 2_000,
    });

    await expect(
      module.stageImportBatch(
        sessionId,
        [createImportedPalette(2), { ...createImportedPalette(3), photoBlob: null }],
        { nowMs: 3_000 },
      ),
    ).rejects.toThrow("Cannot import palette 4 without photo data.");
    expect(staging.size).toBe(2);
  });

  test("rolls back every live row when the final asset copy fails", async () => {
    const { assets, metadata, module, palettes, staging } = await loadStagingModule({
      failAssetPutAt: 2,
    });
    const sessionId = await module.beginImportSession();
    await module.stageImportBatch(sessionId, [createImportedPalette(0), createImportedPalette(1)]);

    await expect(
      module.commitImportSession(sessionId, { footerLabel: "fallback" }),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });

    expect(palettes.size).toBe(0);
    expect(assets.size).toBe(0);
    expect(staging.size).toBe(2);
    expect(metadata.get(ACTIVE_MARKER_KEY)?.sessionId).toBe(sessionId);
    await expect(module.abortImportSession(sessionId)).resolves.toBe(true);
    expect(staging.size).toBe(0);
  });

  test("rolls back the atomic commit when app termination aborts between staged records", async () => {
    const abortController = new AbortController();
    const abortError = Object.assign(new Error("app closed"), { name: "AbortError" });
    const { assets, metadata, module, palettes, staging } = await loadStagingModule({
      onAssetPut(assetPutCount) {
        if (assetPutCount === 1) {
          abortController.abort(abortError);
        }
      },
    });
    const sessionId = await module.beginImportSession();
    await module.stageImportBatch(sessionId, [createImportedPalette(0), createImportedPalette(1)]);

    await expect(
      module.commitImportSession(
        sessionId,
        { footerLabel: "fallback" },
        {
          signal: abortController.signal,
        },
      ),
    ).rejects.toBe(abortError);

    expect(palettes.size).toBe(0);
    expect(assets.size).toBe(0);
    expect(staging.size).toBe(2);
    expect(metadata.get(ACTIVE_MARKER_KEY)?.sessionId).toBe(sessionId);
  });

  test("rejects a damaged staging set without exposing any imported palette", async () => {
    const { assets, module, palettes, staging } = await loadStagingModule();
    const sessionId = await module.beginImportSession();
    await module.stageImportBatch(sessionId, [createImportedPalette(0), createImportedPalette(1)]);
    staging.delete(compoundKey(sessionId, 1));

    await expect(
      module.commitImportSession(sessionId, { footerLabel: "fallback" }),
    ).rejects.toMatchObject({ code: module.PALETTE_IMPORT_INTERRUPTED_ERROR_CODE });
    expect(palettes.size).toBe(0);
    expect(assets.size).toBe(0);
  });

  test("an expired owner cannot abort or append to a replacement session", async () => {
    const { metadata, module, staging } = await loadStagingModule();
    const expiredSession = await module.beginImportSession({ nowMs: 1_000 });
    await module.stageImportBatch(expiredSession, [createImportedPalette(0)], { nowMs: 2_000 });
    const currentSession = await module.beginImportSession({ nowMs: 40_000, staleAfterMs: 30_000 });
    await module.stageImportBatch(currentSession, [createImportedPalette(1)], { nowMs: 41_000 });

    await expect(module.abortImportSession(expiredSession)).resolves.toBe(false);
    await expect(
      module.stageImportBatch(expiredSession, [createImportedPalette(2)]),
    ).rejects.toMatchObject({ code: module.PALETTE_IMPORT_INTERRUPTED_ERROR_CODE });
    expect(staging.size).toBe(1);
    expect(metadata.get(ACTIVE_MARKER_KEY)?.sessionId).toBe(currentSession);
  });

  test("startup cleanup preserves a current lease and removes stale crash residue", async () => {
    const { metadata, module, staging } = await loadStagingModule();
    const sessionId = await module.beginImportSession({ nowMs: 1_000 });
    await module.stageImportBatch(sessionId, [createImportedPalette(0)], { nowMs: 2_000 });

    await expect(
      module.cleanupStaleImportSessions({ nowMs: 10_000, staleAfterMs: 30_000 }),
    ).resolves.toEqual({ cleaned: false });
    expect(staging.size).toBe(1);

    await expect(
      module.cleanupStaleImportSessions({ nowMs: 40_000, staleAfterMs: 30_000 }),
    ).resolves.toEqual({ cleaned: true });
    expect(staging.size).toBe(0);
    expect(metadata.has(ACTIVE_MARKER_KEY)).toBe(false);
  });
});
