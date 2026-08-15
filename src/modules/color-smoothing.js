import { oklabToRgb, rgbToOklab } from "./color-space-oklch.js";

// Deadband in ΔEOK (euclidean OKLab distance): changes smaller than this hold
// the previous swatch. The just-noticeable difference is ~0.02 (CSS Color 4);
// 2x that suppresses shimmer without visibly lagging real scene changes.
const COLOR_DISTANCE_THRESHOLD = 0.04;
const COLOR_DISTANCE_THRESHOLD_SQUARED = COLOR_DISTANCE_THRESHOLD * COLOR_DISTANCE_THRESHOLD;
// Extractions arrive ~5x/second (time-based cadence), so a deeper rolling
// average covers ~1s of history and filters sensor noise without visible lag.
const ACCUMULATOR_MAX_SIZE = 5;

function labDistanceSquared(labA, labB) {
  const dL = labA.L - labB.L;
  const dA = labA.a - labB.a;
  const dB = labA.b - labB.b;
  return dL * dL + dA * dA + dB * dB;
}

// Reorder `incoming` so each slot best matches the corresponding slot in
// `reference` by ΔEOK.  Uses a greedy closest-pair strategy that works well
// for small palettes (4-8 colors).
function reorderToMatchReference(incoming, reference) {
  const count = incoming.length;
  if (count !== reference.length || count === 0) {
    return incoming;
  }

  // Build all pairwise distances
  const pairs = [];
  for (let refIdx = 0; refIdx < count; refIdx++) {
    for (let incIdx = 0; incIdx < count; incIdx++) {
      pairs.push({
        refIdx,
        incIdx,
        dist: labDistanceSquared(reference[refIdx], incoming[incIdx]),
      });
    }
  }

  // Sort ascending by distance — assign closest pairs first
  pairs.sort((a, b) => a.dist - b.dist);

  const matched = new Array(count).fill(null);
  const usedRef = new Set();
  const usedInc = new Set();

  for (const { refIdx, incIdx } of pairs) {
    if (usedRef.has(refIdx) || usedInc.has(incIdx)) continue;
    matched[refIdx] = incoming[incIdx];
    usedRef.add(refIdx);
    usedInc.add(incIdx);
    if (usedRef.size === count) break;
  }

  return matched;
}

function averageAccumulatedLabs(accumulator) {
  const frameCount = accumulator.length;
  if (frameCount === 0) return [];
  if (frameCount === 1) return accumulator[0];

  const swatchCount = accumulator[0].length;
  const averaged = [];

  for (let i = 0; i < swatchCount; i++) {
    let totalL = 0,
      totalA = 0,
      totalB = 0;
    for (let f = 0; f < frameCount; f++) {
      totalL += accumulator[f][i].L;
      totalA += accumulator[f][i].a;
      totalB += accumulator[f][i].b;
    }
    averaged.push({
      L: totalL / frameCount,
      a: totalA / frameCount,
      b: totalB / frameCount,
    });
  }

  return averaged;
}

/**
 * Creates a temporal color smoother with its own private state.
 *
 * Each instance tracks the previously emitted palette plus a short rolling
 * accumulator of recent extractions, so transient outliers from camera noise
 * or scorer instability are averaged out and small changes are held below a
 * deadband threshold to avoid shimmer.
 *
 * All smoothing math (alignment, averaging, deadband, lerp) runs in OKLab:
 * gamma-sRGB averaging/lerping darkens and grays mixtures, and the deadband
 * gets a perceptually meaningful unit (ΔEOK). Working state stays in Lab
 * floats — round-tripping through 8-bit sRGB every frame would accumulate
 * rounding drift and make the deadband oscillate around its boundary.
 *
 * @returns {{ smooth: (rawColors: RgbColor[], lerpFactor: number) => RgbColor[], reset: () => void }}
 */
