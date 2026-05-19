import { afterEach, describe, expect, mock, test } from "bun:test";

const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const palettePreviewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;
const palettePreviewPersistenceModuleUrl = new URL(
  "./palette-preview-persistence.js",
  import.meta.url,
).href;
const palettePolaroidRendererModuleUrl = new URL("./palette-polaroid-renderer.js", import.meta.url)
  .href;

const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
const originalNavigator = globalThis.navigator;
let resetPreviewAssetCacheForTests = null;

async function loadPalettePreviewAssets({
  storedPreviewBlobs = { gallery: null, viewer: null },
  renderedPreviewBlobs = {
    gallery: new Blob(["gallery-preview"], { type: "image/webp" }),
    viewer: new Blob(["viewer-preview"], { type: "image/webp" }),
  },
  masterPhotoBlob = new Blob(["master"], { type: "image/webp" }),
  renderedHighQualityBlob = new Blob(["high-quality"], { type: "image/webp" }),
} = {}) {
  const ensurePaletteMasterPhotoBlob = mock(async () => masterPhotoBlob);
  const ensureSavedPalettePreviewBlob = mock(async (palette, variant = "viewer") => {
    const renderedPreviewBlob = renderedPreviewBlobs[variant] ?? null;
    if (variant === "gallery") {
      palette.previewGalleryBlob = renderedPreviewBlob;
    }
    return renderedPreviewBlob;
  });
  const renderSavedPalettePreviewBlob = mock(async (_palette, variant = "viewer") =>
    renderedPreviewBlobs[variant] ?? null
  );
  const ensurePalettePolaroidColorNames = mock(async () => []);
  const renderPalettePolaroidBlob = mock(async () => renderedHighQualityBlob);
  const getPalettePreviewFingerprint = mock((_palette, variant = "viewer") =>
    `preview-v6:${variant}:test:names-on`,
  );
  const getStoredPalettePreviewBlob = mock((palette, variant = "viewer") => {
    if (variant === "gallery") {
      return palette?.previewGalleryBlob instanceof Blob
        ? palette.previewGalleryBlob
        : storedPreviewBlobs.gallery;
    }

    return palette?.previewViewerBlob instanceof Blob
      ? palette.previewViewerBlob
      : storedPreviewBlobs.viewer;
  });

  mock.module(paletteStorageModuleUrl, () => ({
    ensurePaletteMasterPhotoBlob,
  }));
  mock.module(palettePolaroidRendererModuleUrl, () => ({
    getPalettePreviewImageMimeType: mock(() => "image/webp"),
    hasPaletteMasterPhoto: mock(() => true),
    renderPalettePolaroidBlob,
  }));

  mock.module(palettePreviewPersistenceModuleUrl, () => ({
    ensurePalettePolaroidColorNames,
    ensureSavedPalettePreviewBlob,
    getPalettePreviewFingerprint,
    getStoredPalettePreviewBlob,
    renderSavedPalettePreviewBlob,
  }));
  const palettePreviewAssets = await import(
    `${palettePreviewAssetsModuleUrl}?test=${Math.random()}`
  );
  resetPreviewAssetCacheForTests = palettePreviewAssets.resetPreviewAssetCacheForTests;

  return {
    ensurePaletteMasterPhotoBlob,
    ensurePalettePolaroidColorNames,
    ensureSavedPalettePreviewBlob,
    getStoredPalettePreviewBlob,
    palettePreviewAssets,
    renderSavedPalettePreviewBlob,
    renderPalettePolaroidBlob,
  };
}

