import { afterEach, describe, expect, mock, test } from "bun:test";

const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const palettePreviewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;
const palettePreviewPersistenceModuleUrl = new URL(
  "./palette-preview-persistence.js",
  import.meta.url,
).href;

const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

async function loadPalettePreviewAssets({
  storedPreviewBlob = null,
  masterPhotoBlob = new Blob(["master"], { type: "image/webp" }),
  renderedPreviewBlob = new Blob(["preview"], { type: "image/webp" }),
} = {}) {
  const ensurePaletteMasterPhotoBlob = mock(async () => masterPhotoBlob);
  const getCurrentPalettePreviewFooterLabel = mock(() => "preview-v5:test:names-on");
  const getStoredPalettePreviewBlob = mock(
    (palette) => palette?.previewBlob instanceof Blob ? palette.previewBlob : storedPreviewBlob,
  );
  const persistSavedPalettePreviewBlob = mock(async (palette, previewBlob, previewFooterLabel) => {
    palette.previewBlob = previewBlob;
    palette.previewFooterLabel = previewFooterLabel;
    return previewBlob;
  });
  const renderPalettePreviewBlobFromMasterPhoto = mock(async () => renderedPreviewBlob);

  mock.module(paletteStorageModuleUrl, () => ({
    ensurePaletteMasterPhotoBlob,
  }));

  mock.module(palettePreviewPersistenceModuleUrl, () => ({
    getCurrentPalettePreviewFooterLabel,
    getStoredPalettePreviewBlob,
    persistSavedPalettePreviewBlob,
    renderPalettePreviewBlobFromMasterPhoto,
  }));
  const palettePreviewAssets = await import(
    `${palettePreviewAssetsModuleUrl}?test=${Math.random()}`
  );

  return {
    ensurePaletteMasterPhotoBlob,
    getStoredPalettePreviewBlob,
    palettePreviewAssets,
    persistSavedPalettePreviewBlob,
    renderPalettePreviewBlobFromMasterPhoto,
  };
}

afterEach(() => {
  mock.restore();
  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("getPalettePreviewPolaroidAsset", () => {
  test("reuses the stored preview blob without hydrating the master photo", async () => {
    const storedPreviewBlob = new Blob(["stored-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:stored-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { ensurePaletteMasterPhotoBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlob,
    });

    const asset = await palettePreviewAssets.getPalettePreviewPolaroidAsset({
      id: 7,
      hasPhotoAsset: true,
    });

    expect(asset).toEqual({
      blob: storedPreviewBlob,
      objectUrl: "blob:stored-preview",
    });
    expect(createObjectURL).toHaveBeenCalledWith(storedPreviewBlob);
    expect(ensurePaletteMasterPhotoBlob).not.toHaveBeenCalled();
  });

  test("renders and persists a preview blob when only the master photo exists", async () => {
    const renderedPreviewBlob = new Blob(["rendered-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:rendered-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const {
      ensurePaletteMasterPhotoBlob,
      palettePreviewAssets,
      persistSavedPalettePreviewBlob,
      renderPalettePreviewBlobFromMasterPhoto,
    } = await loadPalettePreviewAssets({
      storedPreviewBlob: null,
      renderedPreviewBlob,
    });

    const palette = { id: 11, hasPhotoAsset: true };
    const asset = await palettePreviewAssets.getPalettePreviewPolaroidAsset(palette);

    expect(ensurePaletteMasterPhotoBlob).toHaveBeenCalledTimes(1);
    expect(renderPalettePreviewBlobFromMasterPhoto).toHaveBeenCalledTimes(1);
    expect(persistSavedPalettePreviewBlob).toHaveBeenCalledTimes(1);
    expect(asset.blob).toBe(renderedPreviewBlob);
    expect(asset.objectUrl).toBe("blob:rendered-preview");
    expect(palette.previewBlob).toBe(renderedPreviewBlob);
  });

  test("does not fall back to the full master photo blob when preview rendering fails", async () => {
    const createObjectURL = mock(() => "blob:should-not-exist");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { palettePreviewAssets, renderPalettePreviewBlobFromMasterPhoto } =
      await loadPalettePreviewAssets({
        storedPreviewBlob: null,
        renderedPreviewBlob: null,
      });

    expect(renderPalettePreviewBlobFromMasterPhoto).toHaveBeenCalledTimes(0);

    let thrownError = null;
    try {
      await palettePreviewAssets.getPalettePreviewPolaroidAsset({ id: 19, hasPhotoAsset: true });
    } catch (error) {
      thrownError = error;
    }

    expect(renderPalettePreviewBlobFromMasterPhoto).toHaveBeenCalledTimes(1);
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toBe("Unable to generate palette preview");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
