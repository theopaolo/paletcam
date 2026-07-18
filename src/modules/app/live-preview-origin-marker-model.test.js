import { describe, expect, mock, test } from "bun:test";

import { createLivePreviewOriginMarkerModel } from "./live-preview-origin-marker-model.js";

const RED = { r: 220, g: 30, b: 20 };
const BLUE = { r: 20, g: 40, b: 210 };
const GREEN = { r: 30, g: 190, b: 70 };

function easeOutBack(progress) {
  const overshoot = 1.70158;
  const p = progress - 1;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}

function createFixture({ findNearestColor, hitTestMarkers, now, random } = {}) {
  let currentTime = 0;
  const clock = now ?? mock(() => currentTime);
  const randomSource = random ?? mock(() => 0.75);
  const nearest =
    findNearestColor ?? mock((_color, candidates) => (candidates.length > 0 ? { index: 0 } : null));
  const hitTest = hitTestMarkers ?? mock(() => 0);
  const model = createLivePreviewOriginMarkerModel({
    findNearestColor: nearest,
    hitTestMarkers: hitTest,
    now: clock,
    random: randomSource,
  });

  return {
    clock,
    hitTest,
    model,
    nearest,
    randomSource,
    setTime(value) {
      currentTime = value;
    },
  };
}

function markerFrame(overrides = {}) {
  return {
    displayColors: [RED],
    frameHeight: 300,
    frameWidth: 400,
    frozenBySlot: [null],
    origins: [{ x: 0.2, y: 0.3 }],
    rawColors: [RED],
    ...overrides,
  };
}

describe("live origin marker positioning", () => {
  test("places a new marker at its raw origin and reproduces pop and smoothing math", () => {
    const fixture = createFixture();
    fixture.setTime(100);

    const first = fixture.model.build(markerFrame());

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      color: RED,
      label: 1,
      slot: 0,
      x: 0.2,
      y: 0.3,
    });
    expect(first[0].scale).toBeCloseTo(easeOutBack(0), 12);

    fixture.setTime(275);
    const moving = fixture.model.build(markerFrame({ origins: [{ x: 0.8, y: 0.9 }] }));
    expect(moving[0].x).toBeCloseTo(0.26, 12);
    expect(moving[0].y).toBeCloseTo(0.36, 12);
    expect(moving[0].scale).toBeCloseTo(easeOutBack(0.5), 12);

    fixture.setTime(450);
    const settled = fixture.model.build(markerFrame({ origins: [{ x: 0.8, y: 0.9 }] }));
    expect(settled[0].x).toBeCloseTo(0.314, 12);
    expect(settled[0].y).toBeCloseTo(0.414, 12);
    expect(settled[0].scale).toBe(1);
    expect(fixture.clock).toHaveBeenCalledTimes(3);
  });

  test("matches each display color to the nearest raw origin and rebirths after a missing origin", () => {
    const nearest = mock((color) => ({ index: color === BLUE ? 1 : 0 }));
    const fixture = createFixture({ findNearestColor: nearest });

    const markers = fixture.model.build(
      markerFrame({
        displayColors: [BLUE, RED],
        frozenBySlot: [null, null],
        origins: [null, { x: 0.75, y: 0.25 }],
        rawColors: [RED, BLUE],
      }),
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ color: BLUE, slot: 0, x: 0.75, y: 0.25 });
    expect(fixture.model.getPosition(1)).toBeNull();

    fixture.setTime(200);
    const reappeared = fixture.model.build(
      markerFrame({
        displayColors: [BLUE, RED],
        frozenBySlot: [null, null],
        origins: [
          { x: 0.1, y: 0.9 },
          { x: 0.75, y: 0.25 },
        ],
        rawColors: [RED, BLUE],
      }),
    );
    expect(reappeared[1].scale).toBeCloseTo(easeOutBack(0), 12);
  });

  test("keeps positioned frozen markers fixed and badge-less frozen slots absent", () => {
    const fixture = createFixture();
    const frozenPosition = { x: 0.65, y: 0.45 };

    const markers = fixture.model.build(
      markerFrame({
        displayColors: [RED, BLUE],
        frozenBySlot: [
          { color: GREEN, position: frozenPosition },
          { color: BLUE, position: null },
        ],
        origins: [],
        rawColors: [],
      }),
    );

    expect(markers).toEqual([
      {
        color: GREEN,
        frozen: true,
        label: 1,
        slot: 0,
        x: 0.65,
        y: 0.45,
      },
    ]);
    expect(fixture.nearest).not.toHaveBeenCalled();

    const position = fixture.model.getPosition(0);
    expect(position).toEqual(frozenPosition);
    expect(position).not.toBe(frozenPosition);
    position.x = 0;
    expect(fixture.model.getPosition(0)).toEqual(frozenPosition);
    expect(fixture.model.getPosition(1)).toBeNull();
  });

  test("truncates stale positions when the display palette shrinks", () => {
    const nearest = mock((color) => ({ index: color === RED ? 0 : color === BLUE ? 1 : 2 }));
    const fixture = createFixture({ findNearestColor: nearest });
    fixture.model.build(
      markerFrame({
        displayColors: [RED, BLUE, GREEN],
        frozenBySlot: [null, null, null],
        origins: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
        ],
        rawColors: [RED, BLUE, GREEN],
      }),
    );

    fixture.model.build(markerFrame());
    expect(fixture.model.getPosition(1)).toBeNull();
    expect(fixture.model.getPosition(2)).toBeNull();

    fixture.setTime(100);
    const expanded = fixture.model.build(
      markerFrame({
        displayColors: [RED, BLUE],
        frozenBySlot: [null, null],
        origins: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.8 },
        ],
        rawColors: [RED, BLUE],
      }),
    );
    expect(expanded[1].scale).toBeCloseTo(easeOutBack(0), 12);
  });
});

