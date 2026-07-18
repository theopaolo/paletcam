import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
  PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
  PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
  serializePalettesForExport,
} from "./json-transfer.js";

const backupModuleUrl = new URL("./backup.js", import.meta.url).href;
const appTerminalLifecycleModuleUrl = new URL(
  "../modules/app-terminal-lifecycle.js",
  import.meta.url,
).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const importStagingModuleUrl = new URL("./import-staging.js", import.meta.url).href;
const paletteJsonWorkerModuleUrl = new URL("../modules/palette-json-worker.js", import.meta.url)
  .href;
const recordsModuleUrl = new URL("./records.js", import.meta.url).href;
let activeWorkerImportResult = null;
const VALID_JPEG_BLOB = new Blob([Buffer.from("/9j/wAARCAABAAEDAREAAhEAAxEA/9k=", "base64")], {
  type: "image/jpeg",
});
const VALID_WEBP_BLOB = new Blob(
  [
    Buffer.from(
      "UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
      "base64",
    ),
  ],
  { type: "image/webp" },
);

async function loadBackupModule({
  failAssetPutAt = 0,
  photoBlobsById = new Map(),
  galleryPreviewsById = new Map(),
  storedPalettes = [],
  viewerPreviewsById = new Map(),
  workerExportBlobResult = null,
  workerImportResult = null,
} = {}) {
  activeWorkerImportResult = workerImportResult;
  const persistedAssets = new Map();
  const persistedPalettes = new Map();
  let nextPaletteId = 101;
  let assetPutCount = 0;
  const add = mock(async (record) => {
    const paletteId = nextPaletteId++;
    persistedPalettes.set(paletteId, record);
    return paletteId;
  });
  const put = mock(async (record) => {
    assetPutCount += 1;
    if (failAssetPutAt > 0 && assetPutCount === failAssetPutAt) {
      throw new DOMException("Injected asset write failure", "QuotaExceededError");
    }
    persistedAssets.set(record.paletteId, record);
  });
  const transaction = mock(async (...args) => {
    const paletteSnapshot = new Map(persistedPalettes);
    const assetSnapshot = new Map(persistedAssets);
    try {
      return await args.at(-1)();
    } catch (error) {
      persistedPalettes.clear();
      paletteSnapshot.forEach((value, key) => {
        persistedPalettes.set(key, value);
      });
      persistedAssets.clear();
      assetSnapshot.forEach((value, key) => {
        persistedAssets.set(key, value);
      });
      throw error;
    }
  });
  const exportPalettes = mock(() => null);
  const exportPalettesBlob = mock(() => workerExportBlobResult);
  const importPalettes = mock(() => activeWorkerImportResult);
  const isEnabled = mock(() => false);
  const destroyWorker = mock(() => {});
  const registerAppTermination = mock(() => () => true);
  const createPaletteAssetRecord = mock((paletteId, photoBlob) => ({
    paletteId,
    photoBlob,
  }));
  const createPaletteMetadataRecord = mock((record) => record);
  let stagedPalettes = [];
  const beginImportSession = mock(async () => "test-import-session");
  const stageImportBatch = mock(async (_sessionId, palettes) => {
    palettes.forEach((palette, index) => {
      if (!(palette?.photoBlob instanceof Blob)) {
        throw new Error(`Cannot import palette ${index + 1} without photo data.`);
      }
    });
    stagedPalettes.push(...palettes);
    return stagedPalettes.length;
  });
  const commitImportSession = mock(async (_sessionId, fallbackRenderSettings) => {
    await transaction("rw", paletteTable, paletteAssetTable, async () => {
      for (const palette of stagedPalettes) {
        const { photoBlob, ...paletteMetadata } = palette;
        const paletteId = await add(
          createPaletteMetadataRecord({
            ...paletteMetadata,
            polaroidRenderSettings:
              paletteMetadata.polaroidRenderSettings ?? fallbackRenderSettings,
            hasPhotoAsset: true,
          }),
        );
        await put(createPaletteAssetRecord(paletteId, photoBlob));
      }
    });
    const importedCount = stagedPalettes.length;
    stagedPalettes = [];
    return importedCount;
  });
  const abortImportSession = mock(async () => {
    stagedPalettes = [];
    return true;
  });

  mock.module(paletteJsonWorkerModuleUrl, () => ({
    createPaletteJsonWorkerController: mock(() => ({
      destroy: destroyWorker,
      exportPalettes,
      exportPalettesBlob,
      importPalettes,
      isEnabled,
    })),
  }));
  mock.module(appTerminalLifecycleModuleUrl, () => ({ registerAppTermination }));

  const paletteAssetBulkGet = mock(async (paletteIds) =>
    paletteIds.map((paletteId) => {
      const photoBlob = photoBlobsById.get(paletteId);
      return photoBlob instanceof Blob ? { paletteId, photoBlob } : undefined;
    }),
  );
  const palettePreviewBulkGet = mock(async (keys) =>
    keys.map(([paletteId, variant]) => {
      const source = variant === "gallery" ? galleryPreviewsById : viewerPreviewsById;
      const preview = source.get(paletteId);
      return preview?.blob instanceof Blob ? { paletteId, variant, ...preview } : undefined;
    }),
  );
  const paletteTable = {
    add,
    toArray: mock(async () => storedPalettes),
  };
  const paletteAssetTable = {
    bulkGet: paletteAssetBulkGet,
    put,
  };
  const palettePreviewTable = {
    bulkGet: palettePreviewBulkGet,
  };

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: paletteTable,
      paletteAssets: paletteAssetTable,
      palettePreviews: palettePreviewTable,
    },
  }));

  mock.module(recordsModuleUrl, () => ({
    createPaletteAssetRecord,
    createPaletteMetadataRecord,
    normalizeStoredPaletteRecord: mock((record) => record),
  }));

  mock.module(importStagingModuleUrl, () => ({
    abortImportSession,
    beginImportSession,
    commitImportSession,
    PALETTE_IMPORT_STAGING_BATCH_SIZE: 25,
    stageImportBatch,
  }));

  const backupModule = await import(`${backupModuleUrl}?test=${Math.random()}`);

  return {
    add,
    abortImportSession,
    backupModule,
    beginImportSession,
    commitImportSession,
    createPaletteAssetRecord,
    createPaletteMetadataRecord,
    destroyWorker,
    exportPalettes,
    exportPalettesBlob,
    importPalettes,
    paletteAssetBulkGet,
    paletteAssetTable,
    palettePreviewBulkGet,
    palettePreviewTable,
    paletteTable,
    persistedAssets,
    persistedPalettes,
    put,
    registerAppTermination,
    stageImportBatch,
    transaction,
  };
}

