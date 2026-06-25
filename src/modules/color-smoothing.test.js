import { describe, expect, test } from "bun:test";

import { createColorSmoother } from "./color-smoothing.js";

describe("createColorSmoother", () => {
  test("returns the raw palette on the first frame", () => {
    const smoother = createColorSmoother();
    const colors = [
      { r: 24, g: 48, b: 72 },
      { r: 180, g: 120, b: 60 },
    ];

    expect(smoother.smooth(colors, 0.1)).toEqual(colors);
  });

  test("clears accumulated state when reset is called", () => {
    const smoother = createColorSmoother();
    const firstPalette = [
      { r: 20, g: 30, b: 40 },
      { r: 200, g: 210, b: 220 },
    ];
    const secondPalette = [
      { r: 240, g: 30, b: 40 },
      { r: 20, g: 210, b: 220 },
    ];

    expect(smoother.smooth(firstPalette, 0.1)).toEqual(firstPalette);
    expect(smoother.smooth(secondPalette, 0.1)).not.toEqual(secondPalette);

    smoother.reset();

    expect(smoother.smooth(secondPalette, 0.1)).toEqual(secondPalette);
  });

  test("keeps separate state per instance", () => {
    const first = createColorSmoother();
    const second = createColorSmoother();
    const paletteA = [
      { r: 10, g: 20, b: 30 },
      { r: 200, g: 200, b: 200 },
    ];
    const paletteB = [
      { r: 250, g: 10, b: 10 },
      { r: 10, g: 250, b: 10 },
    ];

    // Prime only the first smoother; the second must still treat its next
    // call as a fresh first frame.
    first.smooth(paletteA, 0.1);

    expect(second.smooth(paletteB, 0.1)).toEqual(paletteB);
  });
});
