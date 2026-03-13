import { rgbToOklch } from "./color-space-oklch.js";

const DEFAULT_SCORING_MODEL = "classic";
const MAX_RGB_DISTANCE = Math.hypot(255, 255, 255);
const MAX_OKLCH_CHROMA = 0.32;
const MIN_OKLCH_CHROMA_FOR_HUE = 0.03;
const MIN_HSL_SATURATION_FOR_HUE = 0.08;
const MAX_OKLCH_DISTANCE = Math.hypot(1, 0.4, 0.8);
export const DEFAULT_PALETTE_SCORING_SETTINGS = Object.freeze({
  chromaWeight: 25,
  lumaSpreadWeight: 15,
  rarityWeight: 20,
  diversityWeight: 40,
});

function clampNonNegativeNumber(value, fallbackValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallbackValue;
  }

  return numericValue;
}

function normalizeScoringModel(value) {
  return value === "perceptual" ? "perceptual" : DEFAULT_SCORING_MODEL;
}

/**
 * @param {Partial<PaletteScoringWeights> | null} [options]
 * @returns {ScoringProfile}
 */
export function createPaletteScoringProfile(options = null) {
  const chromaWeight = clampNonNegativeNumber(
    options?.chromaWeight,
    DEFAULT_PALETTE_SCORING_SETTINGS.chromaWeight
  );
  const lumaSpreadWeight = clampNonNegativeNumber(
    options?.lumaSpreadWeight,
    DEFAULT_PALETTE_SCORING_SETTINGS.lumaSpreadWeight
  );
  const rarityWeight = clampNonNegativeNumber(
    options?.rarityWeight,
    DEFAULT_PALETTE_SCORING_SETTINGS.rarityWeight
  );
  const diversityWeight = clampNonNegativeNumber(
    options?.diversityWeight,
    DEFAULT_PALETTE_SCORING_SETTINGS.diversityWeight
  );
  const totalWeight = chromaWeight + lumaSpreadWeight + rarityWeight + diversityWeight;
  if (totalWeight <= 0) {
    return createPaletteScoringProfile(DEFAULT_PALETTE_SCORING_SETTINGS);
  }

  return {
    __paletteScoringProfile: true,
    model: normalizeScoringModel(options?.model),
    chromaWeight: chromaWeight / totalWeight,
    lumaSpreadWeight: lumaSpreadWeight / totalWeight,
    rarityWeight: rarityWeight / totalWeight,
    diversityWeight: diversityWeight / totalWeight,
  };
}

function getPaletteScoringProfile(profileOrOptions) {
  if (profileOrOptions?.__paletteScoringProfile) {
    return profileOrOptions;
  }

  return createPaletteScoringProfile(profileOrOptions);
}

function getPerceptualColorFeatures(color) {
  return rgbToOklch(color.r, color.g, color.b);
}

