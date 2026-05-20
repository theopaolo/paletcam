import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { installFakeDom } from "../test-support/fake-dom.js";

const communityServiceModuleUrl = new URL("../../community-service.js", import.meta.url).href;
const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../error-reporting.js", import.meta.url).href;
const imageElementLoaderModuleUrl = new URL("../image-element-loader.js", import.meta.url).href;
const paletteCardModuleUrl = new URL("./palette-card.js", import.meta.url).href;
const palettePreviewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;
const palettePreviewPersistenceModuleUrl = new URL(
  "./palette-preview-persistence.js",
  import.meta.url,
).href;

let restoreDom = () => {};

async function loadPaletteCardModule({
  loadImageElementBlobSource = mock(async () => {}),
  getPaletteGalleryPreviewAsset = null,
} = {}) {
  const galleryPreviewBlob = new Blob(["gallery"], { type: "image/webp" });
  const resolvedGetPaletteGalleryPreviewAsset =
    getPaletteGalleryPreviewAsset ??
    mock(async () => ({
      blob: galleryPreviewBlob,
    }));
  const getPalettePreviewDebugInfo = mock(() => ({ paletteId: 5, variant: "gallery" }));
  const refreshPaletteGalleryAsset = mock(() => {});
  const reportAppError = mock(() => ({}));

  mock.module(communityServiceModuleUrl, () => ({
    getPalettePublicationMeta: mock(() => null),
  }));

  mock.module(i18nModuleUrl, () => ({
    t: mock((key) => key),
  }));

  mock.module(errorReportingModuleUrl, () => ({
    reportAppError,
  }));

  mock.module(imageElementLoaderModuleUrl, () => ({
    loadImageElementBlobSource,
  }));

  mock.module(palettePreviewAssetsModuleUrl, () => ({
    getPaletteGalleryPreviewAsset: resolvedGetPaletteGalleryPreviewAsset,
    getPalettePreviewDebugInfo,
    refreshPaletteGalleryAsset,
  }));

  mock.module(palettePreviewPersistenceModuleUrl, () => ({
    ensurePalettePolaroidColorNames: mock(async () => []),
    ensureSavedPalettePreviewBlob: mock(async () => null),
    getPalettePreviewFingerprint: mock(() => "preview-v5:test:names-on"),
    getStoredPalettePreviewBlob: mock(() => new Blob(["preview"], { type: "image/webp" })),
    renderSavedPalettePreviewBlob: mock(async () => null),
    scheduleSavedPalettePreviewWarmup: mock(() => {}),
  }));

  const paletteCard = await import(`${paletteCardModuleUrl}?test=${Math.random()}`);

  return {
    galleryPreviewBlob,
    getPaletteGalleryPreviewAsset: resolvedGetPaletteGalleryPreviewAsset,
    loadImageElementBlobSource,
    paletteCard,
    refreshPaletteGalleryAsset,
    reportAppError,
  };
}

beforeEach(() => {
  restoreDom = installFakeDom();
});

afterEach(() => {
  restoreDom();
  mock.restore();
});

describe("createSwatchCard", () => {
  test("loads the shared gallery preview asset when the user opens a swatch card", async () => {
    const onOpenViewer = mock(() => {});

    const {
      galleryPreviewBlob,
      getPaletteGalleryPreviewAsset,
      loadImageElementBlobSource,
      paletteCard,
    } = await loadPaletteCardModule();
    const palette = {
      id: 5,
      colors: [
        { r: 12, g: 34, b: 56 },
        { r: 90, g: 123, b: 210 },
      ],
    };

    const card = paletteCard.createSwatchCard({ palette, onOpenViewer });
    const trigger = card.querySelector(".palette-card-trigger");

    trigger.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOpenViewer).toHaveBeenCalledWith(5);
    expect(getPaletteGalleryPreviewAsset).toHaveBeenCalledWith(palette);
    expect(loadImageElementBlobSource).toHaveBeenCalledTimes(1);
    expect(loadImageElementBlobSource.mock.calls[0][1]).toBe(galleryPreviewBlob);
  });

  test("uses a tight lazy preview margin for swatch cards", async () => {
    const observerOptions = [];
    const observedTargets = [];

    globalThis.window.IntersectionObserver = class FakeIntersectionObserver {
      constructor(_callback, options) {
        observerOptions.push(options);
      }

      observe(target) {
        observedTargets.push(target);
      }

      disconnect() {}
    };

    const { paletteCard } = await loadPaletteCardModule();
    const palette = {
      id: 5,
      colors: [
        { r: 12, g: 34, b: 56 },
        { r: 90, g: 123, b: 210 },
      ],
    };

    paletteCard.createPaletteCard({ palette });
    paletteCard.createSwatchCard({ palette });

    expect(observerOptions[0]?.rootMargin).toBe("500px 0px");
    expect(observerOptions[1]?.rootMargin).toBe("40px 0px");
    expect(observedTargets[0]?.className).toBe("palette-card");
    expect(observedTargets[1]?.className).toBe("palette-swatch-media");
  });

  test("refreshes and retries once when a gallery preview blob fails to load", async () => {
    let observerCallback = () => {};
    globalThis.window.IntersectionObserver = class FakeIntersectionObserver {
      constructor(callback) {
        observerCallback = callback;
      }

      observe() {}
      disconnect() {}
    };

    const previewBlobs = [
      new Blob(["stale"], { type: "image/webp" }),
      new Blob(["fresh"], { type: "image/webp" }),
    ];
    let nextPreviewBlobIndex = 0;
    const getPaletteGalleryPreviewAsset = mock(async () => ({
      blob: previewBlobs[nextPreviewBlobIndex++],
    }));
    let loadAttemptCount = 0;
    const loadImageElementBlobSource = mock(async () => {
      loadAttemptCount += 1;
      if (loadAttemptCount === 1) {
        throw new Error("Unable to read image blob");
      }
    });

    const { paletteCard, refreshPaletteGalleryAsset, reportAppError } = await loadPaletteCardModule(
      {
        getPaletteGalleryPreviewAsset,
        loadImageElementBlobSource,
      },
    );
    const palette = {
      id: 5,
      colors: [{ r: 12, g: 34, b: 56 }],
    };

    paletteCard.createPaletteCard({ palette });
    observerCallback([{ isIntersecting: true }]);
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(getPaletteGalleryPreviewAsset).toHaveBeenCalledTimes(2);
    expect(loadImageElementBlobSource).toHaveBeenCalledTimes(2);
    expect(loadImageElementBlobSource.mock.calls[1][1]).toBe(previewBlobs[1]);
    expect(refreshPaletteGalleryAsset).toHaveBeenCalledWith(palette, 5);
    expect(reportAppError).not.toHaveBeenCalled();
  });
});
