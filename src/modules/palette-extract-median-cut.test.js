import { describe, expect, test } from 'bun:test';

import { extractMedianCutPaletteColors } from './palette-extract-median-cut.js';

function createRgbaData(pixels) {
  const channels = [];

  for (const [r, g, b, a] of pixels) {
    channels.push(r, g, b, a);
  }

  return new Uint8ClampedArray(channels);
}

describe('extractMedianCutPaletteColors', () => {
  test('returns empty results for invalid input', () => {
    expect(
      extractMedianCutPaletteColors(null, 4, 4, 4)
    ).toEqual({ colors: [], chosenIndices: [] });

    expect(
      extractMedianCutPaletteColors(new Uint8ClampedArray([255, 0, 0, 255]), 0, 1, 4)
    ).toEqual({ colors: [], chosenIndices: [] });

    expect(
      extractMedianCutPaletteColors(new Uint8ClampedArray([255, 0, 0, 255]), 1, 0, 4)
    ).toEqual({ colors: [], chosenIndices: [] });
  });

  test('returns empty results when all pixels are fully transparent', () => {
    const imageData = createRgbaData([
      [255, 0, 0, 0],
      [0, 255, 0, 0],
      [0, 0, 255, 0],
      [255, 255, 0, 0],
    ]);

    expect(
      extractMedianCutPaletteColors(imageData, 2, 2, 4)
    ).toEqual({ colors: [], chosenIndices: [] });
  });

  test('returns deterministic quantized colors for a small fixed fixture', () => {
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const result = extractMedianCutPaletteColors(imageData, 2, 2, 2, {
      quantizedPoolSize: 4,
      maxQuantizerPixels: 12_000,
    });

    expect(result.chosenIndices).toEqual([]);
    expect(result.colors.length).toBe(2);

    const rgbKeys = result.colors
      .map((color) => `${color.r},${color.g},${color.b}`)
      .sort();

    expect(rgbKeys).toEqual(['0,0,248', '248,0,0']);

    for (const { r, g, b } of result.colors) {
      expect(r % 8).toBe(0);
      expect(g % 8).toBe(0);
      expect(b % 8).toBe(0);
    }
  });

  test('clamps non-positive swatchCount values to at least one swatch when pixels exist', () => {
    const imageData = createRgbaData([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const result = extractMedianCutPaletteColors(imageData, 2, 1, 0, {
      quantizedPoolSize: 2,
      maxQuantizerPixels: 12_000,
    });

    expect(result.chosenIndices).toEqual([]);
    expect(result.colors.length).toBe(1);
  });
});
