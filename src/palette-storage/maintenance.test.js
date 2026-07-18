import { afterEach, describe, expect, mock, test } from "bun:test";

const maintenanceModuleUrl = new URL("./maintenance.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const clientLogModuleUrl = new URL("../modules/client-log.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../modules/error-reporting.js", import.meta.url).href;
const importStagingModuleUrl = new URL("./import-staging.js", import.meta.url).href;

const MARKER_KEY = "legacy-polaroid-render-settings:v1";

async function loadMaintenanceModule({
  records = [],
  assetKeys = [],
  previewKeys = [],
  metadataEntries = new Map(),
  transactionFailures = [],
  hasPreviewTable = true,
} = {}) {
  const modify = mock(async (modifier) => {
    for (const record of records) {
      modifier(record);
    }
  });
  const deletedAssetKeys = [];
  const deletedPreviewKeys = [];
  const metadataGet = mock(async (key) => metadataEntries.get(key));
  const metadataPut = mock(async (entry) => {
    metadataEntries.set(entry.key, { ...entry });
  });
  const transaction = mock(async (...args) => {
    const callback = args.at(-1);
    const recordSnapshot = records.map((record) => structuredClone(record));
    const metadataSnapshot = new Map(
      [...metadataEntries].map(([key, value]) => [key, structuredClone(value)]),
    );
    try {
      const result = await callback();
      const failure = transactionFailures.shift();
      if (failure) {
        throw failure;
      }
      return result;
    } catch (error) {
      records.splice(0, records.length, ...recordSnapshot);
      metadataEntries.clear();
      metadataSnapshot.forEach((value, key) => {
        metadataEntries.set(key, value);
      });
      throw error;
    }
  });
  const clientLog = mock(() => {});
  const reportAppError = mock(() => {});
  const cleanupStaleImportSessions = mock(async () => ({ cleaned: false }));

  const palettePreviews = hasPreviewTable
    ? {
        delete: async (key) => deletedPreviewKeys.push(key),
        toCollection: () => ({ primaryKeys: async () => previewKeys }),
      }
    : undefined;

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: {
        toCollection: () => ({
          modify,
          primaryKeys: async () => records.map((record) => record.id),
        }),
      },
      paletteAssets: {
        delete: async (key) => deletedAssetKeys.push(key),
        toCollection: () => ({ primaryKeys: async () => assetKeys }),
      },
      palettePreviews,
      paletteStorageMetadata: {
        get: metadataGet,
        put: metadataPut,
      },
    },
  }));
  mock.module(clientLogModuleUrl, () => ({ clientLog }));
  mock.module(errorReportingModuleUrl, () => ({ reportAppError }));
  mock.module(importStagingModuleUrl, () => ({ cleanupStaleImportSessions }));

  const module = await import(`${maintenanceModuleUrl}?test=${Math.random()}`);
  module.resetPaletteStorageMaintenanceForTests();
  return {
    clientLog,
    cleanupStaleImportSessions,
    deletedAssetKeys,
    deletedPreviewKeys,
    metadataEntries,
    metadataGet,
    metadataPut,
    modify,
    module,
    reportAppError,
    transaction,
  };
}

afterEach(() => {
  mock.restore();
});

