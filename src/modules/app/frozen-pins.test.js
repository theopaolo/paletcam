import { beforeEach, describe, expect, test } from "bun:test";

import { createFrozenPinStore } from "./frozen-pins.js";

const RED = { r: 220, g: 30, b: 30 };
const BLUE = { r: 30, g: 40, b: 200 };
// Third color kept below 215 so the +40 drift in the soft-tier test doesn't
// clamp at 255 and dilute the mean distance under the soft threshold.
const SCENE = [RED, BLUE, { r: 180, g: 180, b: 175 }];
// Every scene color far from every reference color (distance ≈ 190+),
// comfortably past the hard release threshold of 85.
const SWAPPED_SCENE = [
  { r: 30, g: 200, b: 60 },
  { r: 250, g: 180, b: 20 },
  { r: 80, g: 10, b: 90 },
];

let store;

beforeEach(() => {
  store = createFrozenPinStore();
});

describe("freeze / release", () => {
  test("pins a copy of the color and position, releasable by slot", () => {
    const position = { x: 0.4, y: 0.6 };
    store.freeze(1, RED, position, SCENE);

    expect(store.has(1)).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.get(1).color).toEqual(RED);
    expect(store.get(1).color).not.toBe(RED);
    expect(store.get(1).position).toEqual(position);

    const released = store.release(1);
    expect(released).toEqual([{ slot: 1, entry: { color: RED, position } }]);
    expect(store.size()).toBe(0);
    expect(store.release(1)).toEqual([]);
  });

  test("supports badge-less pins (null position)", () => {
    store.freeze(0, RED, null, SCENE);
    expect(store.get(0).position).toBeNull();
  });

  test("applyToColors overlays pinned colors onto the live palette by slot", () => {
    const live = [
      { r: 1, g: 1, b: 1 },
      { r: 2, g: 2, b: 2 },
      { r: 3, g: 3, b: 3 },
    ];
    expect(store.applyToColors(live)).toBe(live);

    store.freeze(1, RED, null, SCENE);
    const applied = store.applyToColors(live);
    expect(applied[0]).toEqual(live[0]);
    expect(applied[1]).toEqual(RED);
    expect(applied[2]).toEqual(live[2]);
  });

  test("getEntries lists pinned slots with color copies", () => {
    store.freeze(0, RED, null, SCENE);
    store.freeze(2, BLUE, null, SCENE);
    expect(store.getEntries()).toEqual([
      { slot: 0, color: RED },
      { slot: 2, color: BLUE },
    ]);
  });
});

describe("scene-change watchdog", () => {
  test("a hard scene swap releases every pin on the first extraction", () => {
    store.freeze(0, RED, { x: 0.1, y: 0.1 }, SCENE);
    store.freeze(1, BLUE, null, SCENE);

    const released = store.checkSceneChange(SWAPPED_SCENE);
    expect(released.map((r) => r.slot)).toEqual([0, 1]);
    expect(store.size()).toBe(0);
  });

  test("an unchanged scene never releases", () => {
    store.freeze(0, RED, null, SCENE);
    for (let i = 0; i < 10; i += 1) {
      expect(store.checkSceneChange(SCENE)).toEqual([]);
    }
    expect(store.has(0)).toBe(true);
  });

  test("soft drift releases only after the breach limit, and recovery resets it", () => {
    store.freeze(0, RED, null, SCENE);
    // Mean nearest distance ~70: between the soft (58) and hard (85) tiers.
    const drifted = SCENE.map((color) => ({
      r: Math.min(255, color.r + 40),
      g: Math.min(255, color.g + 40),
      b: Math.min(255, color.b + 40),
    }));

    expect(store.checkSceneChange(drifted)).toEqual([]);
    expect(store.checkSceneChange(drifted)).toEqual([]);
    // Back to the original scene: the breach counter resets.
    expect(store.checkSceneChange(SCENE)).toEqual([]);
    expect(store.checkSceneChange(drifted)).toEqual([]);
    expect(store.checkSceneChange(drifted)).toEqual([]);
    // Third consecutive soft breach lets go.
    const released = store.checkSceneChange(drifted);
    expect(released.map((r) => r.slot)).toEqual([0]);
  });

  test("a new pin re-baselines the scene reference for existing pins", () => {
    store.freeze(0, RED, null, SCENE);
    // Pinning another color in the swapped scene makes it the new reference…
    store.freeze(1, BLUE, null, SWAPPED_SCENE);
    // …so the swapped scene no longer reads as a change.
    expect(store.checkSceneChange(SWAPPED_SCENE)).toEqual([]);
    expect(store.size()).toBe(2);
  });

  test("ignores empty extractions and empty stores", () => {
    expect(store.checkSceneChange(SWAPPED_SCENE)).toEqual([]);
    store.freeze(0, RED, null, SCENE);
    expect(store.checkSceneChange([])).toEqual([]);
    expect(store.checkSceneChange(null)).toEqual([]);
  });
});

