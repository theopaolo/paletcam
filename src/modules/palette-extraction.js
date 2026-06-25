import { rgbDistanceSquared } from "./color-math.js";
import { toRgbCss } from "./color-format.js";
import { extractMedianCutPaletteColors } from "./palette-extract-median-cut.js";

const DOMINANT_COLOR_CLUSTER_DISTANCE = 30;

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
  const hasOptions = typeof options === "object" && options !== null;

  return extractMedianCutPaletteColors(
    imageData,
    frameWidth,
    frameHeight,
    swatchCount,
    hasOptions
      ? { ...(options.medianCut ?? {}), scoring: options.scoring }
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

export function removeDarkestColor(colors) {
  if (colors.length <= 1) {
    return colors;
  }

  let darkestIndex = 0;
  let lowestLuma = Infinity;
  for (let index = 0; index < colors.length; index += 1) {
    const luma = getColorLuma(colors[index]);
    if (luma < lowestLuma) {
      lowestLuma = luma;
      darkestIndex = index;
    }
  }

  return colors.filter((_, index) => index !== darkestIndex);
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
      if (rgbDistanceSquared(color, cluster) <= clusterDistanceSquared) {
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
