import { buildHueRarityMap, scoreCandidate } from './palette-scoring.js';

const MIN_SWATCH_COUNT = 1;

export const SAMPLE_ROW_COUNT = 5;
export const SAMPLE_COL_COUNT = 8;
export const SAMPLE_RADIUS = 4;
export const SAMPLE_DIAMETER = (SAMPLE_RADIUS * 2) + 1;

function clampSwatchCount(swatchCount) {
  return Math.max(MIN_SWATCH_COUNT, Number(swatchCount) || MIN_SWATCH_COUNT);
}

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

// Sample a square block around (centerX, centerY) and return the averaged RGB color.
// Current size is SAMPLE_DIAMETER x SAMPLE_DIAMETER (9x9 with radius 4).
function sampleBlock(imageData, frameWidth, frameHeight, centerX, centerY, radius) {
  let totalR = 0, totalG = 0, totalB = 0, count = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const y = centerY + offsetY;
    if (y < 0 || y >= frameHeight) continue;

    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = centerX + offsetX;
      if (x < 0 || x >= frameWidth) continue;

      const pixelIndex = (y * frameWidth + x) * 4;
      totalR += imageData[pixelIndex];
      totalG += imageData[pixelIndex + 1];
      totalB += imageData[pixelIndex + 2];
      count += 1;
    }
  }

  if (count === 0) return buildRgbColor(0, 0, 0);

  return buildRgbColor(
    Math.round(totalR / count),
    Math.round(totalG / count),
    Math.round(totalB / count)
  );
}

export function extractGridPaletteColors(imageData, frameWidth, frameHeight, swatchCount) {
  const normalizedSwatchCount = clampSwatchCount(swatchCount);

  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return { colors: [], chosenIndices: [] };
  }

  // Build evenly-spaced sample rows
  const sampleRows = [];
  for (let i = 0; i < SAMPLE_ROW_COUNT; i++) {
    sampleRows.push(Math.floor((frameHeight * (i + 1)) / (SAMPLE_ROW_COUNT + 1)));
  }


  // Phase 1: Collect all candidates from a fixed grid (SAMPLE_COL_COUNT × SAMPLE_ROW_COUNT)
  const candidatePool = [];
  for (let col = 0; col < SAMPLE_COL_COUNT; col++) {
    const sampleX = Math.floor(
      (frameWidth / SAMPLE_COL_COUNT) * col +
        frameWidth / (SAMPLE_COL_COUNT * 2)
    );

    for (const rowY of sampleRows) {
      candidatePool.push(
        sampleBlock(imageData, frameWidth, frameHeight, sampleX, rowY, SAMPLE_RADIUS)
      );
    }
  }

  // Phase 2: Greedy selection from the full pool — pick the best, then repeat
  const rarityMap = buildHueRarityMap(candidatePool);
  const maxPickCount = Math.min(normalizedSwatchCount, candidatePool.length);
  const chosenColors = [];
  const chosenIndices = [];
  const used = new Set();

  for (let pick = 0; pick < maxPickCount; pick++) {
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < candidatePool.length; i++) {
      if (used.has(i)) continue;
      const score = scoreCandidate(candidatePool[i], chosenColors, rarityMap);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      chosenColors.push(candidatePool[bestIndex]);
      chosenIndices.push(bestIndex);
      used.add(bestIndex);
    }
  }

  return { colors: chosenColors, chosenIndices };
}
