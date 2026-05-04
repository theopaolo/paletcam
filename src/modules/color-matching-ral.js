/**
 * RAL Classic color matching using CIEDE2000 (Delta-E 2000).
 *
 * Provides perceptually accurate nearest-color matching against the full
 * RAL Classic palette — the industry standard for architecture, coatings,
 * interior design, and print specification.
 *
 * Also includes a point-sampling utility for precise single-color capture.
 */

import { t } from "../i18n.js";
import { deltaE2000, rgbToLab } from "./color-distance.js";
import { RAL_CLASSIC } from "./ral-classic-data.js";

// ---------------------------------------------------------------------------
// Pre-computed LAB values for RAL Classic (computed once at module load)
// ---------------------------------------------------------------------------

const RAL_LAB_CACHE = RAL_CLASSIC.map((ral) => rgbToLab(ral.r, ral.g, ral.b));

// ---------------------------------------------------------------------------
// Point sampling
// ---------------------------------------------------------------------------

export const DEFAULT_SAMPLE_RADIUS = 4;

/**
 * Sample a single color from imageData at a given point, averaging a square
 * block around (x, y) for noise reduction. Use this for precise "eyedropper"
 * or focus-point color capture.
 *
 * @param {Uint8ClampedArray} imageData  RGBA pixel data
 * @param {number} width   image width in pixels
 * @param {number} height  image height in pixels
 * @param {number} x       center X coordinate
 * @param {number} y       center Y coordinate
 * @param {number} [radius=4]  sample radius (block is (2r+1) x (2r+1) pixels)
 * @returns {{ r: number, g: number, b: number }}
 */
export function sampleColorAtPoint(imageData, width, height, x, y, radius = DEFAULT_SAMPLE_RADIUS) {
  const cx = Math.round(Math.max(0, Math.min(width - 1, x)));
  const cy = Math.round(Math.max(0, Math.min(height - 1, y)));

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let oy = -radius; oy <= radius; oy++) {
    const py = cy + oy;
    if (py < 0 || py >= height) continue;

    for (let ox = -radius; ox <= radius; ox++) {
      const px = cx + ox;
      if (px < 0 || px >= width) continue;

      const i = (py * width + px) * 4;
      // Skip fully transparent pixels
      if (imageData[i + 3] === 0) continue;

      totalR += imageData[i];
      totalG += imageData[i + 1];
      totalB += imageData[i + 2];
      count++;
    }
  }

  if (count === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  };
}

// ---------------------------------------------------------------------------
// RAL matching
// ---------------------------------------------------------------------------

/**
 * Find the closest RAL Classic colors to a given RGB color.
 *
 * Uses CIEDE2000 for perceptually accurate matching — the same formula
 * used by professional colorimeters and paint-matching systems.
 *
 * @param {number} r  0-255
 * @param {number} g  0-255
 * @param {number} b  0-255
 * @param {number} [count=3]  number of closest matches to return
 * @returns {RalMatch[]}  sorted by deltaE ascending (best match first)
 */
export function findClosestRAL(r, g, b, count = 3) {
  const inputLab = rgbToLab(r, g, b);
  const boundedCount = Math.max(1, Math.min(count, RAL_CLASSIC.length));

  const results = [];
  for (let i = 0; i < RAL_CLASSIC.length; i++) {
    results.push({
      ral: RAL_CLASSIC[i],
      deltaE: deltaE2000(inputLab, RAL_LAB_CACHE[i]),
    });
  }

  results.sort((a, b) => a.deltaE - b.deltaE);
  return results.slice(0, boundedCount);
}

/**
 * Find the closest RAL Classic colors for each color in a palette.
 *
 * @param {Array<{ r: number, g: number, b: number }>} colors
 * @param {number} [matchesPerColor=3]
 * @returns {Array<{ color: { r, g, b }, matches: RalMatch[] }>}
 */
export function matchPaletteToRAL(colors, matchesPerColor = 3) {
  return colors.map((color) => ({
    color: { r: color.r, g: color.g, b: color.b },
    matches: findClosestRAL(color.r, color.g, color.b, matchesPerColor),
  }));
}

// Re-export for convenience
export { RAL_CLASSIC } from "./ral-classic-data.js";

/**
 * Human-readable quality label for a RAL match delta-E distance.
 * @param {number} deltaE
 * @returns {string}
 */
export function getRalQualityLabel(deltaE) {
  if (!Number.isFinite(deltaE)) {
    return "";
  }

  const similarityPercentage = Math.max(0, Math.round(100 - deltaE * 10));

  return t("ral.quality", { percentage: similarityPercentage });
}
