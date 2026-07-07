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
  test("returns empty results for invalid input", () => {
    expect(extractPaletteColors(null, 4, 4, 4)).toEqual({ colors: [] });

    expect(extractPaletteColors(new Uint8ClampedArray([255, 0, 0, 255]), 0, 1, 4).colors).toEqual(
      [],
    );

    expect(extractPaletteColors(new Uint8ClampedArray([255, 0, 0, 255]), 1, 0, 4).colors).toEqual(
      [],
    );
  });

  test("returns empty results when all pixels are fully transparent", () => {
    const imageData = createRgbaData([
      [255, 0, 0, 0],
      [0, 255, 0, 0],
      [0, 0, 255, 0],
      [255, 255, 0, 0],
    ]);

    expect(extractPaletteColors(imageData, 2, 2, 4).colors).toEqual([]);
  });

  test("selects perceptually distinct colors for a small fixed fixture", () => {
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const result = extractPaletteColors(imageData, 2, 2, 2);

    expect(result.colors.length).toBe(2);

    const rgbKeys = result.colors.map((color) => `${color.r},${color.g},${color.b}`).sort();

    expect(rgbKeys).toEqual(["0,0,248", "248,0,0"]);
  });

  test("clamps non-positive swatchCount values to at least one swatch when pixels exist", () => {
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const result = extractPaletteColors(imageData, 2, 1, 0);

    expect(result.colors.length).toBe(1);
  });

  test("forwards medianCut and hybrid tuning options", () => {
    // A small quantizer pool merges the dull and vivid reds (and blues) into
    // shared boxes, so the tone knob picks between box mean and vivid exemplar.
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [144, 64, 64, 255],
      [144, 64, 64, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [64, 64, 144, 255],
      [64, 64, 144, 255],
    ]);

    const softResult = extractPaletteColors(imageData, 4, 2, 2, {
      medianCut: { quantizedPoolSize: 2 },
      hybrid: { tone: 0 },
    });
    const vividResult = extractPaletteColors(imageData, 4, 2, 2, {
      medianCut: { quantizedPoolSize: 2 },
      hybrid: { tone: 1 },
    });

    expect(softResult.colors.length).toBe(2);
    expect(vividResult.colors.length).toBe(2);
    expect(softResult.colors).not.toEqual(vividResult.colors);
  });
});
