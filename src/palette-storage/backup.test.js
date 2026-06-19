import { afterEach, describe, expect, mock, test } from "bun:test";

const backupModuleUrl = new URL("./backup.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const paletteJsonWorkerModuleUrl = new URL("../modules/palette-json-worker.js", import.meta.url)
  .href;
const recordsModuleUrl = new URL("./records.js", import.meta.url).href;
const storageAssetsModuleUrl = new URL("./assets.js", import.meta.url).href;

async function loadBackupModule({
  photoBlobsById = new Map(),
  storedPalettes = [],
  workerExportBlobResult = null,
} = {}) {
  const add = mock(async () => 101);
  const put = mock(async () => {});
  const transaction = mock(async (_mode, _palettes, _paletteAssets, callback) => callback());
  const exportPalettes = mock(() => null);
  const exportPalettesBlob = mock(() => workerExportBlobResult);
  const importPalettes = mock(() => null);
  const isEnabled = mock(() => false);
  const createPaletteAssetRecord = mock((paletteId, photoBlob) => ({
    paletteId,
    photoBlob,
  }));
  const createPaletteMetadataRecord = mock((record) => record);

  mock.module(paletteJsonWorkerModuleUrl, () => ({
    createPaletteJsonWorkerController: mock(() => ({
      exportPalettes,
      exportPalettesBlob,
      importPalettes,
      isEnabled,
    })),
  }));

  mock.module(storageAssetsModuleUrl, () => ({
    readPalettePhotoBlobById: mock(async (paletteId) => photoBlobsById.get(paletteId) ?? null),
  }));

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: {
        add,
        toArray: mock(async () => storedPalettes),
      },
      paletteAssets: {
        put,
      },
    },
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
    exportPalettes,
    exportPalettesBlob,
    put,
    transaction,
  };
}

afterEach(() => {
  mock.restore();
});

describe("palette-storage/backup exportAllPalettesBlob", () => {
  test("exports a json blob and reports actual serialization progress", async () => {
    const photoBlob = new Blob(["photo"], { type: "image/jpeg" });
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
});

describe("palette-storage/backup importAllPalettes", () => {
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
            photoBlob: "data:image/webp;base64,cGhvdG8=",
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
    expect(await persistedPhotoBlob.text()).toBe("photo");
    expect(createPaletteMetadataRecord.mock.calls[0][0].hasPhotoAsset).toBe(true);
    expect(createPaletteMetadataRecord.mock.calls[0][0].polaroidRenderSettings).toEqual({
      footerLabel: "captured footer",
      showColorNames: true,
    });
    expect(createPaletteMetadataRecord.mock.calls[0][0].polaroidColorNames).toEqual([
      "Stored red",
      "Stored green",
      "Stored blue",
    ]);
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
});
