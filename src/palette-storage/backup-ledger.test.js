import { afterEach, describe, expect, mock, test } from "bun:test";

const ledgerModuleUrl = new URL("./backup-ledger.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;

function createValidPaletteRow(id, overrides = {}) {
  return {
    id,
    timestamp: "2026-08-01T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
    backupUid: `uid-${id}`,
    backupDirtyAt: `2026-08-0${id}T10:00:00.000Z`,
    backupUploadedAt: null,
    ...overrides,
  };
}

function createLedgerDb({ palettes = [], tombstones = [] } = {}) {
  const paletteRows = new Map(palettes.map((row) => [row.id, structuredClone(row)]));
  const tombstoneRows = new Map(tombstones.map((row) => [row.backupUid, structuredClone(row)]));
  const deletedAssetIds = [];

  const db = {
    palettes: {
      async count() {
        return paletteRows.size;
      },
      orderBy(index) {
        const sorted = [...paletteRows.values()]
          .filter((row) => typeof row[index] === "string" && row[index])
          .sort((a, b) => (a[index] < b[index] ? -1 : 1));
        let sliceLimit = sorted.length;
        const collection = {
          limit(count) {
            sliceLimit = count;
            return collection;
          },
          async toArray() {
            return structuredClone(sorted.slice(0, sliceLimit));
          },
          async count() {
            return sorted.length;
          },
        };
        return collection;
      },
      async get(id) {
        const row = paletteRows.get(id);
        return row ? structuredClone(row) : undefined;
      },
      async update(id, changes) {
        const row = paletteRows.get(id);
        if (!row) return 0;
        Object.assign(row, changes);
        return 1;
      },
      async delete(id) {
        paletteRows.delete(id);
      },
      toCollection() {
        return {
          async modify(changes) {
            for (const row of paletteRows.values()) Object.assign(row, changes);
            return paletteRows.size;
          },
        };
      },
    },
    paletteAssets: {
      async delete(id) {
        deletedAssetIds.push(id);
      },
    },
    palettePreviews: {
      async bulkDelete() {},
    },
    backupTombstones: {
      limit(count) {
        return {
          async toArray() {
            return structuredClone([...tombstoneRows.values()].slice(0, count));
          },
        };
      },
      async bulkDelete(keys) {
        for (const key of keys) tombstoneRows.delete(key);
      },
      async clear() {
        tombstoneRows.clear();
      },
    },
    async transaction(_mode, ...args) {
      const callback = args.at(-1);
      return callback();
    },
  };

  return { db, deletedAssetIds, paletteRows, tombstoneRows };
}

async function loadLedgerModule(state) {
  const database = createLedgerDb(state);
  mock.module(dbModuleUrl, () => ({ db: database.db }));
  const module = await import(`${ledgerModuleUrl}?test=${Math.random()}`);
  return { ...database, module };
}

afterEach(() => {
  mock.restore();
});

describe("backup ledger", () => {
  test("lists the oldest dirty palettes first and skips corrupt rows", async () => {
    const { module } = await loadLedgerModule({
      palettes: [
        createValidPaletteRow(2),
        createValidPaletteRow(1),
        createValidPaletteRow(3, { colors: "corrupt" }),
        createValidPaletteRow(4, { backupDirtyAt: null }),
      ],
    });

    const queue = await module.listPalettesAwaitingBackup();

    expect(queue.map((palette) => palette.id)).toEqual([1, 2]);
  });

  test("bounds the queue batch to the ledger maximum", async () => {
    const { module } = await loadLedgerModule({
      palettes: [createValidPaletteRow(1), createValidPaletteRow(2)],
    });

    const queue = await module.listPalettesAwaitingBackup(1);

    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(1);
  });

  test("counts progress from the dirty index", async () => {
    const { module } = await loadLedgerModule({
      palettes: [
        createValidPaletteRow(1),
        createValidPaletteRow(2, {
          backupDirtyAt: null,
          backupUploadedAt: "2026-08-10T00:00:00.000Z",
        }),
      ],
    });

    await expect(module.countBackupProgress()).resolves.toEqual({
      total: 2,
      dirty: 1,
      backedUp: 1,
    });
  });

  test("marks a palette clean only when its dirty stamp is unchanged", async () => {
    const dirtyAt = "2026-08-01T10:00:00.000Z";
    const { module, paletteRows } = await loadLedgerModule({
      palettes: [createValidPaletteRow(1, { backupDirtyAt: dirtyAt })],
    });

    await expect(
      module.markPaletteBackedUp(1, {
        dirtyAtSeen: dirtyAt,
        uploadedAt: "2026-08-15T10:00:00.000Z",
        remoteHash: "A".repeat(64),
      }),
    ).resolves.toBe(true);
    expect(paletteRows.get(1)).toMatchObject({
      backupDirtyAt: null,
      backupUploadedAt: "2026-08-15T10:00:00.000Z",
      backupRemoteHash: "a".repeat(64),
    });
  });

  test("keeps the dirty flag when the palette changed mid-upload", async () => {
    const { module, paletteRows } = await loadLedgerModule({
      palettes: [createValidPaletteRow(1, { backupDirtyAt: "2026-08-14T10:00:00.000Z" })],
    });

    await expect(
      module.markPaletteBackedUp(1, { dirtyAtSeen: "2026-08-01T10:00:00.000Z" }),
    ).resolves.toBe(false);
    expect(paletteRows.get(1).backupDirtyAt).toBe("2026-08-14T10:00:00.000Z");
  });

  test("requires the observed dirty stamp to mark a palette clean", async () => {
    const { module } = await loadLedgerModule({ palettes: [createValidPaletteRow(1)] });

    await expect(module.markPaletteBackedUp(1, { dirtyAtSeen: "" })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  test("lists and resolves pending tombstones", async () => {
    const { module, tombstoneRows } = await loadLedgerModule({
      tombstones: [
        { backupUid: "uid-1", deletedAt: "2026-08-10T00:00:00.000Z" },
        { backupUid: "uid-2", deletedAt: "2026-08-11T00:00:00.000Z" },
      ],
    });

    const pending = await module.listPendingBackupTombstones();
    expect(pending).toHaveLength(2);

    await module.resolveBackupTombstones(["uid-1", "", null]);
    expect([...tombstoneRows.keys()]).toEqual(["uid-2"]);
  });

  test("reset forgets server versions, drops tombstones, keeps palette content and dirty stamps", async () => {
    const cleanRow = createValidPaletteRow(1, {
      backupDirtyAt: null,
      backupUploadedAt: "2026-08-10T00:00:00.000Z",
      backupRemoteHash: "a".repeat(64),
    });
    const dirtyRow = createValidPaletteRow(2);
    const { module, paletteRows, tombstoneRows } = await loadLedgerModule({
      palettes: [cleanRow, dirtyRow],
      tombstones: [{ backupUid: "uid-9", deletedAt: "2026-08-10T00:00:00.000Z" }],
    });

    await module.resetBackupLedger();

    expect(paletteRows.get(1)).toEqual({ ...cleanRow, backupRemoteHash: null });
    expect(paletteRows.get(2)).toEqual({ ...dirtyRow, backupRemoteHash: null });
    expect(tombstoneRows.size).toBe(0);
  });

  test("applies another device's version only while the row is as expected", async () => {
    const { module, paletteRows } = await loadLedgerModule({
      palettes: [
        createValidPaletteRow(1, { backupDirtyAt: null }),
        createValidPaletteRow(2, { backupDirtyAt: "2026-08-20T00:00:00.000Z" }),
      ],
    });
    const remotePalette = { favoritedAt: "2026-08-21T00:00:00.000Z", colors: "ignored" };

    await expect(
      module.applyRemotePaletteState(1, {
        expectedDirtyAt: null,
        remotePalette,
        remoteHash: "c".repeat(64),
      }),
    ).resolves.toBe(true);
    await expect(
      module.applyRemotePaletteState(2, {
        expectedDirtyAt: null,
        remotePalette,
        remoteHash: "c".repeat(64),
      }),
    ).resolves.toBe(false);

    expect(paletteRows.get(1)).toMatchObject({
      favoritedAt: "2026-08-21T00:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      backupRemoteHash: "c".repeat(64),
    });
    expect(paletteRows.get(2).favoritedAt).toBeUndefined();
  });

  test("a remote delete removes only clean rows still at the version this device saw", async () => {
    const seenHash = "a".repeat(64);
    const { deletedAssetIds, module, paletteRows } = await loadLedgerModule({
      palettes: [
        createValidPaletteRow(1, { backupDirtyAt: null, backupRemoteHash: seenHash }),
        createValidPaletteRow(2, { backupRemoteHash: seenHash }),
        createValidPaletteRow(3, { backupDirtyAt: null, backupRemoteHash: "b".repeat(64) }),
      ],
    });

    const deleted = await module.deletePalettesForRemoteTombstones(
      [1, 2, 3].map((id) => ({ id, backupUid: `uid-${id}`, remoteHash: seenHash })),
    );

    expect(deleted).toBe(1);
    expect([...paletteRows.keys()]).toEqual([2, 3]);
    expect(deletedAssetIds).toEqual([1]);
  });
});
