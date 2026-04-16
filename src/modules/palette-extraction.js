import { toRgbCss } from "./color-format.js";
import { extractMedianCutPaletteColors } from "./palette-extract-median-cut.js";

export { createPaletteColor, enrichPaletteColors } from "./palette-color.js";
export { findClosestRAL, matchPaletteToRAL, sampleColorAtPoint, RAL_CLASSIC } from "./color-matching-ral.js";

const COLOR_DISTANCE_THRESHOLD = 24;
const DOMINANT_COLOR_CLUSTER_DISTANCE = 30;

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
        dist: getColorDistanceSquared(reference[refIdx], incoming[incIdx]),
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

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

function getColorDistanceSquared(firstColor, secondColor) {
  const deltaR = firstColor.r - secondColor.r;
  const deltaG = firstColor.g - secondColor.g;
  const deltaB = firstColor.b - secondColor.b;

  return (deltaR * deltaR) + (deltaG * deltaG) + (deltaB * deltaB);
}

function getColorLuma(color) {
  return (0.2126 * color.r) + (0.7152 * color.g) + (0.0722 * color.b);
}

/**
 * @param {Uint8ClampedArray} imageData
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {number} swatchCount
 * @param {PaletteExtractionOptions | null} [options]
 * @returns {PaletteExtractionResult}
 */
export function extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount, options = null) {
  const requestedColorSpace = typeof options === "object" && options
    ? (options.colorSpace ?? options.medianCut?.colorSpace)
    : undefined;

  return extractMedianCutPaletteColors(
    imageData,
    frameWidth,
    frameHeight,
    swatchCount,
    typeof options === "object" && options
      ? {
          ...(options.medianCut ?? {}),
          colorSpace: requestedColorSpace,
          scoring: options.scoring,
        }
      : undefined
  );
}

// Draw palette colors as equal-width vertical bars across the canvas
export function renderPaletteBars(context, colors, canvasWidth, canvasHeight) {
  if (!context || canvasWidth <= 0 || canvasHeight <= 0 || colors.length === 0) {
    return;
  }

  const barWidth = canvasWidth / colors.length;

  colors.forEach((color, index) => {
    context.fillStyle = toRgbCss(color);
    context.fillRect(index * barWidth, 0, barWidth, canvasHeight);
  });
}

let previousColors = null;
let lastRawColorsRef = null;
const ACCUMULATOR_MAX_SIZE = 3;
let colorAccumulator = [];

export function resetColorSmoothing() {
  previousColors = null;
  lastRawColorsRef = null;
  colorAccumulator = [];
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

export function getDominantColor(colors) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return null;
  }

  const clusterDistanceSquared = DOMINANT_COLOR_CLUSTER_DISTANCE ** 2;
  const colorClusters = [];

  colors.forEach((color) => {
    let matchingCluster = null;

    for (const cluster of colorClusters) {
      if (getColorDistanceSquared(color, cluster) <= clusterDistanceSquared) {
        matchingCluster = cluster;
        break;
      }
    }

    if (!matchingCluster) {
      colorClusters.push({
        r: color.r,
        g: color.g,
        b: color.b,
        totalR: color.r,
        totalG: color.g,
        totalB: color.b,
        count: 1,
      });
      return;
    }

    matchingCluster.totalR += color.r;
    matchingCluster.totalG += color.g;
    matchingCluster.totalB += color.b;
    matchingCluster.count += 1;
    matchingCluster.r = Math.round(matchingCluster.totalR / matchingCluster.count);
    matchingCluster.g = Math.round(matchingCluster.totalG / matchingCluster.count);
    matchingCluster.b = Math.round(matchingCluster.totalB / matchingCluster.count);
  });

  colorClusters.sort((firstCluster, secondCluster) => {
    if (secondCluster.count !== firstCluster.count) {
      return secondCluster.count - firstCluster.count;
    }

    return getColorLuma(secondCluster) - getColorLuma(firstCluster);
  });

  return colorClusters[0];
}

export function smoothColors(rawColors, lerpFactor) {
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

    const distance = Math.hypot(
      targetColor.r - prevColor.r,
      targetColor.g - prevColor.g,
      targetColor.b - prevColor.b
    );

    if (distance < COLOR_DISTANCE_THRESHOLD) return prevColor;

    const r = Math.round(prevColor.r + (targetColor.r - prevColor.r) * lerpFactor);
    const g = Math.round(prevColor.g + (targetColor.g - prevColor.g) * lerpFactor);
    const b = Math.round(prevColor.b + (targetColor.b - prevColor.b) * lerpFactor);

    return buildRgbColor(r, g, b);
  });

  previousColors = smoothed;

  return smoothed;
}
