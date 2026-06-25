/**
 * Debug harness: runs the extraction pipeline stage by stage and returns the
 * intermediate data (sampled pixels, quantizer pool, final selection) projected
 * into OKLab, so a scatter view can show what the algorithm actually "sees".
 *
 * This composes the same primitives the live pipeline uses — it is not a second
 * implementation. It exists only to make tuning a visual exercise.
 */

import { ColorCutQuantizer } from "../color-cut-quantizer.js";
import { rgbToOklab } from "../color-space-oklch.js";
import { extractMedianCutPaletteColors } from "../palette-extract-median-cut.js";
import { packImageDataToArgb8888 } from "../palette-pixel-pack.js";
import { selectPaletteExperimental } from "./experimental-selector.js";
import { selectPaletteHybrid } from "./hybrid-selector.js";

function argbToRgb(argb) {
  return {
    r: (argb >>> 16) & 0xff,
    g: (argb >>> 8) & 0xff,
    b: argb & 0xff,
  };
}

function withOklab(rgb, extra = {}) {
  return { rgb, oklab: rgbToOklab(rgb.r, rgb.g, rgb.b), ...extra };
}

function computeStats(points) {
  const count = points.length;
  if (count === 0) {
    return { meanL: 0, meanChroma: 0, spread: 0, sparse: true, pixelCount: 0 };
  }

  let sumL = 0;
  let sumChroma = 0;
  let sumA = 0;
  let sumB = 0;

  for (const { oklab } of points) {
    sumL += oklab.L;
    sumChroma += Math.hypot(oklab.a, oklab.b);
    sumA += oklab.a;
    sumB += oklab.b;
  }

  const meanA = sumA / count;
  const meanB = sumB / count;

  // Spread = RMS distance of points from the centroid in the chromatic plane.
  let sumSqDist = 0;
  for (const { oklab } of points) {
    sumSqDist += (oklab.a - meanA) ** 2 + (oklab.b - meanB) ** 2;
  }
  const spread = Math.sqrt(sumSqDist / count);

  const meanChroma = sumChroma / count;

  return {
    meanL: sumL / count,
    meanChroma,
    spread,
    // Heuristic: a low-chroma, tightly-clustered cloud is a "sparse" palette
    // (little chromatic material to work with).
    sparse: meanChroma < 0.05 && spread < 0.05,
    pixelCount: count,
  };
}

/**
 * @param {Uint8ClampedArray} imageData  RGBA pixels
 * @param {number} width
 * @param {number} height
 * @param {number} swatchCount
 * @param {object} [options]  forwarded to extractMedianCutPaletteColors
 * @param {object} [debugOptions]
 * @param {number} [debugOptions.maxScatterPoints=4000]  cap for render perf
 * @param {number} [debugOptions.quantizedPoolSize]
 * @param {number} [debugOptions.maxQuantizerPixels]
 * @returns {{
 *   points: Array<{ rgb: object, oklab: object }>,
 *   candidates: Array<{ rgb: object, oklab: object, population: number }>,
 *   selected: Array<{ rgb: object, oklab: object, index: number }>,
 *   stats: object,
 * }}
 */
export function traceExtraction(imageData, width, height, swatchCount, options = {}, debugOptions = {}) {
  const { maxScatterPoints = 4000 } = debugOptions;
  const maxQuantizerPixels = options.maxQuantizerPixels ?? debugOptions.maxQuantizerPixels;
  const quantizedPoolSize = options.quantizedPoolSize ?? debugOptions.quantizedPoolSize;

  const empty = { points: [], candidates: [], selected: [], stats: computeStats([]) };
  if (!imageData || width <= 0 || height <= 0) {
    return empty;
  }

  // Stage 0 — sampled pixels (the quantizer's input distribution).
  const packed = packImageDataToArgb8888(
    imageData,
    width,
    height,
    maxQuantizerPixels ? { maxPixels: maxQuantizerPixels } : undefined,
  );
  if (packed.length === 0) {
    return empty;
  }

  const pointStride = Math.max(1, Math.ceil(packed.length / maxScatterPoints));
  const points = [];
  for (let i = 0; i < packed.length; i += pointStride) {
    points.push(withOklab(argbToRgb(packed[i])));
  }

  let candidates;
  let selected;
  let extraStats = {};

  if (debugOptions.selector === "new") {
    // Experimental OKLab pipeline: reserve neutrals + cluster + repulsion +
    // representative pixel. Candidates here are its chromatic clusters.
    const result = selectPaletteExperimental(imageData, width, height, swatchCount, {
      repulsionRadius: debugOptions.repulsionRadius,
      spreadStrength: debugOptions.spreadStrength,
      rarityStrength: debugOptions.rarityStrength,
      tone: debugOptions.tone,
      maxQuantizerPixels,
    });
    candidates = result.clusters.map((cluster) =>
      withOklab(cluster.rgb, { population: cluster.mass }),
    );
    selected = result.colors.map((rgb, index) => withOklab(rgb, { index: index + 1 }));
    extraStats = { neutralCount: result.neutralCount, neutralThreshold: result.neutralThreshold };
  } else if (debugOptions.selector === "hybrid") {
    // Option C: median-cut candidates (augmented with vivid exemplars) + OKLab
    // greedy selection. The hybrid keeps median-cut's temporal stability while
    // recovering the anti-muting vivid representative via the per-box exemplar.
    const result = selectPaletteHybrid(imageData, width, height, swatchCount, {
      repulsionRadius: debugOptions.repulsionRadius,
      spreadStrength: debugOptions.spreadStrength,
      rarityStrength: debugOptions.rarityStrength,
      tone: debugOptions.tone,
      maxQuantizerPixels,
      quantizedPoolSize: quantizedPoolSize,
    });
    candidates = result.candidates.map((c) =>
      withOklab(c.meanRgb, { population: c.mass }),
    );
    selected = result.colors.map((rgb, index) => withOklab(rgb, { index: index + 1 }));
    extraStats = { neutralCount: result.neutralCount, neutralThreshold: result.neutralThreshold };
  } else {
    // Production path: median-cut pool + scorer. The quantizer mutates its
    // input, so copy.
    const poolSize = Math.max(swatchCount, quantizedPoolSize ?? 24);
    const quantizer = new ColorCutQuantizer(Int32Array.from(packed), poolSize);
    candidates = (quantizer.getQuantizedColors?.() ?? [])
      .filter((swatch) => swatch && typeof swatch.rgb === "number")
      .map((swatch) => withOklab(argbToRgb(swatch.rgb), { population: swatch.population ?? 0 }));

    const { colors } = extractMedianCutPaletteColors(imageData, width, height, swatchCount, options);
    selected = colors.map((rgb, index) => withOklab(rgb, { index: index + 1 }));
  }

  return {
    points,
    candidates,
    selected,
    stats: {
      ...computeStats(points),
      candidateCount: candidates.length,
      selectedCount: selected.length,
      ...extraStats,
    },
  };
}