describe("live origin marker releases", () => {
  test("samples random then time once for each positioned animated release", () => {
    const calls = [];
    const randomValues = [0.75, 0.25];
    const timeValues = [100, 110, 210];
    const fixture = createFixture({
      random: mock(() => {
        calls.push("random");
        return randomValues.shift();
      }),
      now: mock(() => {
        calls.push("now");
        return timeValues.shift();
      }),
    });

    fixture.model.handleReleased(
      [
        { slot: 0, entry: { color: RED, position: { x: 0.2, y: 0.3 } } },
        { slot: 1, entry: { color: BLUE, position: null } },
        { slot: 2, entry: { color: GREEN, position: { x: 0.7, y: 0.8 } } },
      ],
      { animate: true },
    );

    expect(calls).toEqual(["random", "now", "random", "now"]);
    expect(fixture.randomSource).toHaveBeenCalledTimes(2);
    expect(fixture.clock).toHaveBeenCalledTimes(2);

    const falling = fixture.model.build(markerFrame({ displayColors: [], frozenBySlot: [] }));
    expect(falling).toHaveLength(2);
    expect(falling[0].x).toBeCloseTo(0.211, 12);
    expect(falling[1].x).toBeCloseTo(0.69, 12);
    expect(calls.at(-1)).toBe("now");
  });

  test("does not sample animation dependencies for non-animated or badge-less releases", () => {
    const fixture = createFixture();

    fixture.model.handleReleased([
      { slot: 0, entry: { color: RED, position: { x: 0.2, y: 0.3 } } },
    ]);
    fixture.model.handleReleased([{ slot: 1, entry: { color: BLUE, position: null } }], {
      animate: true,
    });

    expect(fixture.randomSource).not.toHaveBeenCalled();
    expect(fixture.clock).not.toHaveBeenCalled();
    expect(fixture.model.hasActivity()).toBe(false);
  });

  test("reproduces falling-badge hop, gravity, rotation, and fade math", () => {
    const fixture = createFixture();
    fixture.setTime(0);
    fixture.model.handleReleased(
      [{ slot: 1, entry: { color: RED, position: { x: 0.5, y: 0.5 } } }],
      { animate: true },
    );

    fixture.setTime(100);
    const markers = fixture.model.build(
      markerFrame({ displayColors: [], frameHeight: 400, frameWidth: 200, frozenBySlot: [] }),
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      alpha: 1 - 100 / 1400,
      clamp: false,
      color: RED,
      frozen: true,
      label: 2,
      rotation: 0.08,
    });
    expect(markers[0].x).toBeCloseTo(0.52, 12);
    expect(markers[0].y).toBeCloseTo(0.4825, 12);
  });

  test("expires falling badges after the exact duration or after leaving the frame", () => {
    const fixture = createFixture();
    fixture.model.handleReleased(
      [{ slot: 0, entry: { color: RED, position: { x: 0.5, y: 0.5 } } }],
      { animate: true },
    );

    fixture.setTime(1401);
    expect(fixture.model.build(markerFrame({ displayColors: [], frozenBySlot: [] }))).toEqual([]);
    expect(fixture.model.hasActivity()).toBe(false);

    fixture.model.handleReleased(
      [{ slot: 0, entry: { color: RED, position: { x: 0.5, y: 0.5 } } }],
      { animate: true },
    );
    fixture.setTime(2401);
    expect(
      fixture.model.build(
        markerFrame({ displayColors: [], frameHeight: 400, frameWidth: 200, frozenBySlot: [] }),
      ),
    ).toEqual([]);
    expect(fixture.model.hasActivity()).toBe(false);
  });

  test("makes a released live slot rebirth on its next origin", () => {
    const fixture = createFixture();
    fixture.model.build(markerFrame());
    fixture.model.handleReleased([
      { slot: 0, entry: { color: RED, position: { x: 0.2, y: 0.3 } } },
    ]);

    fixture.setTime(200);
    const markers = fixture.model.build(markerFrame({ origins: [{ x: 0.7, y: 0.6 }] }));
    expect(markers[0]).toMatchObject({ x: 0.7, y: 0.6 });
    expect(markers[0].scale).toBeCloseTo(easeOutBack(0), 12);
  });
});

