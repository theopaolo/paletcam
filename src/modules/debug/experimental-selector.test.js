import { describe, expect, test } from "bun:test";

import { oklabToRgb, rgbToOklab } from "../color-space-oklch.js";
import {
  interpolateGridTone,
  selectPaletteExperimental,
  selectPaletteGridHybrid,
} from "./experimental-selector.js";

const WIDTH = 64;
const HEIGHT = 64;

function createBandedFrame(colors) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const bandWidth = WIDTH / colors.length;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const color = colors[Math.min(colors.length - 1, Math.floor(x / bandWidth))];
      const offset = (y * WIDTH + x) * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe("experimental grid pipelines", () => {
  test("isolates sRGB and OKLab Tone interpolation", () => {
    const soft = { r: 255, g: 0, b: 0 };
    const vivid = { r: 0, g: 0, b: 255 };
    const softLab = rgbToOklab(soft.r, soft.g, soft.b);
    const vividLab = rgbToOklab(vivid.r, vivid.g, vivid.b);

    const srgb = interpolateGridTone(soft, vivid, softLab, vividLab, 0.5, "srgb");
    const oklab = interpolateGridTone(soft, vivid, softLab, vividLab, 0.5, "oklab");
    const expectedLab = oklabToRgb(
      (softLab.L + vividLab.L) / 2,
      (softLab.a + vividLab.a) / 2,
      (softLab.b + vividLab.b) / 2,
    );

    expect(srgb).toEqual({ r: 128, g: 0, b: 128 });
    expect(oklab).toEqual(expectedLab);
    expect(oklab).not.toEqual(srgb);
  });

  test("feeds OKLab grid candidates through the production selector", () => {
    const frame = createBandedFrame([
      { r: 210, g: 45, b: 45 },
      { r: 40, g: 95, b: 220 },
      { r: 235, g: 195, b: 35 },
      { r: 128, g: 128, b: 128 },
    ]);
    const result = selectPaletteGridHybrid(frame, WIDTH, HEIGHT, 4, {
      repulsionRadius: 0.075,
      tone: 0.85,
    });

    expect(result.gridCandidates.length).toBeGreaterThanOrEqual(4);
    expect(result.colors).toHaveLength(4);
    expect(result.neutralCount).toBeGreaterThanOrEqual(1);
    for (const color of result.colors) {
      expect(Number.isFinite(color.population)).toBe(true);
      expect(color.population).toBeGreaterThanOrEqual(0);
    }
  });

  test("applies neutral balance to the direct grid experiment", () => {
    const frame = createBandedFrame([
      ...Array(3).fill({ r: 0, g: 0, b: 0 }),
      ...Array(3).fill({ r: 255, g: 255, b: 255 }),
      ...Array(58).fill({ r: 210, g: 45, b: 45 }),
    ]);

    const balanced = selectPaletteExperimental(frame, WIDTH, HEIGHT, 4, {
      neutralBalance: "balanced",
    });
    const neutralForward = selectPaletteExperimental(frame, WIDTH, HEIGHT, 4, {
      neutralBalance: "neutrals",
    });

    expect(balanced.neutralCount).toBe(0);
    expect(neutralForward.neutralCount).toBe(2);
    expect(Math.min(...neutralForward.colors.map((color) => color.r))).toBeLessThan(16);
    expect(Math.max(...neutralForward.colors.map((color) => color.r))).toBeGreaterThan(239);
  });

  test("returns an empty hybrid palette for degenerate input", () => {
    expect(selectPaletteGridHybrid(null, WIDTH, HEIGHT, 4).colors).toEqual([]);
    expect(selectPaletteGridHybrid(new Uint8ClampedArray(0), 0, 0, 4).colors).toEqual([]);
  });
});
