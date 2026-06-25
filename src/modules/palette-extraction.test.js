import { describe, expect, test } from "bun:test";

import { extractPaletteColors } from "./palette-extraction.js";

function createRgbaData(pixels) {
  const channels = [];

  for (const [r, g, b, a] of pixels) {
    channels.push(r, g, b, a);
  }

  return new Uint8ClampedArray(channels);
}

describe("extractPaletteColors", () => {
  test("quantizes in rgb and ignores any stray colorSpace option", () => {
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
      medianCut: {
        quantizedPoolSize: 8,
        maxQuantizerPixels: 12_000,
      },
    });
    // A leftover colorSpace flag from older settings must not change the result.
    const strayColorSpaceResult = extractPaletteColors(imageData, 4, 2, 4, {
      medianCut: {
        quantizedPoolSize: 8,
        maxQuantizerPixels: 12_000,
        colorSpace: "oklch",
      },
    });

    expect(defaultResult.colors).toEqual([
      { r: 0, g: 248, b: 0 },
      { r: 128, g: 0, b: 248 },
      { r: 248, g: 0, b: 0 },
      { r: 248, g: 0, b: 128 },
    ]);
    expect(strayColorSpaceResult.colors).toEqual(defaultResult.colors);
  });
});
