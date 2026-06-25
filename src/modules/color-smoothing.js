import { rgbDistance, rgbDistanceSquared } from "./color-math.js";

const COLOR_DISTANCE_THRESHOLD = 24;
const ACCUMULATOR_MAX_SIZE = 3;

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

// Reorder `incoming` so each slot best matches the corresponding slot in
// `reference` by color distance.  Uses a greedy closest-pair strategy that
// works well for small palettes (4-8 colors).
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
        dist: rgbDistanceSquared(reference[refIdx], incoming[incIdx]),
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

function averageAccumulatedColors(accumulator) {
  const frameCount = accumulator.length;
  if (frameCount === 0) return [];
  if (frameCount === 1) return accumulator[0];

  const swatchCount = accumulator[0].length;
  const averaged = [];

  for (let i = 0; i < swatchCount; i++) {
    let totalR = 0, totalG = 0, totalB = 0;
    for (let f = 0; f < frameCount; f++) {
      totalR += accumulator[f][i].r;
      totalG += accumulator[f][i].g;
      totalB += accumulator[f][i].b;
    }
    averaged.push(buildRgbColor(
      Math.round(totalR / frameCount),
      Math.round(totalG / frameCount),
      Math.round(totalB / frameCount)
    ));
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
 * @returns {{ smooth: (rawColors: RgbColor[], lerpFactor: number) => RgbColor[], reset: () => void }}
 */
export function createColorSmoother() {
  let previousColors = null;
  let lastRawColorsRef = null;
  let colorAccumulator = [];

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

    // Reorder incoming colors to best match previous palette positions.
    // This prevents false jumps when extraction returns the same colors
    // in a different order due to scoring instability / camera noise.
    const alignedColors = reorderToMatchReference(rawColors, previousColors);

    // Accumulate aligned extractions and average them so transient outliers
    // from camera noise / scorer instability are filtered out.
    // Only push when we receive a genuinely new extraction (different ref).
    if (rawColors !== lastRawColorsRef) {
      lastRawColorsRef = rawColors;
      colorAccumulator.push(alignedColors);
      if (colorAccumulator.length > ACCUMULATOR_MAX_SIZE) {
        colorAccumulator.shift();
      }
    }

    const targetColors = averageAccumulatedColors(colorAccumulator);

    const smoothed = targetColors.map((targetColor, index) => {
      const prevColor = previousColors[index];

      const distance = rgbDistance(targetColor, prevColor);

      if (distance < COLOR_DISTANCE_THRESHOLD) return prevColor;

      const r = Math.round(prevColor.r + (targetColor.r - prevColor.r) * lerpFactor);
      const g = Math.round(prevColor.g + (targetColor.g - prevColor.g) * lerpFactor);
      const b = Math.round(prevColor.b + (targetColor.b - prevColor.b) * lerpFactor);

      return buildRgbColor(r, g, b);
    });

    previousColors = smoothed;

    return smoothed;
  }

  return { smooth, reset };
}
