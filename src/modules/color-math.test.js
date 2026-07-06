import { describe, expect, test } from "bun:test";

import { findNearestColor, getContrastInkColor } from "./color-math.js";

describe("findNearestColor", () => {
  test("returns the nearest candidate with its index and squared distance", () => {
    const candidates = [
      { r: 0, g: 0, b: 0 },
      { r: 200, g: 10, b: 10 },
      { r: 255, g: 255, b: 255 },
    ];

    const nearest = findNearestColor({ r: 210, g: 0, b: 0 }, candidates);
    expect(nearest.index).toBe(1);
    expect(nearest.color).toBe(candidates[1]);
    expect(nearest.distanceSquared).toBe(10 * 10 + 10 * 10 + 10 * 10);
  });

  test("returns null for empty or missing candidates", () => {
    expect(findNearestColor({ r: 0, g: 0, b: 0 }, [])).toBeNull();
    expect(findNearestColor({ r: 0, g: 0, b: 0 }, null)).toBeNull();
  });
});

describe("getContrastInkColor", () => {
  test("uses dark ink on light swatches and light ink on dark ones", () => {
    expect(getContrastInkColor({ r: 255, g: 255, b: 255 })).toBe("#000");
    expect(getContrastInkColor({ r: 250, g: 220, b: 40 })).toBe("#000");
    expect(getContrastInkColor({ r: 0, g: 0, b: 0 })).toBe("#fff");
    expect(getContrastInkColor({ r: 30, g: 30, b: 160 })).toBe("#fff");
  });
});