describe("palette storage maintenance", () => {
  test("atomically backfills only missing legacy render settings", async () => {
    const records = [
      { id: 1, polaroidRenderSettings: null },
      { id: 2, polaroidRenderSettings: { footerLabel: "original" } },
      { id: 3 },
    ];
    const {
      cleanupStaleImportSessions,
      metadataEntries,
      metadataPut,
      modify,
      module,
      transaction,
    } = await loadMaintenanceModule({ records });

    const result = await module.initializePaletteStorage({
      polaroidRenderSettings: { footerLabel: "frozen" },
    });

    expect(result).toEqual({ updatedCount: 2 });
    expect(records).toEqual([
      { id: 1, polaroidRenderSettings: { footerLabel: "frozen" } },
      { id: 2, polaroidRenderSettings: { footerLabel: "original" } },
      { id: 3, polaroidRenderSettings: { footerLabel: "frozen" } },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(cleanupStaleImportSessions).toHaveBeenCalledTimes(1);
    expect(modify).toHaveBeenCalledTimes(1);
    expect(metadataPut).toHaveBeenCalledTimes(1);
    expect(metadataEntries.get(MARKER_KEY)).toMatchObject({
      key: MARKER_KEY,
      version: 1,
    });
    expect(metadataEntries.get(MARKER_KEY)).not.toHaveProperty("status");
  });

  test("deduplicates concurrent startup maintenance", async () => {
    const { metadataPut, modify, module, transaction } = await loadMaintenanceModule({
      records: [{ id: 1 }],
    });

    const first = module.initializePaletteStorage({
      polaroidRenderSettings: { footerLabel: "frozen" },
    });
    const second = module.initializePaletteStorage({
      polaroidRenderSettings: { footerLabel: "frozen" },
    });

    expect(first).toBe(second);
    await first;
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(modify).toHaveBeenCalledTimes(1);
    expect(metadataPut).toHaveBeenCalledTimes(1);
  });

  test("a second startup reads the durable marker without rescanning palettes", async () => {
    const records = [{ id: 1 }];
    const metadataEntries = new Map();
    const firstStartup = await loadMaintenanceModule({ records, metadataEntries });
    await firstStartup.module.initializePaletteStorage({
      polaroidRenderSettings: { footerLabel: "frozen" },
    });

    const secondStartup = await loadMaintenanceModule({ records, metadataEntries });
    await expect(
      secondStartup.module.initializePaletteStorage({
        polaroidRenderSettings: { footerLabel: "changed" },
      }),
    ).resolves.toEqual({ updatedCount: 0 });

    expect(firstStartup.modify).toHaveBeenCalledTimes(1);
    expect(secondStartup.metadataGet).toHaveBeenCalledWith(MARKER_KEY);
    expect(secondStartup.modify).not.toHaveBeenCalled();
    expect(secondStartup.metadataPut).not.toHaveBeenCalled();
    expect(records[0].polaroidRenderSettings).toEqual({ footerLabel: "frozen" });
  });

  test("an equal or future marker skips the backfill", async () => {
    for (const version of [1, 2]) {
      const metadataEntries = new Map([[MARKER_KEY, { key: MARKER_KEY, version }]]);
      const { metadataPut, modify, module } = await loadMaintenanceModule({
        records: [{ id: version }],
        metadataEntries,
      });

      await expect(
        module.initializePaletteStorage({
          polaroidRenderSettings: { footerLabel: "frozen" },
        }),
      ).resolves.toEqual({ updatedCount: 0 });
      expect(modify).not.toHaveBeenCalled();
      expect(metadataPut).not.toHaveBeenCalled();
    }
  });

  test("a lower or corrupt marker reruns and replaces the maintenance record", async () => {
    for (const marker of [
      { key: MARKER_KEY, version: 0 },
      { key: MARKER_KEY, version: "1" },
    ]) {
      const metadataEntries = new Map([[MARKER_KEY, marker]]);
      const records = [{ id: 1 }];
      const { metadataPut, modify, module } = await loadMaintenanceModule({
        records,
        metadataEntries,
      });

      await expect(
        module.initializePaletteStorage({
          polaroidRenderSettings: { footerLabel: "frozen" },
        }),
      ).resolves.toEqual({ updatedCount: 1 });
      expect(modify).toHaveBeenCalledTimes(1);
      expect(metadataPut).toHaveBeenCalledTimes(1);
      expect(metadataEntries.get(MARKER_KEY)?.version).toBe(1);
    }
  });

  test("an interrupted transaction rolls back the marker and permits a retry", async () => {
    const failure = new DOMException("transaction aborted", "AbortError");
    const records = [{ id: 1, polaroidRenderSettings: null }];
    const metadataEntries = new Map();
    const { metadataPut, modify, module, reportAppError, transaction } =
      await loadMaintenanceModule({
        records,
        metadataEntries,
        transactionFailures: [failure],
      });

    await expect(
      module.initializePaletteStorage({
        polaroidRenderSettings: { footerLabel: "frozen" },
      }),
    ).rejects.toBe(failure);
    expect(records[0].polaroidRenderSettings).toBeNull();
    expect(metadataEntries.has(MARKER_KEY)).toBe(false);
    expect(reportAppError).toHaveBeenCalledTimes(1);

    await expect(
      module.initializePaletteStorage({
        polaroidRenderSettings: { footerLabel: "frozen" },
      }),
    ).resolves.toEqual({ updatedCount: 1 });
    expect(records[0].polaroidRenderSettings).toEqual({ footerLabel: "frozen" });
    expect(metadataEntries.get(MARKER_KEY)?.version).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(modify).toHaveBeenCalledTimes(2);
    expect(metadataPut).toHaveBeenCalledTimes(2);
  });

  test("explicit orphan repair deletes only unreachable master and preview keys", async () => {
    const { deletedAssetKeys, deletedPreviewKeys, module } = await loadMaintenanceModule({
      records: [{ id: 1 }, { id: 2, hasPhotoAsset: false }],
      assetKeys: [1, 2, 3, 99],
      previewKeys: [
        [1, "gallery"],
        [2, "viewer"],
        [4, "gallery"],
        [100, "viewer"],
      ],
    });

    await expect(module.pruneOrphanPaletteAssets()).resolves.toEqual({
      deletedCount: 2,
      deletedPreviewCount: 2,
    });
    expect(deletedAssetKeys).toEqual([3, 99]);
    expect(deletedPreviewKeys).toEqual([
      [4, "gallery"],
      [100, "viewer"],
    ]);
  });

  test("explicit orphan repair remains compatible before the preview store exists", async () => {
    const { deletedAssetKeys, deletedPreviewKeys, module } = await loadMaintenanceModule({
      records: [{ id: 1 }, { id: 2 }],
      assetKeys: [1, 2],
      hasPreviewTable: false,
    });

    await expect(module.pruneOrphanPaletteAssets()).resolves.toEqual({
      deletedCount: 0,
      deletedPreviewCount: 0,
    });
    expect(deletedAssetKeys).toEqual([]);
    expect(deletedPreviewKeys).toEqual([]);
  });
});
