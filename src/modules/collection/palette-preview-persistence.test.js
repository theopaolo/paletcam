import { afterEach, describe, expect, mock, test } from "bun:test";

import { resetAppSettingsForTests, updateAppSettings } from "../../app-settings.js";

const colorNameApiModuleUrl = new URL("../color-name-api.js", import.meta.url).href;
const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const palettePersistenceModuleUrl = new URL("./palette-preview-persistence.js", import.meta.url)
  .href;
const paletteRendererModuleUrl = new URL("./palette-polaroid-renderer.js", import.meta.url).href;

async function loadPreviewPersistence({
  masterPhotoBlob = new Blob(["master"], { type: "image/webp" }),
  previewBlob = new Blob(["preview"], { type: "image/webp" }),
  colorNames = ["Stored olive", "White"],
  updatePreviewError = null,
} = {}) {
  const ensurePaletteMasterPhotoBlob = mock(async () => masterPhotoBlob);
  const updatePalettePolaroidColorNames = mock(async () => undefined);
  const updatePalettePreviewBlob = mock(async () => {
    if (updatePreviewError) {
      throw updatePreviewError;
    }
    return undefined;
  });
  const getColorNames = mock(async () => colorNames);
  const renderPalettePolaroidBlob = mock(async () => previewBlob);

  mock.module(paletteStorageModuleUrl, () => ({
    ensurePaletteMasterPhotoBlob,
    updatePalettePolaroidColorNames,
    updatePalettePreviewBlob,
  }));

  mock.module(colorNameApiModuleUrl, () => ({
    getColorNames,
  }));

  mock.module(paletteRendererModuleUrl, () => ({
    getPalettePreviewImageMimeType: mock(() => "image/webp"),
    renderPalettePolaroidBlob,
  }));

  const module = await import(`${palettePersistenceModuleUrl}?test=${Math.random()}`);

  return {
    ensurePaletteMasterPhotoBlob,
    getColorNames,
    module,
    renderPalettePolaroidBlob,
    updatePalettePolaroidColorNames,
    updatePalettePreviewBlob,
  };
}

afterEach(() => {
  resetAppSettingsForTests();
  mock.restore();
});

describe("palette preview persistence", () => {
  test("uses per-palette render settings for stable preview fingerprints", async () => {
    updateAppSettings({ polaroidFooterLabel: "global", polaroidShowColorNames: false });
    const { module } = await loadPreviewPersistence();
    const blob = new Blob(["gallery"], { type: "image/webp" });
    const palette = {
      id: 1,
      polaroidRenderSettings: { footerLabel: "captured", showColorNames: true },
      previewGalleryBlob: blob,
      previewGalleryFooterLabel: module.getPalettePreviewFingerprint(
        {
          polaroidRenderSettings: { footerLabel: "captured", showColorNames: true },
        },
        "gallery",
      ),
    };

    updateAppSettings({ polaroidFooterLabel: "changed", polaroidShowColorNames: false });

    expect(module.getStoredPalettePreviewBlob(palette, "gallery")).toBe(blob);
  });

  test("does not persist newly rendered viewer previews", async () => {
    const { module, renderPalettePolaroidBlob, updatePalettePreviewBlob } =
      await loadPreviewPersistence();
    const palette = {
      id: 2,
      colors: [{ r: 1, g: 2, b: 3 }],
      hasPhotoAsset: true,
      polaroidRenderSettings: { footerLabel: "captured", showColorNames: false },
    };

    const blob = await module.ensureSavedPalettePreviewBlob(palette, "viewer");

    expect(blob).toBeInstanceOf(Blob);
    expect(renderPalettePolaroidBlob).toHaveBeenCalledTimes(1);
    expect(updatePalettePreviewBlob).not.toHaveBeenCalled();
  });

  test("returns rendered gallery previews when preview persistence fails", async () => {
    const previewBlob = new Blob(["preview"], { type: "image/webp" });
    const { module, updatePalettePreviewBlob } = await loadPreviewPersistence({
      previewBlob,
      updatePreviewError: new Error("IndexedDB rejected preview blob"),
    });
    const palette = {
      id: 3,
      colors: [{ r: 1, g: 2, b: 3 }],
      hasPhotoAsset: true,
      polaroidRenderSettings: { footerLabel: "captured", showColorNames: false },
    };

    const blob = await module.ensureSavedPalettePreviewBlob(palette, "gallery");

    expect(blob).toBe(previewBlob);
    expect(updatePalettePreviewBlob).toHaveBeenCalledTimes(1);
    expect(palette.previewGalleryBlob).toBeUndefined();
  });

  test("skips color-name persistence while the polaroid label feature is paused", async () => {
    const { getColorNames, module, updatePalettePolaroidColorNames } =
      await loadPreviewPersistence();
    const palette = {
      id: 3,
      colors: [
        { r: 151, g: 157, b: 26 },
        { r: 255, g: 255, b: 255 },
      ],
      polaroidRenderSettings: { footerLabel: "captured", showColorNames: true },
    };

    const firstResult = await module.ensurePalettePolaroidColorNames(palette);
    const secondResult = await module.ensurePalettePolaroidColorNames(palette);

    expect(firstResult).toEqual([]);
    expect(secondResult).toEqual([]);
    expect(getColorNames).not.toHaveBeenCalled();
    expect(updatePalettePolaroidColorNames).not.toHaveBeenCalled();
    expect(palette.polaroidColorNames).toBeUndefined();
  });
});
