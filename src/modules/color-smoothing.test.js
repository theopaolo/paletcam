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

  test("a change past the deadband lands on the new color instead of stopping short", () => {
    const smoother = createColorSmoother();
    const warm = [{ r: 232, g: 200, b: 160 }];
    const neutral = [{ r: 208, g: 208, b: 208 }];
    smoother.smooth(warm, 0.16);

    let shown = warm;
    for (let frame = 0; frame < 120; frame += 1) {
      // A fresh extraction every few frames, as the live preview delivers them.
      shown = smoother.smooth(frame % 12 === 0 ? [{ ...neutral[0] }] : neutral, 0.16);
    }

    for (const channel of ["r", "g", "b"]) {
      expect(Math.abs(shown[0][channel] - neutral[0][channel])).toBeLessThanOrEqual(2);
    }
  });

  test("a settled swatch keeps the same object, so the palette does not repaint", () => {
    const smoother = createColorSmoother();
    smoother.smooth([{ r: 232, g: 200, b: 160 }], 0.16);
    const neutral = [{ r: 208, g: 208, b: 208 }];
    for (let frame = 0; frame < 120; frame += 1) {
      smoother.smooth(neutral, 0.16);
    }

    expect(smoother.smooth(neutral, 0.16)[0]).toBe(smoother.smooth(neutral, 0.16)[0]);
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

  test("can replay the superseded sRGB smoother for the debug harness", () => {
    const before = createColorSmoother({ colorSpace: "srgb" });
    const after = createColorSmoother();
    const red = [{ r: 255, g: 0, b: 0 }];
    const green = [{ r: 0, g: 255, b: 0 }];

    before.smooth(red, 0.5);
    after.smooth(red, 0.5);

    expect(before.smooth(green, 0.5)).toEqual([{ r: 192, g: 64, b: 0 }]);
    expect(after.smooth(green, 0.5)).toEqual([{ r: 237, g: 115, b: 0 }]);
  });
});