function createOklabColorSmoother() {
  let previousLabs = null;
  let displayColors = null;
  let lastRawColorsRef = null;
  let labAccumulator = [];

  function reset() {
    previousLabs = null;
    displayColors = null;
    lastRawColorsRef = null;
    labAccumulator = [];
  }

  function smooth(rawColors, lerpFactor) {
    const rawLabs = rawColors.map((color) => rgbToOklab(color.r, color.g, color.b));

    if (!previousLabs || previousLabs.length !== rawLabs.length) {
      previousLabs = rawLabs;
      displayColors = rawColors;
      lastRawColorsRef = rawColors;
      labAccumulator = [rawLabs];
      return rawColors;
    }

    // Reorder incoming colors to best match previous palette positions.
    // This prevents false jumps when extraction returns the same colors
    // in a different order due to scoring instability / camera noise.
    const alignedLabs = reorderToMatchReference(rawLabs, previousLabs);

    // Accumulate aligned extractions and average them so transient outliers
    // from camera noise / scorer instability are filtered out.
    // Only push when we receive a genuinely new extraction (different ref).
    if (rawColors !== lastRawColorsRef) {
      lastRawColorsRef = rawColors;
      labAccumulator.push(alignedLabs);
      if (labAccumulator.length > ACCUMULATOR_MAX_SIZE) {
        labAccumulator.shift();
      }
    }

    const targetLabs = averageAccumulatedLabs(labAccumulator);

    const smoothedLabs = [];
    const smoothedColors = targetLabs.map((targetLab, index) => {
      const prevLab = previousLabs[index];

      if (labDistanceSquared(targetLab, prevLab) < COLOR_DISTANCE_THRESHOLD_SQUARED) {
        smoothedLabs.push(prevLab);
        return displayColors[index];
      }

      const lab = {
        L: prevLab.L + (targetLab.L - prevLab.L) * lerpFactor,
        a: prevLab.a + (targetLab.a - prevLab.a) * lerpFactor,
        b: prevLab.b + (targetLab.b - prevLab.b) * lerpFactor,
      };
      smoothedLabs.push(lab);
      return oklabToRgb(lab.L, lab.a, lab.b);
    });

    previousLabs = smoothedLabs;
    displayColors = smoothedColors;

    return smoothedColors;
  }

  return { smooth, reset };
}

// Exact pre-OKLab behavior, retained for the debug harness' before/after view.
// Keeping it here ensures the camera comparison includes the old RGB matching,
// rolling average, deadband and interpolation—not merely the static palette.
function createSrgbColorSmoother() {
  const threshold = 24;
  let previousColors = null;
  let lastRawColorsRef = null;
  let colorAccumulator = [];

  function distanceSquared(first, second) {
    const dr = first.r - second.r;
    const dg = first.g - second.g;
    const db = first.b - second.b;
    return dr * dr + dg * dg + db * db;
  }

  function reorder(incoming, reference) {
    if (incoming.length !== reference.length || incoming.length === 0) return incoming;
    const pairs = [];
    for (let refIdx = 0; refIdx < reference.length; refIdx++) {
      for (let incIdx = 0; incIdx < incoming.length; incIdx++) {
        pairs.push({ refIdx, incIdx, dist: distanceSquared(reference[refIdx], incoming[incIdx]) });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const matched = new Array(incoming.length).fill(null);
    const usedRef = new Set();
    const usedInc = new Set();
    for (const { refIdx, incIdx } of pairs) {
      if (usedRef.has(refIdx) || usedInc.has(incIdx)) continue;
      matched[refIdx] = incoming[incIdx];
      usedRef.add(refIdx);
      usedInc.add(incIdx);
    }
    return matched;
  }

  function average(accumulator) {
    if (accumulator.length <= 1) return accumulator[0] ?? [];
    return accumulator[0].map((_, index) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const frame of accumulator) {
        r += frame[index].r;
        g += frame[index].g;
        b += frame[index].b;
      }
      return {
        r: Math.round(r / accumulator.length),
        g: Math.round(g / accumulator.length),
        b: Math.round(b / accumulator.length),
      };
    });
  }

  function reset() {
    previousColors = null;
    lastRawColorsRef = null;
    colorAccumulator = [];
  }

  function smooth(rawColors, lerpFactor) {
    if (!previousColors || previousColors.length !== rawColors.length) {
      previousColors = rawColors;
      lastRawColorsRef = rawColors;
      colorAccumulator = [rawColors];
      return rawColors;
    }

    const aligned = reorder(rawColors, previousColors);
    if (rawColors !== lastRawColorsRef) {
      lastRawColorsRef = rawColors;
      colorAccumulator.push(aligned);
      if (colorAccumulator.length > ACCUMULATOR_MAX_SIZE) colorAccumulator.shift();
    }

    previousColors = average(colorAccumulator).map((target, index) => {
      const previous = previousColors[index];
      if (Math.sqrt(distanceSquared(target, previous)) < threshold) return previous;
      return {
        r: Math.round(previous.r + (target.r - previous.r) * lerpFactor),
        g: Math.round(previous.g + (target.g - previous.g) * lerpFactor),
        b: Math.round(previous.b + (target.b - previous.b) * lerpFactor),
      };
    });
    return previousColors;
  }

  return { smooth, reset };
}

/**
 * @param {{ colorSpace?: "oklab" | "srgb" }} [options]
 */
export function createColorSmoother({ colorSpace = "oklab" } = {}) {
  return colorSpace === "srgb" ? createSrgbColorSmoother() : createOklabColorSmoother();
}
