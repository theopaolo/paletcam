import { findNearestColor } from "../color-math.js";

/**
 * State machine for frozen palette pins: which swatch slots are pinned to a
 * color, plus the two watchdogs that decide when pins let go on their own.
 *
 * Pure bookkeeping — no DOM, no canvas, no haptics. The live preview
 * controller owns the presentation side (falling-badge animation, lock-hint
 * repaint, vibration) and reacts to the release lists returned here.
 */

// A frozen palette belongs to the scene it was pinned in. Each fresh
// extraction is compared to the freeze-time snapshot (mean nearest-color
// distance). Two release tiers: an unmistakable scene swap (hard) releases on
// the first extraction (≤200ms), while moderate drift (soft) — reframing,
// slow pans, autoexposure — must persist for several extractions before the
// pins let go. Static-scene noise measures ≈ 8, a full scene change ≈ 100.
const SCENE_HARD_DISTANCE = 85;
const SCENE_SOFT_DISTANCE = 58;
const SCENE_SOFT_BREACH_LIMIT = 3;
// Per-pin presence: a frozen color whose matching pixels vanish from the
// frame (covered, moved away from) releases individually. The release
// threshold adapts per pin — a fraction of the best presence that pin ever
// measured — so a small vivid object (which only ever matches a sliver of
// pixels) is judged against its own normal, clamped to sane bounds.
const PRESENCE_BASELINE_RATIO = 0.25;
const PRESENCE_MAX_THRESHOLD = 0.004;
const PRESENCE_MIN_THRESHOLD = 0.0005;
const PRESENCE_BREACH_LIMIT = 2;

/**
 * @returns {FrozenPinStore} see the factory body for the method contracts;
 *   every release-style method returns `Array<{ slot: number, entry: {
 *   color: object, position: { x: number, y: number } | null } }>` so the
 *   caller can animate what actually let go.
 */
export function createFrozenPinStore() {
  const pins = new Map();
  const presenceBreaches = new Map();
  let sceneReference = null;
  let sceneBreachCount = 0;

  /**
   * Pin a slot to a color. `sceneColors` (the current raw extraction)
   * becomes the scene-change reference. Note that every new pin re-baselines
   * that reference for ALL existing pins: the watchdog always judges drift
   * against the most recently seen scene, not the scene of the oldest pin.
   */
  function freeze(slot, color, position, sceneColors) {
    pins.set(slot, {
      color: { ...color },
      position: position ? { ...position } : null,
    });
    sceneReference = Array.isArray(sceneColors)
      ? sceneColors.map((sceneColor) => ({ ...sceneColor }))
      : [];
    sceneBreachCount = 0;
  }

  function release(slot) {
    const entry = pins.get(slot);
    if (!entry) {
      return [];
    }

    pins.delete(slot);
    presenceBreaches.delete(slot);
    if (pins.size === 0) {
      sceneReference = null;
      sceneBreachCount = 0;
    }
    return [{ slot, entry }];
  }

  function releaseAll() {
    return Array.from(pins.keys()).flatMap((slot) => release(slot));
  }

  /**
   * Per-pin presence watchdog: releases a pin once its matching pixels have
   * been absent from the frame for consecutive extractions.
   * @param {Array<{ slot: number, presence: number }>} presenceEntries
   */
  function processPresence(presenceEntries) {
    if (!Array.isArray(presenceEntries) || presenceEntries.length === 0) {
      return [];
    }

    const released = [];
    for (const { slot, presence } of presenceEntries) {
      if (!pins.has(slot)) {
        presenceBreaches.delete(slot);
        continue;
      }

      const state = presenceBreaches.get(slot) ?? { maxPresence: 0, breachCount: 0 };
      state.maxPresence = Math.max(state.maxPresence, presence);

      const releaseThreshold = Math.min(
        PRESENCE_MAX_THRESHOLD,
        Math.max(PRESENCE_MIN_THRESHOLD, state.maxPresence * PRESENCE_BASELINE_RATIO),
      );

      if (presence < releaseThreshold) {
        state.breachCount += 1;
        if (state.breachCount >= PRESENCE_BREACH_LIMIT) {
          released.push(...release(slot));
          continue;
        }
      } else {
        state.breachCount = 0;
      }
      presenceBreaches.set(slot, state);
    }

    return released;
  }

  /**
   * Scene-change watchdog: compares a fresh raw extraction against the
   * freeze-time snapshot. A sustained mismatch releases every pin.
   * @param {Array<{ r: number, g: number, b: number }>} rawColors
   */
  function checkSceneChange(rawColors) {
    if (
      pins.size === 0 ||
      !sceneReference ||
      sceneReference.length === 0 ||
      !Array.isArray(rawColors) ||
      rawColors.length === 0
    ) {
      return [];
    }

    let totalDistance = 0;
    for (const color of rawColors) {
      const nearest = findNearestColor(color, sceneReference);
      totalDistance += Math.sqrt(nearest.distanceSquared);
    }

    const meanDistance = totalDistance / rawColors.length;
    if (meanDistance > SCENE_HARD_DISTANCE) {
      return releaseAll();
    }

    if (meanDistance > SCENE_SOFT_DISTANCE) {
      sceneBreachCount += 1;
      if (sceneBreachCount >= SCENE_SOFT_BREACH_LIMIT) {
        return releaseAll();
      }
      return [];
    }

    sceneBreachCount = 0;
    return [];
  }

  function reset() {
    pins.clear();
    presenceBreaches.clear();
    sceneReference = null;
    sceneBreachCount = 0;
  }

  return {
    freeze,
    release,
    releaseAll,
    processPresence,
    checkSceneChange,
    reset,
    has: (slot) => pins.has(slot),
    get: (slot) => pins.get(slot) ?? null,
    size: () => pins.size,
    /** Frozen colors with their slots, as sent to the extraction worker. */
    getEntries: () => Array.from(pins, ([slot, entry]) => ({ slot, color: { ...entry.color } })),
    /** Overlays pinned colors onto a live palette, slot by slot. */
    applyToColors: (colors) =>
      pins.size === 0 ? colors : colors.map((color, slot) => pins.get(slot)?.color ?? color),
  };
}