afterEach(() => {
  activeWorkerImportResult = null;
  mock.restore();
});

describe("palette-storage/backup exportAllPalettesBlob", () => {
  test("exports a json blob and reports actual serialization progress", async () => {
    const photoBlob = VALID_JPEG_BLOB;
    const progressEvents = [];
    const { backupModule } = await loadBackupModule({
      photoBlobsById: new Map([[42, photoBlob]]),
      storedPalettes: [
        {
          id: 42,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
        },
      ],
    });

    const result = await backupModule.exportAllPalettesBlob({
      onProgress: (progress) => progressEvents.push(progress),
    });
    const payload = JSON.parse(await result.text());

    expect(result).toBeInstanceOf(Blob);
    expect(payload.version).toBe(2);
    expect(payload.palettes[0].photoBlob.startsWith("data:image/jpeg")).toBe(true);
    expect(progressEvents.map((progress) => progress.phase)).toContain("preparing");
    expect(progressEvents.map((progress) => progress.phase)).toContain("serializing");
    expect(progressEvents.at(-1).phase).toBe("finalizing");
  });

  test("never returns a string or Blob backup larger than the matching import contract", async () => {
    const storedPalette = {
      id: 42,
      timestamp: "2026-05-01T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      note: "contract 🎨",
    };
    const photoBlob = VALID_JPEG_BLOB;
    const baseline = await serializePalettesForExport([{ ...storedPalette, photoBlob }]);
    const exactBytes = new TextEncoder().encode(baseline).byteLength;
    const { backupModule } = await loadBackupModule({
      photoBlobsById: new Map([[42, photoBlob]]),
      storedPalettes: [storedPalette],
    });

    await expect(
      backupModule.exportAllPalettes({ maxJsonBytes: exactBytes - 1 }),
    ).rejects.toMatchObject({ code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE });
    await expect(
      backupModule.exportAllPalettesBlob({ maxJsonBytes: exactBytes - 1 }),
    ).rejects.toMatchObject({ code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE });

    const exactString = await backupModule.exportAllPalettes({ maxJsonBytes: exactBytes });
    const exactBlob = await backupModule.exportAllPalettesBlob({ maxJsonBytes: exactBytes });
    expect(new TextEncoder().encode(exactString).byteLength).toBe(exactBytes);
    expect(exactBlob.size).toBe(exactBytes);
  });

  test("rejects a missing master photo instead of substituting a derived preview", async () => {
    const viewerPreview = VALID_WEBP_BLOB;
    const {
      backupModule,
      paletteAssetBulkGet,
      paletteAssetTable,
      palettePreviewBulkGet,
      paletteTable,
      transaction,
    } = await loadBackupModule({
      storedPalettes: [
        {
          id: 42,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
        },
      ],
      viewerPreviewsById: new Map([[42, { blob: viewerPreview, footerLabel: "viewer-v1" }]]),
    });

    await expect(backupModule.exportAllPalettes()).rejects.toMatchObject({
      code: PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
    });

    expect(transaction.mock.calls[0][0]).toBe("r");
    expect(transaction.mock.calls[0]).toHaveLength(4);
    expect(transaction.mock.calls[0].slice(1, 3)).toEqual([paletteTable, paletteAssetTable]);
    expect(paletteAssetBulkGet).toHaveBeenCalledWith([42]);
    expect(palettePreviewBulkGet).not.toHaveBeenCalled();
  });

  test("keeps snapshot asset reads bounded for maximum-size collections", async () => {
    const storedPalettes = Array.from({ length: 53 }, (_, index) => ({
      id: index + 1,
      timestamp: "2026-05-01T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
    }));
    const photoBlobsById = new Map(storedPalettes.map(({ id }) => [id, VALID_JPEG_BLOB]));
    const { backupModule, paletteAssetBulkGet, palettePreviewBulkGet } = await loadBackupModule({
      photoBlobsById,
      storedPalettes,
    });

    const payload = JSON.parse(await backupModule.exportAllPalettes());

    expect(payload.palettes).toHaveLength(53);
    expect(paletteAssetBulkGet.mock.calls.map(([keys]) => keys.length)).toEqual([25, 25, 3]);
    expect(palettePreviewBulkGet).not.toHaveBeenCalled();
  });

  test("rejects before serialization when a palette has no restorable photo source", async () => {
    const { backupModule, exportPalettes, exportPalettesBlob } = await loadBackupModule({
      storedPalettes: [
        {
          id: 42,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
        },
      ],
    });

    await expect(backupModule.exportAllPalettes()).rejects.toMatchObject({
      code: PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
      message: "Cannot export palette 1 without its master photo data.",
    });
    await expect(backupModule.exportAllPalettesBlob()).rejects.toMatchObject({
      code: PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
      message: "Cannot export palette 1 without its master photo data.",
    });
    expect(exportPalettes).not.toHaveBeenCalled();
    expect(exportPalettesBlob).not.toHaveBeenCalled();
  });

  test("rejects an excessive collection before reading any Blob assets", async () => {
    const storedPalettes = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }));
    const { backupModule, paletteAssetBulkGet, palettePreviewBulkGet } = await loadBackupModule({
      storedPalettes,
    });

    await expect(backupModule.exportAllPalettes()).rejects.toMatchObject({
      code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
      message: "A restorable backup can contain at most 2000 palettes.",
    });
    expect(paletteAssetBulkGet).not.toHaveBeenCalled();
    expect(palettePreviewBulkGet).not.toHaveBeenCalled();
  });
});

