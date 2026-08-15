import { describe, expect, test } from "bun:test";

import { rgbDistance } from "./color-math.js";
import { selectPaletteHybrid } from "./hybrid-selector.js";

const WIDTH = 64;
const HEIGHT = 64;

const RED = { r: 200, g: 40, b: 40 };
const BLUE = { r: 40, g: 80, b: 200 };
const YELLOW = { r: 230, g: 200, b: 40 };
const GRAY = { r: 128, g: 128, b: 128 };
const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

/** Frame split into vertical bands, one per color, equal widths. */
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

// The quantizer works in 5-bit-per-channel space and picks are tone-blended,
// so extracted colors approximate the sources rather than matching exactly.
const EXTRACTION_TOLERANCE = 30;

function expectPaletteCovers(colors, sources) {
  for (const source of sources) {
    const nearest = Math.min(...colors.map((color) => rgbDistance(color, source)));
    expect(nearest).toBeLessThan(EXTRACTION_TOLERANCE);
  }
}

describe("selectPaletteHybrid", () => {
  test("returns the requested number of colors, each carrying a population", () => {
    const frame = createBandedFrame([RED, BLUE, YELLOW, GRAY]);
    const result = selectPaletteHybrid(frame, WIDTH, HEIGHT, 4);

    expect(result.colors).toHaveLength(4);
    expectPaletteCovers(result.colors, [RED, BLUE, YELLOW, GRAY]);

    for (const color of result.colors) {
      expect(Number.isFinite(color.population)).toBe(true);
      expect(color.population).toBeGreaterThanOrEqual(0);
    }
    const totalPopulation = result.colors.reduce((sum, color) => sum + color.population, 0);
    expect(totalPopulation).toBeGreaterThan(0);
  });

  test("rerunning with its own output as previousColors is stable", () => {
    const frame = createBandedFrame([RED, BLUE, YELLOW, GRAY]);
    const first = selectPaletteHybrid(frame, WIDTH, HEIGHT, 4);
    const second = selectPaletteHybrid(frame, WIDTH, HEIGHT, 4, {
      previousColors: first.colors,
    });

    expect(second.colors).toEqual(first.colors);
  });

  test("loyalty steers a near-equal pick toward the previous palette", () => {
    // Two vivid hues with equal mass compete for a single slot.
    const frame = createBandedFrame([RED, BLUE]);

    const baseline = selectPaletteHybrid(frame, WIDTH, HEIGHT, 1, {
      loyaltyStrength: 0,
    });
    expect(baseline.colors).toHaveLength(1);

    // Feed the loser of the baseline pick back as the previous palette: with
    // loyalty in play, the palette must stay with it instead of flipping.
    const winnerWasRed =
      rgbDistance(baseline.colors[0], RED) < rgbDistance(baseline.colors[0], BLUE);
    const previousColor = winnerWasRed ? BLUE : RED;
    const loyal = selectPaletteHybrid(frame, WIDTH, HEIGHT, 1, {
      previousColors: [previousColor],
      loyaltyStrength: 2,
    });

    expect(rgbDistance(loyal.colors[0], previousColor)).toBeLessThan(EXTRACTION_TOLERANCE);
  });

  test("neutral balance can reserve small dark and light anchors", () => {
    const frame = createBandedFrame([
      ...Array(3).fill(BLACK),
      ...Array(3).fill(WHITE),
      ...Array(58).fill(RED),
    ]);

    const balanced = selectPaletteHybrid(frame, WIDTH, HEIGHT, 4, {
      neutralBalance: "balanced",
    });
    const neutralForward = selectPaletteHybrid(frame, WIDTH, HEIGHT, 4, {
      neutralBalance: "neutrals",
    });

    expect(balanced.neutralCount).toBe(0);
    expect(neutralForward.neutralCount).toBe(2);
    expectPaletteCovers(neutralForward.colors, [BLACK, WHITE]);
  });

  test("returns an empty palette for degenerate input", () => {
    expect(selectPaletteHybrid(null, WIDTH, HEIGHT, 4).colors).toEqual([]);
    expect(selectPaletteHybrid(new Uint8ClampedArray(0), 0, 0, 4).colors).toEqual([]);
  });
});
