import { describe, expect, test } from 'bun:test';

import {
  buildHueRarityMap,
  createPaletteScoringProfile,
  scoreCandidate,
} from './palette-scoring.js';

describe('createPaletteScoringProfile', () => {
  test('normalizes weights so the profile sums to 1', () => {
    const profile = createPaletteScoringProfile({
      chromaWeight: 2,
      lumaSpreadWeight: 3,
      rarityWeight: 5,
      diversityWeight: 10,
    });

    const totalWeight =
      profile.chromaWeight +
      profile.lumaSpreadWeight +
      profile.rarityWeight +
      profile.diversityWeight;

    expect(profile.chromaWeight).toBeCloseTo(0.1, 8);
    expect(profile.lumaSpreadWeight).toBeCloseTo(0.15, 8);
    expect(profile.rarityWeight).toBeCloseTo(0.25, 8);
    expect(profile.diversityWeight).toBeCloseTo(0.5, 8);
    expect(totalWeight).toBeCloseTo(1, 8);
  });

  test('falls back to the default distribution when all weights are zero', () => {
    const profile = createPaletteScoringProfile({
      chromaWeight: 0,
      lumaSpreadWeight: 0,
      rarityWeight: 0,
      diversityWeight: 0,
    });

    expect(profile.chromaWeight).toBeCloseTo(0.25, 8);
    expect(profile.lumaSpreadWeight).toBeCloseTo(0.15, 8);
    expect(profile.rarityWeight).toBeCloseTo(0.2, 8);
    expect(profile.diversityWeight).toBeCloseTo(0.4, 8);
  });
});

describe('buildHueRarityMap', () => {
  test('ignores near-grey colors when building hue buckets', () => {
    const pool = [
      { r: 128, g: 128, b: 128 },
      { r: 120, g: 122, b: 121 },
      { r: 255, g: 0, b: 0 },
      { r: 240, g: 10, b: 10 },
      { r: 0, g: 0, b: 255 },
    ];

    const rarityMap = buildHueRarityMap(pool);
    const bucketPopulation = rarityMap.buckets.reduce((sum, count) => sum + count, 0);

    expect(bucketPopulation).toBe(3);
    expect(rarityMap.maxCount).toBe(2);
    expect(rarityMap.BUCKET_COUNT).toBe(12);
  });
});

describe('scoreCandidate', () => {
  test('gives a higher score to the candidate farther from already chosen colors', () => {
    const scoringProfile = createPaletteScoringProfile({
      chromaWeight: 0,
      lumaSpreadWeight: 0,
      rarityWeight: 0,
      diversityWeight: 1,
    });
    const chosenColors = [{ r: 255, g: 0, b: 0 }];
    const nearRed = { r: 245, g: 10, b: 10 };
    const farFromRed = { r: 0, g: 255, b: 255 };
    const rarityMap = buildHueRarityMap([chosenColors[0], nearRed, farFromRed]);

    const nearScore = scoreCandidate(nearRed, chosenColors, rarityMap, scoringProfile);
    const farScore = scoreCandidate(farFromRed, chosenColors, rarityMap, scoringProfile);

    expect(farScore).toBeGreaterThan(nearScore);
  });
});