afterEach(() => {
  resetPreviewAssetCacheForTests?.();
  resetPreviewAssetCacheForTests = null;
  mock.restore();
  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  if (originalNavigator === undefined) {
    delete globalThis.navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});

describe("getPaletteViewerPreviewAsset", () => {
  test("reuses the stored viewer preview blob without hydrating the master photo", async () => {
    const storedPreviewBlob = new Blob(["stored-viewer-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:stored-viewer-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { ensurePaletteMasterPhotoBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: storedPreviewBlob },
    });

    const asset = await palettePreviewAssets.getPaletteViewerPreviewAsset({
      id: 7,
      hasPhotoAsset: true,
    });

    expect(asset).toEqual({
      blob: storedPreviewBlob,
      objectUrl: "blob:stored-viewer-preview",
    });
    expect(createObjectURL).toHaveBeenCalledWith(storedPreviewBlob);
    expect(ensurePaletteMasterPhotoBlob).not.toHaveBeenCalled();
  });

  test("does not fall back to the master photo blob when viewer preview rendering fails", async () => {
    const createObjectURL = mock(() => "blob:should-not-exist");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const {
      ensureSavedPalettePreviewBlob,
      palettePreviewAssets,
      renderSavedPalettePreviewBlob,
    } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: null },
      renderedPreviewBlobs: {
        gallery: new Blob(["gallery-rendered-preview"], { type: "image/webp" }),
        viewer: null,
      },
    });

    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledTimes(0);

    let thrownError = null;
    try {
      await palettePreviewAssets.getPaletteViewerPreviewAsset({ id: 19, hasPhotoAsset: true });
    } catch (error) {
      thrownError = error;
    }

    expect(ensureSavedPalettePreviewBlob).not.toHaveBeenCalled();
    expect(renderSavedPalettePreviewBlob).toHaveBeenCalledTimes(1);
    expect(renderSavedPalettePreviewBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 19 }),
      "viewer",
    );
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toBe("Unable to generate palette preview");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("getPaletteGalleryPreviewAsset", () => {
  test("persists the requested gallery preview variant when only the master photo exists", async () => {
    const renderedPreviewBlob = new Blob(["gallery-rendered-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:gallery-rendered-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { ensureSavedPalettePreviewBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: null },
      renderedPreviewBlobs: {
        gallery: renderedPreviewBlob,
        viewer: new Blob(["viewer-rendered-preview"], { type: "image/webp" }),
      },
    });

    const palette = { id: 11, hasPhotoAsset: true };
    const asset = await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);

    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledTimes(1);
    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledWith(palette, "gallery");
    expect(asset.blob).toBe(renderedPreviewBlob);
    expect(asset.objectUrl).toBe("blob:gallery-rendered-preview");
    expect(palette.previewGalleryBlob).toBe(renderedPreviewBlob);
  });

  test("revokes the oldest object URL when the preview cache is full", async () => {
    let nextUrlId = 0;
    const revokedUrls = [];
    globalThis.URL.createObjectURL = mock(() => `blob:preview-${nextUrlId++}`);
    globalThis.URL.revokeObjectURL = mock((url) => {
      revokedUrls.push(url);
    });

    const { palettePreviewAssets } = await loadPalettePreviewAssets();

    for (let id = 1; id <= 25; id += 1) {
      await palettePreviewAssets.getPaletteGalleryPreviewAsset({
        id,
        hasPhotoAsset: true,
        previewGalleryBlob: new Blob([`preview-${id}`], { type: "image/webp" }),
      });
    }

    expect(revokedUrls).toContain("blob:preview-0");
  });
});

describe("variant helpers", () => {
  test("uses the gallery preview asset path for gallery surfaces", async () => {
    const renderedPreviewBlob = new Blob(["gallery-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:gallery-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { ensureSavedPalettePreviewBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: null },
      renderedPreviewBlobs: {
        gallery: renderedPreviewBlob,
        viewer: new Blob(["viewer-preview"], { type: "image/webp" }),
      },
    });

    const palette = { id: 23, hasPhotoAsset: true };
    const asset = await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);

    expect(asset).toEqual({
      blob: renderedPreviewBlob,
      objectUrl: "blob:gallery-preview",
    });
  });

  test("uses the viewer preview asset path for the overlay", async () => {
    const renderedPreviewBlob = new Blob(["viewer-preview"], { type: "image/webp" });
    const createObjectURL = mock(() => "blob:viewer-preview");
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = mock(() => {});

    const { ensureSavedPalettePreviewBlob, palettePreviewAssets, renderSavedPalettePreviewBlob } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: null },
      renderedPreviewBlobs: {
        gallery: new Blob(["gallery-preview"], { type: "image/webp" }),
        viewer: renderedPreviewBlob,
      },
    });

    const palette = { id: 24, hasPhotoAsset: true };
    const asset = await palettePreviewAssets.getPaletteViewerPreviewAsset(palette);

    expect(ensureSavedPalettePreviewBlob).not.toHaveBeenCalled();
    expect(renderSavedPalettePreviewBlob).toHaveBeenCalledWith(palette, "viewer");
    expect(asset).toEqual({
      blob: renderedPreviewBlob,
      objectUrl: "blob:viewer-preview",
    });
  });

});

describe("sharePalettePolaroidImage", () => {
  test("shares a fresh high-quality render instead of either saved preview variant", async () => {
    const share = mock(async () => {});
    const canShare = mock(() => true);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { share, canShare },
    });

    const {
      ensurePaletteMasterPhotoBlob,
      ensureSavedPalettePreviewBlob,
      palettePreviewAssets,
      renderPalettePolaroidBlob,
    } = await loadPalettePreviewAssets({
      storedPreviewBlobs: {
        gallery: new Blob(["gallery-thumb"], { type: "image/webp" }),
        viewer: new Blob(["viewer-preview"], { type: "image/webp" }),
      },
      renderedHighQualityBlob: new Blob(["hq"], { type: "image/jpeg" }),
    });

    const result = await palettePreviewAssets.sharePalettePolaroidImage({
      id: 31,
      hasPhotoAsset: true,
    });

    expect(result).toEqual({ status: "shared" });
    expect(ensureSavedPalettePreviewBlob).not.toHaveBeenCalled();
    expect(ensurePaletteMasterPhotoBlob).toHaveBeenCalledTimes(1);
    expect(renderPalettePolaroidBlob).toHaveBeenCalledTimes(1);
    expect(canShare).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files[0].type).toBe("image/jpeg");
    expect(share.mock.calls[0][0].files[0].name).toBe("palette-31.jpg");
  });
});
