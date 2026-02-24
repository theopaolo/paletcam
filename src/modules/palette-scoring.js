const MAX_RGB_DISTANCE = Math.hypot(255, 255, 255);
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
    s = 0;
    h = 0;
  } else {
    const delta = max - min;
    s = delta / (1 - Math.abs(2 * l - 1));

    if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
    else if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
    else h = (rNorm - gNorm) / delta + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}


// Bucket each candidate's hue into 12 segments (30° each) and return a rarity
// score: rare hues in the pool get a higher value (0–1).
export function buildHueRarityMap(pool) {
  const BUCKET_COUNT = 12;
  const buckets = new Array(BUCKET_COUNT).fill(0);

  for (const color of pool) {
    const hsl = rgbToHsl(color);
    if (hsl.s < 0.08) continue; // near-grey — skip
    const bucket = Math.floor(hsl.h / (360 / BUCKET_COUNT)) % BUCKET_COUNT;
    buckets[bucket] += 1;
  }

  const maxCount = Math.max(1, ...buckets);
  return { buckets, maxCount, BUCKET_COUNT };
}

function getHueRarity(hsl, rarityMap) {
  if (hsl.s < 0.08) return 0; // grey has no hue rarity
  const bucket = Math.floor(hsl.h / (360 / rarityMap.BUCKET_COUNT)) % rarityMap.BUCKET_COUNT;
  return 1 - (rarityMap.buckets[bucket] / rarityMap.maxCount);
}


// Score a candidate color: higher = more interesting
export function scoreCandidate(candidate, chosenColors, rarityMap, scoringOptions = null) {
  const scoringProfile = getPaletteScoringProfile(scoringOptions);
  const hsl = rgbToHsl(candidate);

  // Saturation: vivid colors score higher
  const chromaScore = hsl.s;

  // Light/dark spread: reward colors far from mid-grey
  const lumaSpreadScore = Math.abs(hsl.l - 0.5) / 0.5;

  // Hue rarity: underrepresented hues in the pool get a bonus
  const rarityScore = getHueRarity(hsl, rarityMap);

  // Diversity: how different from already-chosen swatches (min distance)
  let diversityScore = 0;
  if (chosenColors.length > 0) {
    let minDistance = Infinity;
    for (const chosen of chosenColors) {
      const dist = Math.hypot(
        candidate.r - chosen.r,
        candidate.g - chosen.g,
        candidate.b - chosen.b
      );
      if (dist < minDistance) minDistance = dist;
    }
    diversityScore = Math.min(1, minDistance / MAX_RGB_DISTANCE);
  }

  return (scoringProfile.chromaWeight * chromaScore)
       + (scoringProfile.lumaSpreadWeight * lumaSpreadScore)
       + (scoringProfile.rarityWeight * rarityScore)
       + (scoringProfile.diversityWeight * diversityScore);
}
