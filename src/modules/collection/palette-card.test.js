import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { installFakeDom } from "./test-support/fake-dom.js";

const communityServiceModuleUrl = new URL("../../community-service.js", import.meta.url).href;
const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const imageElementLoaderModuleUrl = new URL("../image-element-loader.js", import.meta.url).href;
const paletteCardModuleUrl = new URL("./palette-card.js", import.meta.url).href;
const palettePreviewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;

let restoreDom = () => {};

async function loadPaletteCardModule() {
  const getPalettePreviewPolaroidAsset = mock(async () => ({
    blob: new Blob(["preview"], { type: "image/webp" }),
    objectUrl: "blob:preview",
  }));

  mock.module(communityServiceModuleUrl, () => ({
    getPalettePublicationMeta: mock(() => null),
  }));

  mock.module(i18nModuleUrl, () => ({
    t: mock((key) => key),
  }));

  mock.module(imageElementLoaderModuleUrl, () => ({
    loadImageElementSource: mock(async () => {}),
  }));

  mock.module(palettePreviewAssetsModuleUrl, () => ({
    getPalettePreviewPolaroidAsset,
    hasPaletteMasterPhoto: mock(() => true),
  }));

  const paletteCard = await import(`${paletteCardModuleUrl}?test=${Math.random()}`);

  return {
    getPalettePreviewPolaroidAsset,
    paletteCard,
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
  test("loads the preview asset path when the user opens a swatch card", async () => {
    const { getPalettePreviewPolaroidAsset, paletteCard } = await loadPaletteCardModule();
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

    expect(getPalettePreviewPolaroidAsset).toHaveBeenCalledTimes(1);
    expect(getPalettePreviewPolaroidAsset.mock.calls[0][0]).toBe(palette);
  });
});