describe("palette-storage/backup importAllPalettes", () => {
  test("rejects an oversized Blob before starting worker or fallback parsing", async () => {
    const { backupModule, transaction } = await loadBackupModule();
    const oversizedBlob = Object.create(Blob.prototype);
    Object.defineProperty(oversizedBlob, "size", {
      value: PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES + 1,
    });

    await expect(backupModule.importAllPalettes(oversizedBlob)).rejects.toMatchObject({
      code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
      message: "Palette backup exceeds the import size limit.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  test("rejects oversized multibyte strings before cloning them to a worker", async () => {
    const { backupModule, beginImportSession, importPalettes } = await loadBackupModule();
    const oversizedString = "ࠀ".repeat(Math.floor((32 * 1024 * 1024) / 3) + 1);

    await expect(backupModule.importAllPalettes(oversizedString)).rejects.toMatchObject({
      code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
    });
    expect(beginImportSession).not.toHaveBeenCalled();
    expect(importPalettes).not.toHaveBeenCalled();
  });

  test("imports palettes with a photo blob as persisted photo assets", async () => {
    const { add, backupModule, createPaletteMetadataRecord, put } = await loadBackupModule();

    const importedCount = await backupModule.importAllPalettes(
      JSON.stringify({
        version: 2,
        palettes: [
          {
            timestamp: "2026-05-01T10:00:00.000Z",
            colors: [{ r: 1, g: 2, b: 3 }],
            polaroidRenderSettings: {
              footerLabel: "captured footer",
              showColorNames: true,
            },
            polaroidColorNames: ["Stored red", "Stored green", "Stored blue"],
            photoBlob:
              "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
          },
        ],
      }),
    );
    const persistedPhotoBlob = put.mock.calls[0][0].photoBlob;

    expect(importedCount).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toEqual({
      paletteId: 101,
      photoBlob: persistedPhotoBlob,
    });
    expect(persistedPhotoBlob).toBeInstanceOf(Blob);
    expect(persistedPhotoBlob.type).toBe("image/webp");
    expect(persistedPhotoBlob.size).toBe(72);
    expect(createPaletteMetadataRecord.mock.calls[0][0].hasPhotoAsset).toBe(true);
    expect(createPaletteMetadataRecord.mock.calls[0][0].polaroidRenderSettings).toEqual({
      footerLabel: "captured footer",
      showColorNames: true,
    });
    // Legacy backup field, dropped on import since the color-names feature was removed.
    expect(createPaletteMetadataRecord.mock.calls[0][0].polaroidColorNames).toBeUndefined();
  });

  test("collects and stages nonempty string results returned by an enabled worker", async () => {
    const normalizedPalette = {
      timestamp: "2026-05-01T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      photoBlob: VALID_WEBP_BLOB,
    };
    const { backupModule, stageImportBatch } = await loadBackupModule({
      workerImportResult: Promise.resolve({ palettes: [normalizedPalette] }),
    });

    expect(await backupModule.importAllPalettes(JSON.stringify({ version: 2, palettes: [] }))).toBe(
      1,
    );
    expect(stageImportBatch).toHaveBeenCalledWith("test-import-session", [normalizedPalette]);
  });

  test("accepts a Blob source so normal imports avoid a main-thread string clone", async () => {
    const { backupModule, createPaletteMetadataRecord } = await loadBackupModule();
    const source = new Blob(
      [
        JSON.stringify({
          version: 2,
          palettes: [
            {
              timestamp: "2026-05-01T10:00:00.000Z",
              colors: [{ r: 1, g: 2, b: 3 }],
              photoBlob:
                "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
            },
          ],
        }),
      ],
      { type: "application/json" },
    );

    expect(await backupModule.importAllPalettes(source)).toBe(1);
    expect(createPaletteMetadataRecord.mock.calls[0][0].polaroidRenderSettings).toEqual({
      footerLabel: "colorcatchers.co",
    });
  });

  test("streams and imports a legacy-size collection without materializing the whole Blob", async () => {
    const { backupModule, commitImportSession, stageImportBatch } = await loadBackupModule();
    const photoBlob =
      "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA";
    const source = new Blob([
      JSON.stringify({
        version: 2,
        palettes: Array.from({ length: 193 }, (_, index) => ({
          timestamp: new Date(Date.UTC(2026, 6, 13, 11, 10, index)).toISOString(),
          colors: [{ r: index % 256, g: 2, b: 3 }],
          photoBlob,
        })),
      }),
    ]);
    Object.defineProperty(source, "text", {
      value: mock(() => {
        throw new Error("Blob.text() must not be used by the streaming import path.");
      }),
    });

    expect(await backupModule.importAllPalettes(source)).toBe(193);
    expect(stageImportBatch).toHaveBeenCalledTimes(97);
    expect(commitImportSession).toHaveBeenCalledTimes(1);
  });

  test("aborts provisional batches when trailing JSON validation fails", async () => {
    const { abortImportSession, backupModule, commitImportSession, stageImportBatch } =
      await loadBackupModule();
    const source = new Blob([
      `${JSON.stringify({
        version: 2,
        palettes: [
          {
            timestamp: "2026-05-01T10:00:00.000Z",
            colors: [{ r: 1, g: 2, b: 3 }],
            photoBlob:
              "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
          },
        ],
      })} trailing`,
    ]);

    await expect(backupModule.importAllPalettes(source)).rejects.toThrow(
      "Unexpected trailing data in palette backup.",
    );
    expect(stageImportBatch).toHaveBeenCalledTimes(1);
    expect(commitImportSession).not.toHaveBeenCalled();
    expect(abortImportSession).toHaveBeenCalledTimes(1);
  });

  test("rejects imported palettes that do not include photo data", async () => {
    const { add, backupModule, put, transaction } = await loadBackupModule();

    await expect(
      backupModule.importAllPalettes(
        JSON.stringify({
          version: 2,
          palettes: [
            {
              timestamp: "2026-05-01T10:00:00.000Z",
              colors: [{ r: 1, g: 2, b: 3 }],
            },
          ],
        }),
      ),
    ).rejects.toThrow("Cannot import palette 1 without photo data.");
    expect(transaction).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test("rolls back every palette when an asset write fails midway through import", async () => {
    const { backupModule, persistedAssets, persistedPalettes, transaction } =
      await loadBackupModule({ failAssetPutAt: 2 });
    const importedPalette = {
      timestamp: "2026-05-01T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      photoBlob:
        "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
    };

    await expect(
      backupModule.importAllPalettes(
        JSON.stringify({ version: 2, palettes: [importedPalette, importedPalette] }),
      ),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(persistedPalettes.size).toBe(0);
    expect(persistedAssets.size).toBe(0);
  });
});
