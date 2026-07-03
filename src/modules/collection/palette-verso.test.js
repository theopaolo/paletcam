import { describe, expect, test } from "bun:test";

import { getPaletteVersoData } from "./palette-verso.js";

function createPalette(colors) {
  return {
    id: 42,
    timestamp: "2026-07-03T10:00:00.000Z",
    colors,
  };
}

describe("getPaletteVersoData", () => {
  test("returns null for palettes with fewer than two colors", () => {
    expect(getPaletteVersoData(createPalette([]))).toBeNull();
    expect(getPaletteVersoData(createPalette([{ r: 1, g: 2, b: 3 }]))).toBeNull();
    expect(getPaletteVersoData(null)).toBeNull();
  });

  test("uses the plate layout up to four colors and stripes from five", () => {
    const colors = Array.from({ length: 4 }, (_, i) => ({ r: i, g: i, b: i }));
    expect(getPaletteVersoData(createPalette(colors))?.layout).toBe("plate");

    colors.push({ r: 9, g: 9, b: 9 });
    expect(getPaletteVersoData(createPalette(colors))?.layout).toBe("stripes");
  });

  test("derives stripe shares from populations and sorts them descending", () => {
    const versoData = getPaletteVersoData(
      createPalette([
        { r: 10, g: 10, b: 10, population: 100 },
        { r: 20, g: 20, b: 20, population: 300 },
        { r: 30, g: 30, b: 30, population: 200 },
        { r: 40, g: 40, b: 40, population: 250 },
        { r: 50, g: 50, b: 50, population: 150 },
      ]),
    );

    expect(versoData.layout).toBe("stripes");
    expect(versoData.entries.map((entry) => entry.color.r)).toEqual([20, 40, 30, 50, 10]);
    expect(versoData.entries[0].shareLabel).toBe("30%");
    const total = versoData.entries.reduce((sum, entry) => sum + entry.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  test("falls back to equal shares when populations are missing", () => {
    const versoData = getPaletteVersoData(
      createPalette(Array.from({ length: 5 }, (_, i) => ({ r: i, g: i, b: i }))),
    );

    versoData.entries.forEach((entry) => {
      expect(entry.share).toBeCloseTo(0.2, 5);
    });
  });

  test("keeps rare hues visible with a minimum stripe share", () => {
    const versoData = getPaletteVersoData(
      createPalette([
        { r: 1, g: 1, b: 1, population: 10000 },
        { r: 2, g: 2, b: 2, population: 5 },
        { r: 3, g: 3, b: 3, population: 5 },
        { r: 4, g: 4, b: 4, population: 5 },
        { r: 5, g: 5, b: 5, population: 5 },
      ]),
    );

    const smallest = versoData.entries[versoData.entries.length - 1];
    expect(smallest.share).toBeGreaterThan(0.02);
  });

  test("keeps palette order for plate layouts and falls back to hex names", () => {
    const versoData = getPaletteVersoData(
      createPalette([
        { r: 255, g: 0, b: 0, population: 1 },
        { r: 0, g: 255, b: 0, population: 900 },
        { r: 0, g: 0, b: 255, population: 400 },
      ]),
      ["Fire Engine", ""],
    );

    expect(versoData.layout).toBe("plate");
    expect(versoData.entries.map((entry) => entry.hex)).toEqual([
      "#FF0000",
      "#00FF00",
      "#0000FF",
    ]);
    expect(versoData.entries[0].name).toBe("Fire Engine");
    expect(versoData.entries[1].name).toBe("#00FF00");
    expect(versoData.entries[2].rgbLabel).toBe("0,0,255");
  });
});
