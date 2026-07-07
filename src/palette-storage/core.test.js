import { afterEach, describe, expect, mock, test } from "bun:test";

import { resetAppSettingsForTests, updateAppSettings } from "../app-settings.js";

const coreModuleUrl = new URL("./core.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;

async function loadCoreModule({ storedPalettes = [] } = {}) {
  const add = mock(async () => 101);
  const bulkPut = mock(async () => {});
  const put = mock(async () => {});
  const update = mock(async () => 1);
  const transaction = mock(async (_mode, _palettes, _paletteAssets, callback) => callback());

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: {
        add,
        bulkPut,
        orderBy: mock(() => ({
          reverse: mock(() => ({
            toArray: mock(async () => storedPalettes),
          })),
        })),
        update,
      },
      paletteAssets: {
        put,
      },
    },
  }));

  const module = await import(`${coreModuleUrl}?test=${Math.random()}`);

  return {
    add,
    bulkPut,
    module,
    put,
    transaction,
    update,
  };
}

afterEach(() => {
  resetAppSettingsForTests();
  mock.restore();
});

describe("palette-storage/core", () => {
  test("freezes missing polaroid render settings when palettes are read", async () => {
    updateAppSettings({ polaroidFooterLabel: "captured" });
    const { bulkPut, module, update } = await loadCoreModule({
      storedPalettes: [
        {
          id: 7,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          previewViewerBlob: new Blob(["preview"], { type: "image/webp" }),
        },
      ],
    });

    const palettes = await module.getSavedPalettes();

    expect(palettes[0].polaroidRenderSettings).toEqual({
      footerLabel: "captured",
    });
    expect(update).toHaveBeenCalledWith(7, {
      polaroidRenderSettings: {
        footerLabel: "captured",
      },
    });
    expect(bulkPut).not.toHaveBeenCalled();
  });

  test("does not rewrite blob-bearing palette records when freezing read settings", async () => {
    const { bulkPut, module, update } = await loadCoreModule({
      storedPalettes: [
        {
          id: 8,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          previewGalleryBlob: new Blob(["preview"], { type: "image/webp" }),
        },
      ],
    });

    await module.getSavedPalettes();

    expect(update.mock.calls[0][1].polaroidRenderSettings).toEqual({
      footerLabel: "colorcatchers.co",
    });
    expect(bulkPut).not.toHaveBeenCalled();
  });

  test("stores current polaroid render settings on new captures", async () => {
    updateAppSettings({ polaroidFooterLabel: "new capture" });
    const { add, module } = await loadCoreModule();
    const photoBlob = new Blob(["photo"], { type: "image/webp" });

    await module.savePalette([{ r: 1, g: 2, b: 3 }], { photoBlob });

    expect(add.mock.calls[0][0].polaroidRenderSettings).toEqual({
      footerLabel: "new capture",
    });
  });
});
