import { ColorCutQuantizer } from "./color-cut-quantizer.js";
import { packImageDataToArgb8888 } from "./palette-pixel-pack.js";
import {
  buildHueRarityMap,
  createPaletteScoringProfile,
  scoreCandidate,
} from "./palette-scoring.js";
import { selectPaletteHybrid } from "./hybrid-selector.js";

const MIN_SWATCH_COUNT = 1;
export const DEFAULT_QUANTIZED_POOL_SIZE = 24;
export const DEFAULT_MAX_QUANTIZER_PIXELS = 40_000;
const POPULATION_WEIGHT = 0.15;
const BASE_SCORE_WEIGHT = 1 - POPULATION_WEIGHT;

function clampSwatchCount(swatchCount) {
  return Math.max(MIN_SWATCH_COUNT, Number(swatchCount) || MIN_SWATCH_COUNT);
}

function argb8888ToRgbColor(argb) {
  return {
    r: (argb >>> 16) & 0xff,
    g: (argb >>> 8) & 0xff,
    b: argb & 0xff,
  };
}

function buildCandidateFromSwatch(swatch) {
  return {
    ...argb8888ToRgbColor(swatch.rgb),
    population: swatch.population ?? 0,
  };
}

function getQuantizedPoolSize(requestedPoolSize) {
  const normalizedRequested = Number(requestedPoolSize);
  if (Number.isFinite(normalizedRequested) && normalizedRequested > 0) {
    return Math.floor(normalizedRequested);
  }

  return DEFAULT_QUANTIZED_POOL_SIZE;
}

function getPopulationScore(population, maxPopulation) {
  if (maxPopulation <= 0 || population <= 0) {
    return 0;
  }

  return Math.log1p(population) / Math.log1p(maxPopulation);
}

function scoreMedianCutCandidate(
  candidate,
  chosenColors,
  rarityMap,
  maxPopulation,
  scoringProfile,
) {
  const baseScore = scoreCandidate(candidate, chosenColors, rarityMap, scoringProfile);
  const populationScore = getPopulationScore(candidate.population ?? 0, maxPopulation);

  return BASE_SCORE_WEIGHT * baseScore + POPULATION_WEIGHT * populationScore;
}

function rankQuantizedCandidates(candidatePool, swatchCount, scoringProfile) {
  const chosenColors = [];
  const used = new Set();
  const rarityMap = buildHueRarityMap(candidatePool);
  const maxPopulation = candidatePool.reduce(
    (currentMax, candidate) => Math.max(currentMax, candidate.population ?? 0),
    0,
  );
  const maxPickCount = Math.min(swatchCount, candidatePool.length);

  for (let pick = 0; pick < maxPickCount; pick += 1) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidatePool.length; i += 1) {
      if (used.has(i)) {
        continue;
      }

      const candidate = candidatePool[i];
      const score = scoreMedianCutCandidate(
        candidate,
        chosenColors,
        rarityMap,
        maxPopulation,
        scoringProfile,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    used.add(bestIndex);
    chosenColors.push(candidatePool[bestIndex]);
  }

  return chosenColors.map(({ r, g, b }) => ({ r, g, b }));
}

/**
 * @param {Uint8ClampedArray} imageData
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {number} swatchCount
 * @param {object} [options]
 * @param {number} [options.quantizedPoolSize]
 * @param {number} [options.maxQuantizerPixels]
 * @param {Partial<PaletteScoringWeights> | ScoringProfile} [options.scoring]
 * @returns {PaletteExtractionResult}
 */
export function extractMedianCutPaletteColors(
  imageData,
  frameWidth,
  frameHeight,
  swatchCount,
  {
    quantizedPoolSize,
    maxQuantizerPixels = DEFAULT_MAX_QUANTIZER_PIXELS,
    scoring,
    hybrid,
    selector,
  } = {},
) {
  const normalizedSwatchCount = clampSwatchCount(swatchCount);

  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return { colors: [] };
  }

  if (selector === "perceptual") {
    return selectPaletteHybrid(imageData, frameWidth, frameHeight, normalizedSwatchCount, {
      maxQuantizerPixels,
      quantizedPoolSize: getQuantizedPoolSize(quantizedPoolSize),
      repulsionRadius: hybrid?.repulsionRadius,
      spreadStrength: hybrid?.spreadStrength,
      rarityStrength: hybrid?.rarityStrength,
      tone: hybrid?.tone,
      previousColors: hybrid?.previousColors,
      loyaltyStrength: hybrid?.loyaltyStrength,
    });
  }

  const scoringOptions = {
    ...(scoring ?? {}),
    model: scoring?.model ?? "classic",
  };

  const packedPixels = packImageDataToArgb8888(imageData, frameWidth, frameHeight, {
    maxPixels: maxQuantizerPixels,
  });

  if (packedPixels.length === 0) {
    return { colors: [] };
  }

  const targetQuantizedSwatchCount = Math.max(
    normalizedSwatchCount,
    getQuantizedPoolSize(quantizedPoolSize),
  );

  const quantizer = new ColorCutQuantizer(packedPixels, targetQuantizedSwatchCount);
  const quantizedSwatches = quantizer.getQuantizedColors?.() ?? [];

  if (!Array.isArray(quantizedSwatches) || quantizedSwatches.length === 0) {
    return { colors: [] };
  }

  // Build candidate pool — convert swatches back to RGB
  const seenRgbKeys = new Set();
  const candidatePool = [];

  for (const swatch of quantizedSwatches) {
    if (!swatch || typeof swatch.rgb !== "number") {
      continue;
    }

    const candidate = buildCandidateFromSwatch(swatch);
    const key = `${candidate.r},${candidate.g},${candidate.b}`;
    if (seenRgbKeys.has(key)) {
      continue;
    }

    seenRgbKeys.add(key);
    candidatePool.push(candidate);
  }

  const scoringProfile = createPaletteScoringProfile(scoringOptions);
  const colors = rankQuantizedCandidates(candidatePool, normalizedSwatchCount, scoringProfile);
  return { colors };
}
