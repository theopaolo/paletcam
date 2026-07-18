import { afterEach, describe, expect, mock, test } from "bun:test";

const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const palettePreviewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;
const palettePreviewPersistenceModuleUrl = new URL(
  "./palette-preview-persistence.js",
  import.meta.url,
).href;
const palettePolaroidRendererModuleUrl = new URL("./palette-polaroid-renderer.js", import.meta.url)
  .href;

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
let resetPreviewAssetCacheForTests = null;

async function loadPalettePreviewAssets({
  hydratedPreviewBlobs = { gallery: null, viewer: null },
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
    const hydratedPreviewBlob = hydratedPreviewBlobs[variant] ?? null;
    if (hydratedPreviewBlob instanceof Blob) {
      if (variant === "gallery") {
        palette.previewGalleryBlob = hydratedPreviewBlob;
      } else {
        palette.previewViewerBlob = hydratedPreviewBlob;
      }
      return hydratedPreviewBlob;
    }

    const renderedPreviewBlob = renderedPreviewBlobs[variant] ?? null;
    if (variant === "gallery") {
      palette.previewGalleryBlob = renderedPreviewBlob;
    }
    return renderedPreviewBlob;
  });
  const renderSavedPalettePreviewBlob = mock(
    async (_palette, variant = "viewer") => renderedPreviewBlobs[variant] ?? null,
  );
  const renderPalettePolaroidBlob = mock(async () => renderedHighQualityBlob);
  const getPalettePreviewFingerprint = mock(
    (_palette, variant = "viewer") => `preview-v6:${variant}:test:names-on`,
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
  const invalidateSavedPalettePreviewBlob = mock(async (palette, variant = "viewer") => {
    if (variant === "gallery") {
      delete palette.previewGalleryBlob;
      delete palette.previewGalleryFooterLabel;
    } else {
      delete palette.previewViewerBlob;
      delete palette.previewViewerFooterLabel;
    }
    return true;
  });

  mock.module(paletteStorageModuleUrl, () => ({
    ensurePaletteMasterPhotoBlob,
  }));
  mock.module(palettePolaroidRendererModuleUrl, () => ({
    getPalettePreviewImageMimeType: mock(() => "image/webp"),
    hasPaletteMasterPhoto: mock(() => true),
    renderPalettePolaroidBlob,
  }));

  const hydratePalettePreviewBlobFromIdb = mock(async (palette, variant = "viewer") => {
    const hydratedPreviewBlob = hydratedPreviewBlobs[variant] ?? null;
    if (hydratedPreviewBlob instanceof Blob) {
      if (variant === "gallery") {
        palette.previewGalleryBlob = hydratedPreviewBlob;
      } else {
        palette.previewViewerBlob = hydratedPreviewBlob;
      }
      return hydratedPreviewBlob;
    }

    if (variant === "gallery") {
      return palette?.previewGalleryBlob instanceof Blob ? palette.previewGalleryBlob : null;
    }
    return palette?.previewViewerBlob instanceof Blob ? palette.previewViewerBlob : null;
  });

  mock.module(palettePreviewPersistenceModuleUrl, () => ({
    ensureSavedPalettePreviewBlob,
    getPalettePreviewFingerprint,
    getStoredPalettePreviewBlob,
    hydratePalettePreviewBlobFromIdb,
    invalidateSavedPalettePreviewBlob,
    renderSavedPalettePreviewBlob,
  }));
  const palettePreviewAssets = await import(
    `${palettePreviewAssetsModuleUrl}?test=${Math.random()}`
  );
  resetPreviewAssetCacheForTests = palettePreviewAssets.resetPreviewAssetCacheForTests;

  return {
    ensurePaletteMasterPhotoBlob,
    ensureSavedPalettePreviewBlob,
    getStoredPalettePreviewBlob,
    hydratePalettePreviewBlobFromIdb,
    invalidateSavedPalettePreviewBlob,
    palettePreviewAssets,
    renderSavedPalettePreviewBlob,
    renderPalettePolaroidBlob,
  };
}

