import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { installFakeDom } from "./test-support/fake-dom.js";

const communityServiceModuleUrl = new URL("../../community-service.js", import.meta.url).href;
const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const imageElementLoaderModuleUrl = new URL("../image-element-loader.js", import.meta.url).href;
const paletteCardModuleUrl = new URL("./palette-card.js", import.meta.url).href;
const palettePreviewPersistenceModuleUrl = new URL(
  "./palette-preview-persistence.js",
  import.meta.url,
).href;

let restoreDom = () => {};
const originalCreateObjectURL = globalThis.URL.createObjectURL;

async function loadPaletteCardModule() {
  const loadImageElementSource = mock(async () => {});

  mock.module(communityServiceModuleUrl, () => ({
    getPalettePublicationMeta: mock(() => null),
  }));

  mock.module(i18nModuleUrl, () => ({
    t: mock((key) => key),
  }));

  mock.module(imageElementLoaderModuleUrl, () => ({
    loadImageElementSource,
  }));

  mock.module(palettePreviewPersistenceModuleUrl, () => ({
    ensureSavedPalettePreviewBlob: mock(async () => null),
    getCurrentPalettePreviewFooterLabel: mock(() => "preview-v5:test:names-on"),
    getStoredPalettePreviewBlob: mock(() => new Blob(["preview"], { type: "image/webp" })),
    scheduleSavedPalettePreviewWarmup: mock(() => {}),
  }));

  const paletteCard = await import(`${paletteCardModuleUrl}?test=${Math.random()}`);

  return {
    loadImageElementSource,
    paletteCard,
  };
}

beforeEach(() => {
  restoreDom = installFakeDom();
});

afterEach(() => {
  restoreDom();
  globalThis.URL.createObjectURL = originalCreateObjectURL;
  mock.restore();
});

describe("createSwatchCard", () => {
  test("loads the preview asset path when the user opens a swatch card", async () => {
    const createObjectURL = mock(() => "blob:preview");
    globalThis.URL.createObjectURL = createObjectURL;

    const { paletteCard } = await loadPaletteCardModule();
    const palette = {
      id: 5,
      colors: [
        { r: 12, g: 34, b: 56 },
        { r: 90, g: 123, b: 210 },
      ],
    };

    const card = paletteCard.createSwatchCard({ palette });
    const trigger = card.querySelector(".palette-card-trigger");

    trigger.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  test("uses a tighter lazy preview margin than regular cards", async () => {
    const observerOptions = [];

    globalThis.window.IntersectionObserver = class FakeIntersectionObserver {
      constructor(_callback, options) {
        observerOptions.push(options);
      }

      observe() {}

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
    expect(observerOptions[1]?.rootMargin).toBe("120px 0px");
  });
});