export function rgbToHsl(color) {
  let h = 0;
  let s = 0;
  let l = 0;

  const rNorm = color.r / 255;
  const gNorm = color.g / 255;
  const bNorm = color.b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  l = (max + min) / 2;

  if (min === max) {
    return { h, s, l };
  }

  const delta = max - min;
  s = delta / (1 - Math.abs(2 * l - 1));

  if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
  else if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
  else h = (rNorm - gNorm) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

function getPerceptualHueBucket(colorFeatures, bucketCount) {
  return Math.floor(colorFeatures.h / (360 / bucketCount)) % bucketCount;
}

function getPerceptualColorDistance(firstColor, secondColor) {
  const first = getPerceptualColorFeatures(firstColor);
  const second = getPerceptualColorFeatures(secondColor);
  const hueDelta = Math.abs(first.h - second.h);
  const shortestHueDelta = Math.min(hueDelta, 360 - hueDelta) * (Math.PI / 180);
  const hueComponent = 2 * Math.sqrt(first.c * second.c) * Math.sin(shortestHueDelta / 2);

  return Math.hypot(first.l - second.l, first.c - second.c, hueComponent);
}


/**
 * @param {RgbColor[]} pool
 * @param {Partial<PaletteScoringWeights> | ScoringProfile | null} [scoringOptions]
 * @returns {HueRarityMap}
 */
export function buildHueRarityMap(pool, scoringOptions = null) {
  const scoringProfile = getPaletteScoringProfile(scoringOptions);
  const BUCKET_COUNT = 12;
  const buckets = new Array(BUCKET_COUNT).fill(0);

  for (const color of pool) {
    let bucket = -1;
    if (scoringProfile.model === "perceptual") {
      const colorFeatures = getPerceptualColorFeatures(color);
      if (colorFeatures.c < MIN_OKLCH_CHROMA_FOR_HUE) continue;
      bucket = getPerceptualHueBucket(colorFeatures, BUCKET_COUNT);
    } else {
      const hsl = rgbToHsl(color);
      if (hsl.s < MIN_HSL_SATURATION_FOR_HUE) continue;
      bucket = Math.floor(hsl.h / (360 / BUCKET_COUNT)) % BUCKET_COUNT;
    }

    buckets[bucket] += 1;
  }

  const maxCount = Math.max(1, ...buckets);
  return { buckets, maxCount, BUCKET_COUNT };
}

function getPerceptualHueRarity(colorFeatures, rarityMap) {
  if (colorFeatures.c < MIN_OKLCH_CHROMA_FOR_HUE) return 0;
  const bucket = getPerceptualHueBucket(colorFeatures, rarityMap.BUCKET_COUNT);
  return 1 - (rarityMap.buckets[bucket] / rarityMap.maxCount);
}

function getClassicHueRarity(hsl, rarityMap) {
  if (hsl.s < MIN_HSL_SATURATION_FOR_HUE) return 0;
  const bucket = Math.floor(hsl.h / (360 / rarityMap.BUCKET_COUNT)) % rarityMap.BUCKET_COUNT;
  return 1 - (rarityMap.buckets[bucket] / rarityMap.maxCount);
}

/**
 * @param {RgbColor} candidate
 * @param {RgbColor[]} chosenColors
 * @param {HueRarityMap} rarityMap
 * @param {Partial<PaletteScoringWeights> | ScoringProfile | null} [scoringOptions]
 * @returns {number}
 */
export function scoreCandidate(candidate, chosenColors, rarityMap, scoringOptions = null) {
  const scoringProfile = getPaletteScoringProfile(scoringOptions);
  let chromaScore = 0;
  let lumaSpreadScore = 0;
  let rarityScore = 0;
  let diversityScore = 0;

  if (scoringProfile.model === "perceptual") {
    const colorFeatures = getPerceptualColorFeatures(candidate);

    chromaScore = Math.min(1, colorFeatures.c / MAX_OKLCH_CHROMA);
    lumaSpreadScore = Math.abs(colorFeatures.l - 0.5) / 0.5;
    rarityScore = getPerceptualHueRarity(colorFeatures, rarityMap);

    if (chosenColors.length > 0) {
      let minDistance = Infinity;
      for (const chosen of chosenColors) {
        const dist = getPerceptualColorDistance(candidate, chosen);
        if (dist < minDistance) minDistance = dist;
      }
      diversityScore = Math.min(1, minDistance / MAX_OKLCH_DISTANCE);
    }
  } else {
    const hsl = rgbToHsl(candidate);

    chromaScore = hsl.s;
    lumaSpreadScore = Math.abs(hsl.l - 0.5) / 0.5;
    rarityScore = getClassicHueRarity(hsl, rarityMap);

    if (chosenColors.length > 0) {
      let minDistance = Infinity;
      for (const chosen of chosenColors) {
        const dist = Math.hypot(
          candidate.r - chosen.r,
          candidate.g - chosen.g,
          candidate.b - chosen.b,
        );
        if (dist < minDistance) minDistance = dist;
      }
      diversityScore = Math.min(1, minDistance / MAX_RGB_DISTANCE);
    }
  }

  return (scoringProfile.chromaWeight * chromaScore)
       + (scoringProfile.lumaSpreadWeight * lumaSpreadScore)
       + (scoringProfile.rarityWeight * rarityScore)
       + (scoringProfile.diversityWeight * diversityScore);
}
