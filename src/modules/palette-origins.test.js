import { describe, expect, test } from "bun:test";

import {
  computeColorPresence,
  computeSwatchOrigins,
  createSwatchOriginTracker,
  hitTestOriginMarkers,
} from "./palette-origins.js";

// 120×90 aligns exactly with the 12×9 cluster grid: one cell = 10×10 px, and
// the pixel count (10800) keeps the sampling stride at 1 so every pixel is
// scanned — geometry assertions stay exact.
const WIDTH = 120;
const HEIGHT = 90;

const RED = { r: 220, g: 30, b: 30 };
const WHITE = { r: 255, g: 255, b: 255 };

function createFrame(background = WHITE) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const frame = {
    data,
    fillRect(x, y, w, h, color) {
      for (let py = y; py < y + h; py += 1) {
        for (let px = x; px < x + w; px += 1) {
          const offset = (py * WIDTH + px) * 4;
          data[offset] = color.r;
          data[offset + 1] = color.g;
          data[offset + 2] = color.b;
          data[offset + 3] = 255;
        }
      }
    },
  };
  frame.fillRect(0, 0, WIDTH, HEIGHT, background);
  return frame;
}

function expectWithinRect(origin, x, y, w, h) {
  expect(origin).not.toBeNull();
  expect(origin.x).toBeGreaterThanOrEqual(x / WIDTH);
  expect(origin.x).toBeLessThanOrEqual((x + w) / WIDTH);
  expect(origin.y).toBeGreaterThanOrEqual(y / HEIGHT);
  expect(origin.y).toBeLessThanOrEqual((y + h) / HEIGHT);
}

