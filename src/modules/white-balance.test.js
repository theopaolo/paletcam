import { describe, expect, test } from "bun:test";

import {
  applyWhiteBalanceLut,
  balanceColor,
  createWhiteBalanceLut,
  measureNeutralGains,
} from "./white-balance.js";

function patchOf(r, g, b, count = 16) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([r, g, b, 255], index);
  }
  return pixels;
}

describe("measureNeutralGains", () => {
  test("a warm-lit white comes back gray, and the cast leaves the rest of the frame", () => {
    // White paper under tungsten, and a blue mug seen under the same light.
    const gains = measureNeutralGains(patchOf(235, 205, 160));
    const lut = createWhiteBalanceLut(gains);

    const paper = balanceColor({ r: 235, g: 205, b: 160 }, lut);
    expect(
      Math.max(paper.r, paper.g, paper.b) - Math.min(paper.r, paper.g, paper.b),
    ).toBeLessThanOrEqual(1);

    const mug = balanceColor({ r: 70, g: 90, b: 120 }, lut);
    expect(mug.b).toBeGreaterThan(120);
    expect(mug.r).toBeLessThan(70);
  });

  test("a gray patch needs no correction", () => {
    const gains = measureNeutralGains(patchOf(128, 128, 128));
    for (const gain of gains) {
      expect(gain).toBeCloseTo(1, 5);
    }
  });

  test("refuses patches that say nothing about the light", () => {
    expect(measureNeutralGains(patchOf(4, 4, 4))).toBeNull();
    expect(measureNeutralGains(patchOf(255, 255, 255))).toBeNull();
    expect(measureNeutralGains(patchOf(220, 40, 30))).toBeNull();
    expect(measureNeutralGains(new Uint8ClampedArray(0))).toBeNull();
  });
});

describe("applyWhiteBalanceLut", () => {
  test("balances RGB in place and leaves alpha alone", () => {
    const lut = createWhiteBalanceLut(measureNeutralGains(patchOf(235, 205, 160)));
    const pixels = new Uint8ClampedArray([235, 205, 160, 77]);
    applyWhiteBalanceLut(pixels, lut);

    expect(pixels[3]).toBe(77);
    expect(Math.abs(pixels[0] - pixels[2])).toBeLessThanOrEqual(1);
  });
});
