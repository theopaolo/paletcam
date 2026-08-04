import { describe, expect, test } from "bun:test";

import { HYBRID_STEPPED_CONTROLS, nearestStepIndex } from "./perceptual-tuning.js";

const DEFAULT_HYBRID = {
  repulsionRadius: 0.08,
  spreadStrength: 0.6,
  rarityStrength: 0.2,
  tone: 0.85,
  loyaltyStrength: 0.3,
};

describe("HYBRID_STEPPED_CONTROLS", () => {
  test("default detents reproduce the default hybrid settings", () => {
    const rebuilt = {};
    for (const control of Object.values(HYBRID_STEPPED_CONTROLS)) {
      Object.assign(rebuilt, control.steps[control.defaultIndex]);
    }

    expect(rebuilt).toEqual(DEFAULT_HYBRID);
  });

  test("every control has one label per step", () => {
    for (const control of Object.values(HYBRID_STEPPED_CONTROLS)) {
      expect(control.labelKeys.length).toBe(control.steps.length);
      expect(control.defaultIndex).toBeLessThan(control.steps.length);
    }
  });
});

describe("nearestStepIndex", () => {
  test("returns exact detent indexes", () => {
    expect(nearestStepIndex(HYBRID_STEPPED_CONTROLS.tone, { tone: 0.85 })).toBe(2);
    expect(nearestStepIndex(HYBRID_STEPPED_CONTROLS.rarity, { rarityStrength: 0 })).toBe(0);
  });

  test("snaps off-detent stored values to the closest step", () => {
    expect(nearestStepIndex(HYBRID_STEPPED_CONTROLS.tone, { tone: 0.7 })).toBe(1);
    expect(nearestStepIndex(HYBRID_STEPPED_CONTROLS.spread, { spreadStrength: 0.9 })).toBe(3);
    expect(nearestStepIndex(HYBRID_STEPPED_CONTROLS.loyalty, {})).toBe(0);
  });
});