describe("presence watchdog", () => {
  test("releases a pin only after consecutive below-threshold extractions", () => {
    store.freeze(0, RED, null, SCENE);

    // Healthy presence establishes the pin's personal baseline (0.02 → an
    // adaptive threshold capped at 0.004).
    expect(store.processPresence([{ slot: 0, presence: 0.02 }])).toEqual([]);
    // One vanished extraction is not enough…
    expect(store.processPresence([{ slot: 0, presence: 0 }])).toEqual([]);
    expect(store.has(0)).toBe(true);
    // …two consecutive ones release the pin.
    const released = store.processPresence([{ slot: 0, presence: 0 }]);
    expect(released.map((r) => r.slot)).toEqual([0]);
    expect(store.size()).toBe(0);
  });

  test("a presence recovery resets the breach counter", () => {
    store.freeze(0, RED, null, SCENE);
    store.processPresence([{ slot: 0, presence: 0.02 }]);
    store.processPresence([{ slot: 0, presence: 0 }]);
    // Color reappears: counter resets, the next single dropout doesn't release.
    store.processPresence([{ slot: 0, presence: 0.02 }]);
    expect(store.processPresence([{ slot: 0, presence: 0 }])).toEqual([]);
    expect(store.has(0)).toBe(true);
  });

  test("a faint pin is judged against its own baseline, floored at the minimum", () => {
    store.freeze(0, RED, null, SCENE);
    // Best presence ever is tiny (0.001 → threshold floors at 0.0005), so a
    // steady faint presence above the floor never breaches.
    expect(store.processPresence([{ slot: 0, presence: 0.001 }])).toEqual([]);
    expect(store.processPresence([{ slot: 0, presence: 0.0008 }])).toEqual([]);
    expect(store.processPresence([{ slot: 0, presence: 0.0008 }])).toEqual([]);
    expect(store.has(0)).toBe(true);
  });

  test("only the vanished pin releases; others keep their state", () => {
    store.freeze(0, RED, null, SCENE);
    store.freeze(1, BLUE, null, SCENE);
    const healthy = { slot: 1, presence: 0.05 };

    store.processPresence([{ slot: 0, presence: 0.05 }, healthy]);
    store.processPresence([{ slot: 0, presence: 0 }, healthy]);
    const released = store.processPresence([{ slot: 0, presence: 0 }, healthy]);

    expect(released.map((r) => r.slot)).toEqual([0]);
    expect(store.has(1)).toBe(true);
  });
});

describe("reset", () => {
  test("clears pins, watchdog state, and scene reference", () => {
    store.freeze(0, RED, null, SCENE);
    store.processPresence([{ slot: 0, presence: 0.02 }]);
    store.reset();

    expect(store.size()).toBe(0);
    expect(store.getEntries()).toEqual([]);
    expect(store.checkSceneChange(SWAPPED_SCENE)).toEqual([]);
  });
});
