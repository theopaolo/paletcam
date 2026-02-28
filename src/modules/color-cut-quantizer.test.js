import { describe, expect, test } from 'bun:test';

import { ColorCutQuantizer } from './color-cut-quantizer.js';

function packArgb8888(red, green, blue) {
  return (0xff << 24) | ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff);
}

function unpackRgb888(color) {
  const unsignedColor = color >>> 0;
  return {
    r: (unsignedColor >>> 16) & 0xff,
    g: (unsignedColor >>> 8) & 0xff,
    b: unsignedColor & 0xff,
  };
}

function getPopulationTotal(swatches) {
  return swatches.reduce((sum, swatch) => sum + swatch.population, 0);
}

function expectSwatchesWithinRgbRange(swatches) {
  for (const swatch of swatches) {
    const { r, g, b } = unpackRgb888(swatch.rgb);
    expect(swatch.population).toBeGreaterThan(0);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  }
}

describe('ColorCutQuantizer', () => {
  test('returns all distinct colors under the maxColors limit and preserves population', () => {
    const pixels = new Int32Array([
      packArgb8888(255, 0, 0),
      packArgb8888(255, 0, 0),
      packArgb8888(0, 255, 0),
      packArgb8888(0, 0, 255),
    ]);

    const quantizer = new ColorCutQuantizer(pixels, 5);
    const swatches = quantizer.getQuantizedColors();

    expect(swatches.length).toBe(3);
    expect(getPopulationTotal(swatches)).toBe(4);
    expect(swatches.some((swatch) => swatch.population === 2)).toBe(true);
    expectSwatchesWithinRgbRange(swatches);
  });

  test('returns at most maxColors swatches over the limit and preserves population', () => {
    const pixels = new Int32Array([
      packArgb8888(255, 0, 0),
      packArgb8888(0, 255, 0),
      packArgb8888(0, 0, 255),
      packArgb8888(255, 255, 0),
      packArgb8888(255, 0, 255),
      packArgb8888(0, 255, 255),
      packArgb8888(128, 64, 32),
      packArgb8888(32, 64, 128),
    ]);

    const quantizer = new ColorCutQuantizer(pixels, 2);
    const swatches = quantizer.getQuantizedColors();

    expect(swatches.length).toBeLessThanOrEqual(2);
    expect(getPopulationTotal(swatches)).toBe(8);
    expectSwatchesWithinRgbRange(swatches);
  });

  test('excludes colors blocked by optional filters', () => {
    const pixels = new Int32Array([
      packArgb8888(255, 0, 0),
      packArgb8888(250, 20, 20),
      packArgb8888(0, 255, 0),
      packArgb8888(0, 0, 255),
    ]);
    const filters = [{
      isAllowed(rgb888) {
        const { r, g, b } = unpackRgb888(rgb888);
        return !(r > g && r > b);
      },
    }];

    const quantizer = new ColorCutQuantizer(pixels, 4, filters);
    const swatches = quantizer.getQuantizedColors();

    expect(getPopulationTotal(swatches)).toBe(2);

    for (const swatch of swatches) {
      const { r, g, b } = unpackRgb888(swatch.rgb);
      expect(!(r > g && r > b)).toBe(true);
    }

    expectSwatchesWithinRgbRange(swatches);
  });
});