afterEach(() => {
  resetPreviewAssetCacheForTests?.();
  resetPreviewAssetCacheForTests = null;
  mock.restore();
  if (originalNavigator === undefined) {
    delete globalThis.navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("getPaletteViewerPreviewAsset", () => {
  test("reuses the stored viewer preview blob without hydrating the master photo", async () => {
    const storedPreviewBlob = new Blob(["stored-viewer-preview"], { type: "image/webp" });

    const { ensurePaletteMasterPhotoBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: storedPreviewBlob },
    });

    const asset = await palettePreviewAssets.getPaletteViewerPreviewAsset({
      id: 7,
      hasPhotoAsset: true,
    });

    expect(asset).toEqual({ blob: storedPreviewBlob, source: null });
    expect(ensurePaletteMasterPhotoBlob).not.toHaveBeenCalled();
  });

  test("does not fall back to the master photo blob when viewer preview rendering fails", async () => {
    const { ensureSavedPalettePreviewBlob, palettePreviewAssets, renderSavedPalettePreviewBlob } =
      await loadPalettePreviewAssets({
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
  });
});

describe("getPaletteGalleryPreviewAsset", () => {
  test("does not repopulate a disposed cache entry when a pending render settles", async () => {
    let resolvePreview;
    const preview = new Blob(["late-gallery"], { type: "image/webp" });
    const { ensureSavedPalettePreviewBlob, palettePreviewAssets } =
      await loadPalettePreviewAssets();
    ensureSavedPalettePreviewBlob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const palette = { id: 9, hasPhotoAsset: true };

    const pendingAsset = palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);
    palettePreviewAssets.disposePalettePreviewAsset(palette);
    resolvePreview(preview);

    await expect(pendingAsset).resolves.toEqual({ blob: preview, source: null });
    expect(palettePreviewAssets.getStoredPaletteGalleryPreviewAssetSync(palette)).toBeNull();

    ensureSavedPalettePreviewBlob.mockResolvedValue(preview);
    await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);
    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledTimes(2);
  });

  test("hydrates a persisted gallery preview before rendering from the master photo", async () => {
    const hydratedPreviewBlob = new Blob(["persisted-gallery"], { type: "image/webp" });
    const { ensureSavedPalettePreviewBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      hydratedPreviewBlobs: { gallery: hydratedPreviewBlob, viewer: null },
    });
    const palette = { id: 10, hasPhotoAsset: true };

    const asset = await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);

    expect(asset).toEqual({ blob: hydratedPreviewBlob, source: null });
    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledWith(palette, "gallery");
  });

  test("persists the requested gallery preview variant when only the master photo exists", async () => {
    const renderedPreviewBlob = new Blob(["gallery-rendered-preview"], { type: "image/webp" });

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
    expect(palette.previewGalleryBlob).toBe(renderedPreviewBlob);
  });

  test("refreshPaletteGalleryAsset clears cached gallery preview state", async () => {
    const { invalidateSavedPalettePreviewBlob, palettePreviewAssets } =
      await loadPalettePreviewAssets();
    const palette = {
      id: 12,
      hasPhotoAsset: true,
      photoBlob: new Blob(["photo"], { type: "image/webp" }),
      previewGalleryBlob: new Blob(["preview"], { type: "image/webp" }),
    };

    await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);
    await palettePreviewAssets.refreshPaletteGalleryAsset(palette, palette.id);

    expect(palette.photoBlob).toBe(null);
    expect(palette.previewGalleryBlob).toBeUndefined();
    expect(invalidateSavedPalettePreviewBlob).toHaveBeenCalledWith(palette, "gallery");
  });
});

describe("getPalettePreviewDebugInfo", () => {
  test("summarizes preview blob state without retaining blob data", async () => {
    const { palettePreviewAssets } = await loadPalettePreviewAssets();
    const assetBlob = new Blob(["asset"], { type: "image/webp" });

    expect(
      palettePreviewAssets.getPalettePreviewDebugInfo(
        {
          id: 42,
          hasPhotoAsset: true,
          captureAspectRatio: 1.2,
          previewGalleryBlob: new Blob(["gallery"], { type: "image/webp" }),
        },
        { blob: assetBlob },
        "gallery",
      ),
    ).toEqual(
      expect.objectContaining({
        assetBlob: { size: assetBlob.size, type: "image/webp" },
        assetUrlKind: null,
        captureAspectRatio: 1.2,
        hasGalleryPreviewBlob: true,
        hasPhotoAsset: true,
        paletteId: 42,
        variant: "gallery",
      }),
    );
  });
});

describe("variant helpers", () => {
  test("uses the gallery preview asset path for gallery surfaces", async () => {
    const renderedPreviewBlob = new Blob(["gallery-preview"], { type: "image/webp" });

    const { ensureSavedPalettePreviewBlob, palettePreviewAssets } = await loadPalettePreviewAssets({
      storedPreviewBlobs: { gallery: null, viewer: null },
      renderedPreviewBlobs: {
        gallery: renderedPreviewBlob,
        viewer: new Blob(["viewer-preview"], { type: "image/webp" }),
      },
    });

    const palette = { id: 23, hasPhotoAsset: true };
    const asset = await palettePreviewAssets.getPaletteGalleryPreviewAsset(palette);

    expect(ensureSavedPalettePreviewBlob).toHaveBeenCalledWith(palette, "gallery");
    expect(asset).toEqual({ blob: renderedPreviewBlob, source: null });
  });

  test("uses the viewer preview asset path for the overlay", async () => {
    const renderedPreviewBlob = new Blob(["viewer-preview"], { type: "image/webp" });

    const { ensureSavedPalettePreviewBlob, palettePreviewAssets, renderSavedPalettePreviewBlob } =
      await loadPalettePreviewAssets({
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
    expect(asset).toEqual({ blob: renderedPreviewBlob, source: null });
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

describe("download lifecycle", () => {
  test("terminal cleanup cancels revocation timers and revokes each object URL once", async () => {
    const clearTimeout = mock(() => {});
    const setTimeout = mock(() => 73);
    const click = mock(() => {});
    const createObjectURL = mock(() => "blob:palette-download");
    const revokeObjectURL = mock(() => {});
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Desktop" },
    });
    globalThis.window = { clearTimeout, setTimeout };
    globalThis.document = {
      createElement: () => ({ click, download: "", href: "" }),
    };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const { palettePreviewAssets } = await loadPalettePreviewAssets();
    await expect(
      palettePreviewAssets.downloadBlob(new Blob(["photo"]), "palette.webp"),
    ).resolves.toBe(true);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    palettePreviewAssets.disposePalettePreviewDownloads();
    palettePreviewAssets.disposePalettePreviewDownloads();

    expect(clearTimeout).toHaveBeenCalledWith(73);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:palette-download");
  });
});
