import { rgbToOklch } from "./color-space-oklch.js";

const MAX_OKLCH_CHROMA = 0.32;
const MIN_OKLCH_CHROMA_FOR_HUE = 0.03;
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


// Bucket each candidate's hue into 12 segments (30° each) and return a rarity
// score: rare hues in the pool get a higher value (0–1).
/**
 * @param {RgbColor[]} pool
 * @returns {HueRarityMap}
 */
export function buildHueRarityMap(pool) {
  const BUCKET_COUNT = 12;
  const buckets = new Array(BUCKET_COUNT).fill(0);

  for (const color of pool) {
    const colorFeatures = getPerceptualColorFeatures(color);
    if (colorFeatures.c < MIN_OKLCH_CHROMA_FOR_HUE) continue;
    const bucket = getPerceptualHueBucket(colorFeatures, BUCKET_COUNT);
    buckets[bucket] += 1;
  }

  const maxCount = Math.max(1, ...buckets);
  return { buckets, maxCount, BUCKET_COUNT };
}

function getHueRarity(colorFeatures, rarityMap) {
  if (colorFeatures.c < MIN_OKLCH_CHROMA_FOR_HUE) return 0;
  const bucket = getPerceptualHueBucket(colorFeatures, rarityMap.BUCKET_COUNT);
  return 1 - (rarityMap.buckets[bucket] / rarityMap.maxCount);
}


// Score a candidate color: higher = more representative and distinct.
/**
 * @param {RgbColor} candidate
 * @param {RgbColor[]} chosenColors
 * @param {HueRarityMap} rarityMap
 * @param {Partial<PaletteScoringWeights> | ScoringProfile | null} [scoringOptions]
 * @returns {number}
 */
export function scoreCandidate(candidate, chosenColors, rarityMap, scoringOptions = null) {
  const scoringProfile = getPaletteScoringProfile(scoringOptions);
  const colorFeatures = getPerceptualColorFeatures(candidate);

  // Prefer colors with meaningful perceptual chroma without over-rewarding neon outliers.
  const chromaScore = Math.min(1, colorFeatures.c / MAX_OKLCH_CHROMA);

  // Reward light/dark anchors because they make the resulting palette more representative.
  const lumaSpreadScore = Math.abs(colorFeatures.l - 0.5) / 0.5;

  // Hue rarity is a light tiebreaker only — not a dominant factor.
  const rarityScore = getHueRarity(colorFeatures, rarityMap);

  // Diversity uses perceptual distance rather than raw RGB distance.
  let diversityScore = 0;
  if (chosenColors.length > 0) {
    let minDistance = Infinity;
    for (const chosen of chosenColors) {
      const dist = getPerceptualColorDistance(candidate, chosen);
      if (dist < minDistance) minDistance = dist;
    }
    diversityScore = Math.min(1, minDistance / MAX_OKLCH_DISTANCE);
  }

  return (scoringProfile.chromaWeight * chromaScore)
       + (scoringProfile.lumaSpreadWeight * lumaSpreadScore)
       + (scoringProfile.rarityWeight * rarityScore)
       + (scoringProfile.diversityWeight * diversityScore);
}