describe("computeSwatchOrigins", () => {
  test("finds the centroid of a color's single region", () => {
    const frame = createFrame();
    frame.fillRect(10, 10, 10, 10, RED);

    const [origin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(origin, 10, 10, 10, 10);
  });

  test("sits on the densest region, not the global centroid", () => {
    const frame = createFrame();
    frame.fillRect(10, 10, 10, 10, RED); // 100 px on the left
    frame.fillRect(100, 70, 4, 4, RED); // 16 px bottom-right

    const [origin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [RED]);
    // A global centroid would float in the empty middle of the frame.
    expectWithinRect(origin, 10, 10, 10, 10);
  });

  test("region hysteresis keeps a badge in its previous, comparably dense region", () => {
    const frame = createFrame();
    frame.fillRect(10, 10, 10, 10, RED); // 100 px — the densest region
    frame.fillRect(80, 10, 7, 10, RED); // 70 px — above the 40% stickiness bar

    const [freshOrigin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(freshOrigin, 10, 10, 10, 10);

    const previousOrigin = { x: 84 / WIDTH, y: 15 / HEIGHT };
    const [stickyOrigin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [RED], [previousOrigin]);
    expectWithinRect(stickyOrigin, 80, 10, 7, 10);
  });

  test("returns null for a color with no matching pixels", () => {
    const frame = createFrame();
    const [origin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [RED]);
    expect(origin).toBeNull();
  });

  test("a neutral swatch only matches neutral pixels close in brightness", () => {
    const frame = createFrame();
    frame.fillRect(10, 10, 10, 10, { r: 50, g: 50, b: 50 }); // dark gray
    frame.fillRect(80, 60, 10, 10, { r: 200, g: 200, b: 200 }); // light gray
    // Chromatic pixels with the same average brightness as the dark gray
    // must not attract the neutral badge.
    frame.fillRect(80, 10, 10, 10, { r: 130, g: 15, b: 15 });

    const [origin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [{ r: 55, g: 55, b: 55 }]);
    expectWithinRect(origin, 10, 10, 10, 10);
  });

  test("guards degenerate inputs", () => {
    expect(computeSwatchOrigins(null, WIDTH, HEIGHT, [RED])).toEqual([null]);
    expect(computeSwatchOrigins(new Uint8ClampedArray(0), 0, 0, [RED])).toEqual([null]);
    expect(computeSwatchOrigins(new Uint8ClampedArray(4), 1, 1, [])).toEqual([]);
  });
});

describe("computeColorPresence", () => {
  test("reports the matched fraction of the frame", () => {
    const frame = createFrame();
    frame.fillRect(0, 0, 30, HEIGHT, RED); // exactly a quarter of the pixels

    const [presence] = computeColorPresence(frame.data, WIDTH, HEIGHT, [RED]);
    expect(presence).toBeCloseTo(0.25, 5);
  });

  test("reports 0 for an absent color", () => {
    const frame = createFrame();
    const [presence] = computeColorPresence(frame.data, WIDTH, HEIGHT, [RED]);
    expect(presence).toBe(0);
  });

  test("matches wider than the origin scan (pinned colors sit at the vivid edge)", () => {
    const frame = createFrame();
    // 40 RGB units from the swatch: outside the origin threshold (32),
    // inside the presence threshold (48).
    frame.fillRect(0, 0, 30, HEIGHT, { r: 180, g: 30, b: 30 });
    const swatch = { r: 220, g: 30, b: 30 };

    const [origin] = computeSwatchOrigins(frame.data, WIDTH, HEIGHT, [swatch]);
    const [presence] = computeColorPresence(frame.data, WIDTH, HEIGHT, [swatch]);
    expect(origin).toBeNull();
    expect(presence).toBeCloseTo(0.25, 5);
  });
});

describe("createSwatchOriginTracker", () => {
  test("carries region memory between extractions for hysteresis", () => {
    const tracker = createSwatchOriginTracker();

    // First frame: the color only lives in the right-hand region.
    const firstFrame = createFrame();
    firstFrame.fillRect(80, 10, 7, 10, RED);
    const [firstOrigin] = tracker.compute(firstFrame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(firstOrigin, 80, 10, 7, 10);

    // Second frame: a denser region appears on the left; the tracked badge
    // stays in its established region while a fresh scan would move.
    const secondFrame = createFrame();
    secondFrame.fillRect(10, 10, 10, 10, RED);
    secondFrame.fillRect(80, 10, 7, 10, RED);
    const [trackedOrigin] = tracker.compute(secondFrame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(trackedOrigin, 80, 10, 7, 10);

    const [freshOrigin] = computeSwatchOrigins(secondFrame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(freshOrigin, 10, 10, 10, 10);
  });

  test("reset drops the region memory", () => {
    const tracker = createSwatchOriginTracker();
    const firstFrame = createFrame();
    firstFrame.fillRect(80, 10, 7, 10, RED);
    tracker.compute(firstFrame.data, WIDTH, HEIGHT, [RED]);
    tracker.reset();

    const secondFrame = createFrame();
    secondFrame.fillRect(10, 10, 10, 10, RED);
    secondFrame.fillRect(80, 10, 7, 10, RED);
    const [origin] = tracker.compute(secondFrame.data, WIDTH, HEIGHT, [RED]);
    expectWithinRect(origin, 10, 10, 10, 10);
  });
});

describe("hitTestOriginMarkers", () => {
  const markers = [
    { x: 0.25, y: 0.5, slot: 0 },
    { x: 0.75, y: 0.5, slot: 1 },
  ];

  test("returns the slot of a marker within the hit radius", () => {
    expect(hitTestOriginMarkers(markers, 0.25 * WIDTH + 10, 0.5 * HEIGHT, WIDTH, HEIGHT)).toBe(0);
  });

  test("prefers the nearest marker when several are in range", () => {
    const closeMarkers = [
      { x: 0.4, y: 0.5, slot: 0 },
      { x: 0.5, y: 0.5, slot: 1 },
    ];
    expect(hitTestOriginMarkers(closeMarkers, 0.47 * WIDTH, 0.5 * HEIGHT, WIDTH, HEIGHT, 40)).toBe(
      1,
    );
  });

  test("returns -1 when the tap misses every marker", () => {
    expect(hitTestOriginMarkers(markers, 0, 0, WIDTH, HEIGHT)).toBe(-1);
    expect(hitTestOriginMarkers([], 10, 10, WIDTH, HEIGHT)).toBe(-1);
  });
});
