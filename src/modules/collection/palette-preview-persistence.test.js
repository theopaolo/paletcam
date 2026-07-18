import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  resetAppTerminalLifecycleForTests,
  terminateAppLifetime,
} from "../app-terminal-lifecycle.js";

const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const persistenceModuleUrl = new URL("./palette-preview-persistence.js", import.meta.url).href;
const rendererModuleUrl = new URL("./palette-polaroid-renderer.js", import.meta.url).href;
const originalWindow = globalThis.window;

async function loadPersistenceModule({ readPalettePreviewBlobByIdImplementation } = {}) {
  const ensurePaletteMasterPhotoBlob = mock(async () => null);
  const readPalettePreviewBlobById = mock(
    readPalettePreviewBlobByIdImplementation ?? (async () => null),
  );
  const updatePalettePreviewBlob = mock(async () => null);

  mock.module(paletteStorageModuleUrl, () => ({
    ensurePaletteMasterPhotoBlob,
    readPalettePreviewBlobById,
    updatePalettePreviewBlob,
  }));
  mock.module(rendererModuleUrl, () => ({
    getPalettePreviewImageMimeType: mock(() => "image/webp"),
    renderPalettePolaroidBlob: mock(async () => null),
  }));

  const module = await import(`${persistenceModuleUrl}?test=${Math.random()}`);
  return {
    ensurePaletteMasterPhotoBlob,
    module,
    readPalettePreviewBlobById,
    updatePalettePreviewBlob,
  };
}

afterEach(() => {
  resetAppTerminalLifecycleForTests();
  mock.restore();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe("preview warmup terminal lifecycle", () => {
  test("cancels scheduled work and prevents in-flight hydration from mutating after teardown", async () => {
    const idleCallbacks = new Map();
    let nextIdleId = 0;
    const cancelIdleCallback = mock((id) => idleCallbacks.delete(id));
    globalThis.window = {
      cancelIdleCallback,
      requestIdleCallback: mock((callback) => {
        const id = ++nextIdleId;
        idleCallbacks.set(id, callback);
        return id;
      }),
    };
    let resolveStoredPreview;
    const pendingStoredPreview = new Promise((resolve) => {
      resolveStoredPreview = resolve;
    });
    const { module, readPalettePreviewBlobById, updatePalettePreviewBlob } =
      await loadPersistenceModule({
        readPalettePreviewBlobByIdImplementation: () => pendingStoredPreview,
      });
    const inFlightPalette = { id: 31, hasPhotoAsset: true };
    const scheduledPalette = { id: 32, hasPhotoAsset: true };

    module.scheduleSavedPalettePreviewWarmup(inFlightPalette, "gallery");
    module.scheduleSavedPalettePreviewWarmup(scheduledPalette, "gallery");
    idleCallbacks.get(1)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(readPalettePreviewBlobById).toHaveBeenCalledTimes(1);

    terminateAppLifetime();
    resolveStoredPreview({
      blob: new Blob(["late-preview"], { type: "image/webp" }),
      footerLabel: module.getPalettePreviewFingerprint(inFlightPalette, "gallery"),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelIdleCallback).toHaveBeenCalledWith(2);
    expect(readPalettePreviewBlobById).toHaveBeenCalledTimes(1);
    expect(updatePalettePreviewBlob).not.toHaveBeenCalled();
    expect(inFlightPalette.previewGalleryBlob).toBeUndefined();
    expect(scheduledPalette.previewGalleryBlob).toBeUndefined();
  });
});

describe("invalidateSavedPalettePreviewBlob", () => {
  test("durably clears only the requested preview variant and its in-memory mirror", async () => {
    const { module, updatePalettePreviewBlob } = await loadPersistenceModule();
    const galleryBlob = new Blob(["gallery"]);
    const viewerBlob = new Blob(["viewer"]);
    const palette = {
      id: 17,
      previewGalleryBlob: galleryBlob,
      previewGalleryFooterLabel: "gallery-label",
      previewViewerBlob: viewerBlob,
      previewViewerFooterLabel: "viewer-label",
    };

    await expect(module.invalidateSavedPalettePreviewBlob(palette, "gallery")).resolves.toBe(true);

    expect(updatePalettePreviewBlob).toHaveBeenCalledWith(17, null, null, {
      variant: "gallery",
    });
    expect(palette.previewGalleryBlob).toBeUndefined();
    expect(palette.previewGalleryFooterLabel).toBeUndefined();
    expect(palette.previewViewerBlob).toBe(viewerBlob);
    expect(palette.previewViewerFooterLabel).toBe("viewer-label");
  });

  test("rejects an unknown variant without clearing the viewer fallback", async () => {
    const { module, updatePalettePreviewBlob } = await loadPersistenceModule();
    const viewerBlob = new Blob(["viewer"]);
    const palette = {
      id: 19,
      previewViewerBlob: viewerBlob,
      previewViewerFooterLabel: "viewer-label",
    };

    await expect(module.invalidateSavedPalettePreviewBlob(palette, "galery")).rejects.toThrow(
      "Unsupported palette preview variant: galery.",
    );

    expect(updatePalettePreviewBlob).not.toHaveBeenCalled();
    expect(palette.previewViewerBlob).toBe(viewerBlob);
    expect(palette.previewViewerFooterLabel).toBe("viewer-label");
  });
});

describe("persistSavedPalettePreviewBlob", () => {
  test("rejects an unknown variant before writing storage or in-memory state", async () => {
    const { module, updatePalettePreviewBlob } = await loadPersistenceModule();
    const palette = { id: 20 };
    const previewBlob = new Blob(["preview"]);

    await expect(
      module.persistSavedPalettePreviewBlob(palette, previewBlob, "label", "galery"),
    ).rejects.toThrow("Unsupported palette preview variant: galery.");

    expect(updatePalettePreviewBlob).not.toHaveBeenCalled();
    expect(palette.previewViewerBlob).toBeUndefined();
    expect(palette.previewGalleryBlob).toBeUndefined();
  });
});

describe("ensureSavedPalettePreviewBlob", () => {
  test("hydrates a persisted gallery preview before warmup attempts to render it", async () => {
    const { ensurePaletteMasterPhotoBlob, module, readPalettePreviewBlobById } =
      await loadPersistenceModule();
    const palette = {
      id: 18,
      hasPhotoAsset: true,
      polaroidRenderSettings: { footerLabel: "frozen" },
    };
    const storedBlob = new Blob(["stored-gallery"], { type: "image/webp" });
    const footerLabel = module.getPalettePreviewFingerprint(palette, "gallery");
    readPalettePreviewBlobById.mockResolvedValue({ blob: storedBlob, footerLabel });

    await expect(module.ensureSavedPalettePreviewBlob(palette, "gallery")).resolves.toBe(
      storedBlob,
    );

    expect(readPalettePreviewBlobById).toHaveBeenCalledWith(18, "gallery");
    expect(ensurePaletteMasterPhotoBlob).not.toHaveBeenCalled();
    expect(palette.previewGalleryBlob).toBe(storedBlob);
    expect(palette.previewGalleryFooterLabel).toBe(footerLabel);
  });
});
