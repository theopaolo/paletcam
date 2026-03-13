import { beforeEach, describe, expect, test } from "bun:test";

import { extractPaletteColors, resetColorSmoothing, smoothColors } from "./palette-extraction.js";

function createRgbaData(pixels) {
  const channels = [];

  for (const [r, g, b, a] of pixels) {
    channels.push(r, g, b, a);
  }

  return new Uint8ClampedArray(channels);
}

describe("smoothColors", () => {
  beforeEach(() => {
    resetColorSmoothing();
  });

  test("returns the raw palette on the first frame after a reset", () => {
    const colors = [
      { r: 24, g: 48, b: 72 },
      { r: 180, g: 120, b: 60 },
    ];

    expect(smoothColors(colors, 0.1)).toEqual(colors);
  });

  test("clears accumulated smoothing state when resetColorSmoothing is called", () => {
    const firstPalette = [
      { r: 20, g: 30, b: 40 },
      { r: 200, g: 210, b: 220 },
    ];
    const secondPalette = [
      { r: 240, g: 30, b: 40 },
      { r: 20, g: 210, b: 220 },
    ];

    expect(smoothColors(firstPalette, 0.1)).toEqual(firstPalette);
    expect(smoothColors(secondPalette, 0.1)).not.toEqual(secondPalette);

    resetColorSmoothing();

    expect(smoothColors(secondPalette, 0.1)).toEqual(secondPalette);
  });
});

describe("extractPaletteColors", () => {
  test("keeps rgb as the median-cut default and honors nested colorSpace overrides", () => {
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [255, 128, 0, 255],
      [0, 255, 0, 255],
      [0, 128, 255, 255],
      [128, 0, 255, 255],
      [255, 0, 128, 255],
      [200, 200, 40, 255],
      [40, 200, 200, 255],
    ]);

    const defaultResult = extractPaletteColors(imageData, 4, 2, 4, {
      algorithm: "median-cut",
      medianCut: {
        quantizedPoolSize: 8,
        maxQuantizerPixels: 12_000,
      },
    });
    const nestedOklchResult = extractPaletteColors(imageData, 4, 2, 4, {
      algorithm: "median-cut",
      medianCut: {
        quantizedPoolSize: 8,
        maxQuantizerPixels: 12_000,
        colorSpace: "oklch",
      },
    });
    const aliasOverrideResult = extractPaletteColors(imageData, 4, 2, 4, {
      algorithm: "median-cut",
      colorSpace: "rgb",
      medianCut: {
        quantizedPoolSize: 8,
        maxQuantizerPixels: 12_000,
        colorSpace: "oklch",
      },
    });

    expect(defaultResult.colors).toEqual([
      { r: 0, g: 248, b: 0 },
      { r: 128, g: 0, b: 248 },
      { r: 248, g: 128, b: 0 },
      { r: 200, g: 200, b: 40 },
    ]);
    expect(nestedOklchResult.colors).toEqual([
      { r: 103, g: 242, b: 0 },
      { r: 119, g: 0, b: 243 },
      { r: 252, g: 8, b: 56 },
      { r: 207, g: 187, b: 6 },
    ]);
    expect(aliasOverrideResult.colors).toEqual(defaultResult.colors);
  });
});
