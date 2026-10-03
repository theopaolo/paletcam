import { describe, expect, test } from "bun:test";

import { createSameColorMatcher, orderPalettesBySpectrum } from "./spectrum.js";

const beige = { r: 230, g: 222, b: 205 };
const palette = (id, ...colors) => ({ id, colors });

describe("orderPalettesBySpectrum", () => {
  test("sorts by the most chromatic color, neutrals last from light to dark", () => {
    const ordered = orderPalettesBySpectrum([
      palette(1, beige, { r: 40, g: 80, b: 200 }),
      palette(2, { r: 30, g: 30, b: 30 }, { r: 60, g: 60, b: 60 }),
      palette(3, beige, { r: 210, g: 40, b: 40 }),
      palette(4, { r: 240, g: 240, b: 240 }),
      palette(5, { r: 60, g: 150, b: 60 }, beige),
    ]);

    expect(ordered.map((entry) => entry.palette.id)).toEqual([3, 5, 1, 4, 2]);
    expect(ordered.map((entry) => entry.family)).toEqual([
      "red",
      "green",
      "blue",
      "neutral",
      "neutral",
    ]);
  });

  test("moves the key color to the front without losing the others", () => {
    const [entry] = orderPalettesBySpectrum([palette(1, beige, beige, { r: 210, g: 40, b: 40 })]);

    expect(entry.colors).toEqual([{ r: 210, g: 40, b: 40 }, beige, beige]);
  });

  test("keeps magentas apart from reds across the wrap", () => {
    const ordered = orderPalettesBySpectrum([
      palette(1, { r: 200, g: 40, b: 160 }),
      palette(2, { r: 220, g: 50, b: 50 }),
    ]);

    expect(ordered.map((entry) => entry.family)).toEqual(["red", "purple"]);
  });
});

describe("createSameColorMatcher", () => {
  test("keeps catches holding a near twin of the color, drops the rest", () => {
    const matchesRed = createSameColorMatcher({ r: 210, g: 40, b: 40 });

    expect(matchesRed(palette(1, beige, { r: 214, g: 44, b: 42 }))).toBe(true);
    expect(matchesRed(palette(2, beige, { r: 230, g: 110, b: 40 }))).toBe(false);
    expect(matchesRed(palette(3))).toBe(false);
  });
});
