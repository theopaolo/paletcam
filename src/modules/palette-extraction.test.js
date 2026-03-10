import { beforeEach, describe, expect, test } from "bun:test";

import { resetColorSmoothing, smoothColors } from "./palette-extraction.js";

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
