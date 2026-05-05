import { afterEach, describe, expect, mock, test } from "bun:test";

const backupModuleUrl = new URL("./backup.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const jsonTransferModuleUrl = new URL("./json-transfer.js", import.meta.url).href;
const paletteJsonWorkerModuleUrl = new URL("../modules/palette-json-worker.js", import.meta.url)
  .href;
const recordsModuleUrl = new URL("./records.js", import.meta.url).href;
const storageAssetsModuleUrl = new URL("./assets.js", import.meta.url).href;

async function loadBackupModule({ importedPalettes = [] } = {}) {
  const add = mock(async () => 101);
  const put = mock(async () => {});
  const transaction = mock(async (_mode, _palettes, _paletteAssets, callback) => callback());
  const importPalettes = mock(() => null);
  const isEnabled = mock(() => false);
  const deserializePalettesFromImport = mock(async () => importedPalettes);
  const createPaletteAssetRecord = mock((paletteId, photoBlob) => ({
    paletteId,
    photoBlob,
  }));
  const createPaletteMetadataRecord = mock((record) => record);

  mock.module(paletteJsonWorkerModuleUrl, () => ({
    createPaletteJsonWorkerController: mock(() => ({
      exportPalettes: mock(() => null),
      importPalettes,
      isEnabled,
    })),
  }));

  mock.module(storageAssetsModuleUrl, () => ({
    readPalettePhotoBlobById: mock(async () => null),
  }));

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: {
        add,
        toArray: mock(async () => []),
      },
      paletteAssets: {
        put,
      },
    },
  }));

  mock.module(jsonTransferModuleUrl, () => ({
    deserializePalettesFromImport,
    serializePalettesForExport: mock(async () => "{}"),
  }));

  mock.module(recordsModuleUrl, () => ({
    createPaletteAssetRecord,
    createPaletteMetadataRecord,
    normalizeStoredPaletteRecord: mock((record) => record),
  }));

  const backupModule = await import(`${backupModuleUrl}?test=${Math.random()}`);

  return {
    add,
    backupModule,
    createPaletteAssetRecord,
    createPaletteMetadataRecord,
    deserializePalettesFromImport,
    put,
    transaction,
  };
}

afterEach(() => {
  mock.restore();
});

describe("palette-storage/backup importAllPalettes", () => {
  test("imports palettes with a photo blob as persisted photo assets", async () => {
    const photoBlob = new Blob(["photo"], { type: "image/webp" });
    const { add, backupModule, createPaletteMetadataRecord, put } = await loadBackupModule({
      importedPalettes: [
        {
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          photoBlob,
        },
      ],
    });

    const importedCount = await backupModule.importAllPalettes("{}");

    expect(importedCount).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toEqual({
      paletteId: 101,
      photoBlob,
    });
    expect(createPaletteMetadataRecord.mock.calls[0][0].hasPhotoAsset).toBe(true);
  });

  test("rejects imported palettes that do not include photo data", async () => {
    const { add, backupModule, put, transaction } = await loadBackupModule({
      importedPalettes: [
        {
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
        },
      ],
    });

    await expect(backupModule.importAllPalettes("{}")).rejects.toThrow(
      "Cannot import palette 1 without photo data.",
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