describe("live origin marker interaction and lifecycle", () => {
  test("returns live markers before falling markers but hit-tests only live markers in CSS pixels", () => {
    const fixture = createFixture({ hitTestMarkers: mock(() => 0) });
    fixture.model.handleReleased(
      [{ slot: 2, entry: { color: GREEN, position: { x: 0.8, y: 0.7 } } }],
      { animate: true },
    );
    fixture.setTime(100);

    const markers = fixture.model.build(markerFrame());
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ color: RED, slot: 0 });
    expect(markers[1]).toMatchObject({ clamp: false, color: GREEN, frozen: true });

    expect(
      fixture.model.hitTestAt({
        frameHeight: 300,
        frameWidth: 400,
        normalizedX: 0.25,
        normalizedY: 0.75,
      }),
    ).toBe(0);
    expect(fixture.hitTest).toHaveBeenCalledTimes(1);
    expect(fixture.hitTest.mock.calls[0][0]).toEqual([markers[0]]);
    expect(fixture.hitTest.mock.calls[0].slice(1)).toEqual([100, 225, 400, 300]);
  });

  test("reset clears positions, activity, falling markers, and hit-test state", () => {
    const fixture = createFixture();
    fixture.model.build(markerFrame());
    fixture.model.handleReleased(
      [{ slot: 2, entry: { color: GREEN, position: { x: 0.8, y: 0.7 } } }],
      { animate: true },
    );
    expect(fixture.model.hasActivity()).toBe(true);

    fixture.model.reset();

    expect(fixture.model.hasActivity()).toBe(false);
    expect(fixture.model.getPosition(0)).toBeNull();
    expect(
      fixture.model.hitTestAt({
        frameHeight: 300,
        frameWidth: 400,
        normalizedX: 0.25,
        normalizedY: 0.75,
      }),
    ).toBe(-1);
    expect(fixture.hitTest).not.toHaveBeenCalled();
    expect(fixture.model.build(markerFrame({ displayColors: [], frozenBySlot: [] }))).toEqual([]);
  });

  test("does not catch injected clock, color-match, random, or hit-test failures", () => {
    const clockError = new Error("clock failed");
    const clockFixture = createFixture({
      now: mock(() => {
        throw clockError;
      }),
    });
    expect(() => clockFixture.model.build(markerFrame())).toThrow(clockError);

    const nearestError = new Error("nearest failed");
    const nearestFixture = createFixture({
      findNearestColor: mock(() => {
        throw nearestError;
      }),
    });
    expect(() => nearestFixture.model.build(markerFrame())).toThrow(nearestError);

    const randomError = new Error("random failed");
    const randomFixture = createFixture({
      random: mock(() => {
        throw randomError;
      }),
    });
    expect(() =>
      randomFixture.model.handleReleased(
        [{ slot: 0, entry: { color: RED, position: { x: 0.2, y: 0.3 } } }],
        { animate: true },
      ),
    ).toThrow(randomError);

    const hitError = new Error("hit failed");
    const hitFixture = createFixture({
      hitTestMarkers: mock(() => {
        throw hitError;
      }),
    });
    hitFixture.model.build(markerFrame());
    expect(() =>
      hitFixture.model.hitTestAt({
        frameHeight: 300,
        frameWidth: 400,
        normalizedX: 0.2,
        normalizedY: 0.3,
      }),
    ).toThrow(hitError);
  });
});
