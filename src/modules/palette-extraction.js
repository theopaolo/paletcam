import { toRgbCss } from "./color-format.js";
import { extractMedianCutPaletteColors } from "./palette-extract-median-cut.js";
import {
  extractGridPaletteColors,
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_RADIUS,
  SAMPLE_ROW_COUNT,
} from "./palette-extract-grid.js";

const COLOR_DISTANCE_THRESHOLD = 35;
const DOMINANT_COLOR_CLUSTER_DISTANCE = 30;
export const PALETTE_EXTRACTION_ALGORITHMS = Object.freeze({
  GRID: "grid",
  MEDIAN_CUT: "median-cut",
});
let activePaletteExtractionAlgorithm = PALETTE_EXTRACTION_ALGORITHMS.GRID;

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

// Orchestrator entrypoint for switchable extraction strategies.
// Grid remains the default so preview + overlay behavior stays unchanged.
function normalizePaletteExtractionAlgorithm(nextAlgorithm) {
  return nextAlgorithm === PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT
    ? PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT
    : PALETTE_EXTRACTION_ALGORITHMS.GRID;
}

export function getPaletteExtractionAlgorithm() {
  return activePaletteExtractionAlgorithm;
}

export function setPaletteExtractionAlgorithm(nextAlgorithm) {
  activePaletteExtractionAlgorithm = normalizePaletteExtractionAlgorithm(nextAlgorithm);
  return activePaletteExtractionAlgorithm;
}

export function extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount, options = null) {
  const requestedAlgorithm = typeof options === "string"
    ? options
    : options?.algorithm;
  const algorithm = normalizePaletteExtractionAlgorithm(
    requestedAlgorithm ?? activePaletteExtractionAlgorithm
  );

  if (algorithm === PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT) {
    return extractMedianCutPaletteColors(
      imageData,
      frameWidth,
      frameHeight,
      swatchCount,
      typeof options === "object" && options ? options.medianCut : undefined
    );
  }

  return extractGridPaletteColors(imageData, frameWidth, frameHeight, swatchCount);
}

export { SAMPLE_COL_COUNT, SAMPLE_DIAMETER, SAMPLE_RADIUS, SAMPLE_ROW_COUNT };

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
    previousColors = rawColors; // nothing to lerp from yet
    return rawColors;
  }

  const smoothed = rawColors.map((rawColor, index) => {
    const prevColor = previousColors[index];

    const distance = Math.hypot(
      rawColor.r - prevColor.r,
      rawColor.g - prevColor.g,
      rawColor.b - prevColor.b
    );

    if (distance < COLOR_DISTANCE_THRESHOLD) return prevColor;

    const r = Math.round(prevColor.r + (rawColor.r - prevColor.r) * lerpFactor);
    const g = Math.round(prevColor.g + (rawColor.g - prevColor.g) * lerpFactor);
    const b = Math.round(prevColor.b + (rawColor.b - prevColor.b) * lerpFactor);

    return buildRgbColor(r, g, b);
  });

  previousColors = smoothed;

  return smoothed;
}
