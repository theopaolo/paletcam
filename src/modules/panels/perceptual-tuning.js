/**
 * Stepped detents for the perceptual (hybrid) selector.
 *
 * Each stepped control exposes four calibrated detents instead of a 0-100
 * range: below ~15 points of continuous movement the palette change is
 * smaller than frame-to-frame camera noise, so named steps keep results
 * repeatable. The "spread" control drives both spreadStrength and
 * repulsionRadius — two halves of the same perceived separation.
 *
 * Every detent must sit on DEFAULT_HYBRID_SETTINGS-compatible floats so reset
 * and sliders always land on a detent.
 */

export const HYBRID_STEPPED_CONTROLS = Object.freeze({
  tone: Object.freeze({
    labelKeys: Object.freeze(["muted", "soft", "vivid", "max"]),
    steps: Object.freeze([
      Object.freeze({ tone: 0.3 }),
      Object.freeze({ tone: 0.6 }),
      Object.freeze({ tone: 0.85 }),
      Object.freeze({ tone: 1 }),
    ]),
    defaultIndex: 2,
  }),
  rarity: Object.freeze({
    labelKeys: Object.freeze(["off", "subtle", "strong", "max"]),
    steps: Object.freeze([
      Object.freeze({ rarityStrength: 0 }),
      Object.freeze({ rarityStrength: 0.2 }),
      Object.freeze({ rarityStrength: 0.5 }),
      Object.freeze({ rarityStrength: 1 }),
    ]),
    defaultIndex: 1,
  }),
  spread: Object.freeze({
    labelKeys: Object.freeze(["tight", "natural", "spread", "wide"]),
    steps: Object.freeze([
      Object.freeze({ spreadStrength: 0.15, repulsionRadius: 0.03 }),
      Object.freeze({ spreadStrength: 0.4, repulsionRadius: 0.06 }),
      Object.freeze({ spreadStrength: 0.6, repulsionRadius: 0.08 }),
      Object.freeze({ spreadStrength: 1, repulsionRadius: 0.14 }),
    ]),
    defaultIndex: 2,
  }),
  loyalty: Object.freeze({
    labelKeys: Object.freeze(["off", "light", "firm", "locked"]),
    steps: Object.freeze([
      Object.freeze({ loyaltyStrength: 0 }),
      Object.freeze({ loyaltyStrength: 0.3 }),
      Object.freeze({ loyaltyStrength: 0.6 }),
      Object.freeze({ loyaltyStrength: 0.9 }),
    ]),
    defaultIndex: 1,
  }),
});

function primaryKeyOf(control) {
  return Object.keys(control.steps[0])[0];
}

/**
 * @returns {number} index of the detent whose primary value is closest to
 * the current hybrid settings (stored settings may sit between detents).
 */
export function nearestStepIndex(control, hybridSettings) {
  const key = primaryKeyOf(control);
  const currentValue = Number(hybridSettings?.[key]) || 0;

  let bestIndex = 0;
  let bestDistance = Infinity;
  control.steps.forEach((step, index) => {
    const distance = Math.abs(step[key] - currentValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}
