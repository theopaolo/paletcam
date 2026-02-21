import { ColorCutQuantizer } from './ColorCutQuantizer.js';

const MIN_SWATCH_COUNT = 1;
const COLOR_DISTANCE_THRESHOLD = 12;
const MAX_KMEANS_SAMPLES = 4000;
const DEFAULT_ALGORITHM_ID = 'center-strip';

const PALETTE_ALGORITHMS = [
  {
    id: 'center-strip',
    label: 'Center Strip',
    description: 'Legacy horizontal strip sampling.',
    controls: [
      {
        key: 'sampleRowRatio',
        type: 'range',
        label: 'Sample Row',
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
      },
      {
        key: 'patchRadius',
        type: 'range',
        label: 'Patch Radius',
        min: 0,
        max: 18,
        step: 1,
        defaultValue: 7,
      },
    ],
  },
  {
    id: 'stratified-grid',
    label: 'Stratified Grid',
    description: 'Full-frame grid sampling with contrast and saturation bias.',
    controls: [
      {
        key: 'gridColumns',
        type: 'range',
        label: 'Grid Columns',
        min: 2,
        max: 24,
        step: 1,
        defaultValue: 10,
      },
      {
        key: 'gridRows',
        type: 'range',
        label: 'Grid Rows',
        min: 2,
        max: 16,
        step: 1,
        defaultValue: 8,
      },
      {
        key: 'patchRadius',
        type: 'range',
        label: 'Patch Radius',
        min: 0,
        max: 8,
        step: 1,
        defaultValue: 2,
      },
      {
        key: 'contrastBias',
        type: 'range',
        label: 'Contrast Bias',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.35,
      },
      {
        key: 'saturationBias',
        type: 'range',
        label: 'Saturation Bias',
        min: 0,
        max: 1.5,
        step: 0.05,
        defaultValue: 0.8,
      },
    ],
  },
  {
    id: 'color-cut',
    label: 'ColorCut (Android)',
    description: 'Histogram + median-cut color quantization from Android Palette.',
    controls: [
      {
        key: 'sampleStride',
        type: 'range',
        label: 'Pixel Stride',
        min: 1,
        max: 24,
        step: 1,
        defaultValue: 6,
      },
      {
        key: 'ignoreNearWhite',
        type: 'toggle',
        label: 'Ignore Near White',
        defaultValue: false,
      },
      {
        key: 'ignoreNearBlack',
        type: 'toggle',
        label: 'Ignore Near Black',
        defaultValue: false,
      },
      {
        key: 'ignoreLowSaturation',
        type: 'toggle',
        label: 'Ignore Low Saturation',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'kmeans-oklab',
    label: 'K-Means++ (OKLab)',
    description: 'Perceptual clustering with k-means++ seeds.',
    controls: [
      {
        key: 'sampleStride',
        type: 'range',
        label: 'Pixel Stride',
        min: 1,
        max: 24,
        step: 1,
        defaultValue: 6,
      },
      {
        key: 'iterations',
        type: 'range',
        label: 'Iterations',
        min: 2,
        max: 20,
        step: 1,
        defaultValue: 8,
      },
      {
        key: 'chromaWeight',
        type: 'range',
        label: 'Chroma Weight',
        min: 0,
        max: 2,
        step: 0.05,
        defaultValue: 0.7,
      },
    ],
  },
];

const PALETTE_ALGORITHM_BY_ID = new Map(PALETTE_ALGORITHMS.map((algorithm) => [algorithm.id, algorithm]));

const ALGORITHM_EXTRACTORS = {
  'center-strip': extractCenterStripPalette,
  'stratified-grid': extractStratifiedGridPalette,
  'color-cut': extractColorCutPalette,
  'kmeans-oklab': extractKmeansOklabPalette,
};

function clampSwatchCount(swatchCount) {
  return Math.max(MIN_SWATCH_COUNT, Number(swatchCount) || MIN_SWATCH_COUNT);
}

function buildRgbColor(red, green, blue) {
  return {
    r: clampChannel(red),
    g: clampChannel(green),
    b: clampChannel(blue),
  };
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function cloneControl(control) {
  return { ...control };
}

function cloneAlgorithmDefinition(definition) {
  return {
    ...definition,
    controls: definition.controls.map(cloneControl),
  };
}

function getSafeAlgorithmId(algorithmId) {
  if (PALETTE_ALGORITHM_BY_ID.has(algorithmId)) {
    return algorithmId;
  }

  return DEFAULT_ALGORITHM_ID;
}

function getAlgorithmDefinition(algorithmId) {
  return PALETTE_ALGORITHM_BY_ID.get(getSafeAlgorithmId(algorithmId))
    ?? PALETTE_ALGORITHM_BY_ID.get(DEFAULT_ALGORITHM_ID);
}

function sanitizeRangeControlValue(rawValue, control) {
  const fallback = Number(control.defaultValue);
  const value = Number(rawValue);
  const safeValue = Number.isFinite(value) ? value : fallback;
  const min = Number(control.min);
  const max = Number(control.max);
  const clamped = Math.min(max, Math.max(min, safeValue));
  const step = Number(control.step);

  if (!Number.isFinite(step) || step <= 0) {
    return clamped;
  }

  const steps = Math.round((clamped - min) / step);
  const normalized = min + (steps * step);
  return Number(normalized.toFixed(6));
}

function sanitizeToggleControlValue(rawValue, control) {
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  if (rawValue === '1' || rawValue === 1 || rawValue === 'true') {
    return true;
  }

  if (rawValue === '0' || rawValue === 0 || rawValue === 'false') {
    return false;
  }

  return Boolean(control.defaultValue);
}

function sanitizeControlValue(rawValue, control) {
  if (control.type === 'toggle') {
    return sanitizeToggleControlValue(rawValue, control);
  }

  return sanitizeRangeControlValue(rawValue, control);
}

export function getPaletteAlgorithmDefinitions() {
  return PALETTE_ALGORITHMS.map(cloneAlgorithmDefinition);
}

export function getDefaultPaletteAlgorithmId() {
  return DEFAULT_ALGORITHM_ID;
}

export function getDefaultPaletteAlgorithmOptions(algorithmId) {
  const definition = getAlgorithmDefinition(algorithmId);
  const defaults = {};

  definition.controls.forEach((control) => {
    defaults[control.key] = control.defaultValue;
  });

  return defaults;
}

export function resolvePaletteAlgorithmOptions(algorithmId, rawOptions = {}) {
  const definition = getAlgorithmDefinition(algorithmId);
  const normalizedOptions = {};

  definition.controls.forEach((control) => {
    normalizedOptions[control.key] = sanitizeControlValue(rawOptions?.[control.key], control);
  });

  return normalizedOptions;
}

export function toRgbCss(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function extractPaletteColors(
  imageData,
  frameWidth,
  frameHeight,
  swatchCount,
  extractionConfig = {},
) {
  const normalizedSwatchCount = clampSwatchCount(swatchCount);
  const safeAlgorithmId = getSafeAlgorithmId(extractionConfig.algorithmId);
  const options = resolvePaletteAlgorithmOptions(safeAlgorithmId, extractionConfig.options);
  const extractor = ALGORITHM_EXTRACTORS[safeAlgorithmId] ?? extractCenterStripPalette;

  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return [];
  }

  const rawColors = extractor(imageData, frameWidth, frameHeight, normalizedSwatchCount, options);
  const normalizedColors = rawColors
    .slice(0, normalizedSwatchCount)
    .map((color) => buildRgbColor(color.r, color.g, color.b));

  if (normalizedColors.length > 0) {
    return ensurePaletteLength(
      normalizedColors,
      normalizedSwatchCount,
      normalizedColors[normalizedColors.length - 1],
    );
  }

  return ensurePaletteLength(
    [],
    normalizedSwatchCount,
    getAverageFrameColor(imageData, frameWidth, frameHeight),
  );
}

function extractCenterStripPalette(imageData, frameWidth, frameHeight, swatchCount, options) {
  const sampleRowRatio = options.sampleRowRatio;
  const sampleRow = Math.floor((frameHeight - 1) * sampleRowRatio);
  const sampleRadius = Math.max(0, Math.floor(options.patchRadius));

  return Array.from({ length: swatchCount }, (_, index) => {
    const sampleX = Math.floor(
      (frameWidth / swatchCount) * index + frameWidth / (swatchCount * 2),
    );

    return averageBlockColor(imageData, frameWidth, frameHeight, sampleX, sampleRow, sampleRadius);
  });
}

function extractStratifiedGridPalette(imageData, frameWidth, frameHeight, swatchCount, options) {
  const columns = Math.max(2, Math.floor(options.gridColumns));
  const rows = Math.max(2, Math.floor(options.gridRows));
  const radius = Math.max(0, Math.floor(options.patchRadius));
  const candidates = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sampleX = Math.floor(((column + 0.5) / columns) * frameWidth);
      const sampleY = Math.floor(((row + 0.5) / rows) * frameHeight);
      const color = averageBlockColor(imageData, frameWidth, frameHeight, sampleX, sampleY, radius);
      const score = getGridCandidateScore(color, options);

      candidates.push({ color, score });
    }
  }

  candidates.sort((first, second) => second.score - first.score);

  return pickDiverseColors(candidates, swatchCount, 24);
}

function getGridCandidateScore(color, options) {
  const saturation = computeRgbSaturation(color.r, color.g, color.b);
  const luma = getColorLuma(color) / 255;
  const contrast = Math.abs(luma - 0.5) * 2;

  return 1 + (saturation * options.saturationBias) + (contrast * options.contrastBias);
}

function extractColorCutPalette(imageData, frameWidth, frameHeight, swatchCount, options) {
  const stride = Math.max(1, Math.floor(options.sampleStride));
  const sampledPixels = sampleRgb888Pixels(imageData, frameWidth, frameHeight, stride);

  if (sampledPixels.length === 0) {
    return [];
  }

  const filters = buildColorCutFilters(options);
  const quantizer = new ColorCutQuantizer(sampledPixels, swatchCount, filters);
  const swatches = quantizer.getQuantizedColors() ?? [];

  const colors = swatches
    .sort((first, second) => (second.population ?? 0) - (first.population ?? 0))
    .map((swatch) => unpackRgb888(swatch.rgb));

  return ensurePaletteLength(colors, swatchCount, getAverageFrameColor(imageData, frameWidth, frameHeight));
}

function buildColorCutFilters(options) {
  const filters = [];

  if (options.ignoreNearWhite) {
    filters.push({
      isAllowed: (_rgb, hsl) => hsl[2] < 0.96,
    });
  }

  if (options.ignoreNearBlack) {
    filters.push({
      isAllowed: (_rgb, hsl) => hsl[2] > 0.04,
    });
  }

  if (options.ignoreLowSaturation) {
    filters.push({
      isAllowed: (_rgb, hsl) => hsl[1] > 0.12,
    });
  }

  return filters;
}

function extractKmeansOklabPalette(imageData, frameWidth, frameHeight, swatchCount, options) {
  const stride = Math.max(1, Math.floor(options.sampleStride));
  const iterations = Math.max(2, Math.floor(options.iterations));
  const chromaWeight = Number(options.chromaWeight) || 0;
  let samples = collectOklabSamples(imageData, frameWidth, frameHeight, stride, chromaWeight);

  if (samples.length === 0) {
    return [];
  }

  if (samples.length > MAX_KMEANS_SAMPLES) {
    samples = downsampleSamples(samples, MAX_KMEANS_SAMPLES);
  }

  const clusterCount = Math.min(swatchCount, samples.length);
  const centroids = initializeKmeansPlusPlusCentroids(samples, clusterCount);

  if (centroids.length === 0) {
    return [];
  }

  let assignments = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    assignments = assignSamplesToCentroids(samples, centroids);
    updateCentroidsFromAssignments(samples, centroids, assignments);
  }

  const populations = countClusterPopulations(assignments, centroids.length);

  const candidates = centroids.map((centroid, index) => ({
    color: oklabToRgb(centroid),
    score: populations[index],
  }));

  candidates.sort((first, second) => second.score - first.score);

  return pickDiverseColors(candidates, swatchCount, 18);
}

function collectOklabSamples(imageData, frameWidth, frameHeight, stride, chromaWeight) {
  const samples = [];

  for (let y = 0; y < frameHeight; y += stride) {
    for (let x = 0; x < frameWidth; x += stride) {
      const index = (y * frameWidth + x) * 4;
      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      const lab = rgbToOklab({ r, g, b });
      const chroma = Math.hypot(lab.a, lab.b);

      samples.push({
        L: lab.L,
        a: lab.a,
        b: lab.b,
        weight: 1 + (chromaWeight * chroma * 6),
      });
    }
  }

  return samples;
}

function downsampleSamples(samples, maxCount) {
  if (samples.length <= maxCount) {
    return samples;
  }

  const reducedSamples = [];
  const scale = samples.length / maxCount;

  for (let index = 0; index < maxCount; index += 1) {
    reducedSamples.push(samples[Math.floor(index * scale)]);
  }

  return reducedSamples;
}

function initializeKmeansPlusPlusCentroids(samples, clusterCount) {
  if (!Array.isArray(samples) || samples.length === 0 || clusterCount <= 0) {
    return [];
  }

  const centroids = [];
  const firstIndex = Math.floor(Math.random() * samples.length);
  const first = samples[firstIndex];
  centroids.push({ L: first.L, a: first.a, b: first.b });

  while (centroids.length < clusterCount) {
    const distances = [];
    let totalScore = 0;

    for (const sample of samples) {
      const distanceSquared = getNearestCentroidDistanceSquared(sample, centroids);
      const weightedDistance = distanceSquared * sample.weight;
      distances.push(weightedDistance);
      totalScore += weightedDistance;
    }

    if (totalScore <= 0) {
      const fallbackSample = samples[Math.floor(Math.random() * samples.length)];
      centroids.push({ L: fallbackSample.L, a: fallbackSample.a, b: fallbackSample.b });
      continue;
    }

    let threshold = Math.random() * totalScore;
    let selectedIndex = samples.length - 1;

    for (let index = 0; index < samples.length; index += 1) {
      threshold -= distances[index];
      if (threshold <= 0) {
        selectedIndex = index;
        break;
      }
    }

    const selected = samples[selectedIndex];
    centroids.push({ L: selected.L, a: selected.a, b: selected.b });
  }

  return centroids;
}

function getNearestCentroidDistanceSquared(sample, centroids) {
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const centroid of centroids) {
    const distance = getOklabDistanceSquared(sample, centroid);
    if (distance < nearestDistance) {
      nearestDistance = distance;
    }
  }

  return nearestDistance;
}

function getOklabDistanceSquared(first, second) {
  const deltaL = first.L - second.L;
  const deltaA = first.a - second.a;
  const deltaB = first.b - second.b;
  return (deltaL * deltaL) + (deltaA * deltaA) + (deltaB * deltaB);
}

function assignSamplesToCentroids(samples, centroids) {
  const assignments = new Array(samples.length).fill(0);

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    let bestCentroidIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const centroid = centroids[centroidIndex];
      const distance = getOklabDistanceSquared(sample, centroid);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCentroidIndex = centroidIndex;
      }
    }

    assignments[sampleIndex] = bestCentroidIndex;
  }

  return assignments;
}

function updateCentroidsFromAssignments(samples, centroids, assignments) {
  const totals = centroids.map(() => ({
    L: 0,
    a: 0,
    b: 0,
    weight: 0,
  }));

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const centroidIndex = assignments[sampleIndex];
    const bucket = totals[centroidIndex];

    bucket.L += sample.L * sample.weight;
    bucket.a += sample.a * sample.weight;
    bucket.b += sample.b * sample.weight;
    bucket.weight += sample.weight;
  }

  for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
    const bucket = totals[centroidIndex];
    const centroid = centroids[centroidIndex];

    if (bucket.weight > 0) {
      centroid.L = bucket.L / bucket.weight;
      centroid.a = bucket.a / bucket.weight;
      centroid.b = bucket.b / bucket.weight;
    } else {
      const fallback = samples[Math.floor(Math.random() * samples.length)];
      centroid.L = fallback.L;
      centroid.a = fallback.a;
      centroid.b = fallback.b;
    }
  }
}

function countClusterPopulations(assignments, clusterCount) {
  const populations = new Array(clusterCount).fill(0);

  assignments.forEach((clusterIndex) => {
    if (clusterIndex >= 0 && clusterIndex < clusterCount) {
      populations[clusterIndex] += 1;
    }
  });

  return populations;
}

function sampleRgb888Pixels(imageData, frameWidth, frameHeight, stride) {
  const samples = [];

  for (let y = 0; y < frameHeight; y += stride) {
    for (let x = 0; x < frameWidth; x += stride) {
      const index = (y * frameWidth + x) * 4;
      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      samples.push(packRgb888(r, g, b));
    }
  }

  return Int32Array.from(samples);
}

function packRgb888(red, green, blue) {
  return (255 << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
}

function unpackRgb888(rgb) {
  const unsignedRgb = rgb >>> 0;
  return buildRgbColor(
    (unsignedRgb >> 16) & 255,
    (unsignedRgb >> 8) & 255,
    unsignedRgb & 255,
  );
}

function averageBlockColor(imageData, frameWidth, frameHeight, centerX, centerY, sampleRadius) {
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let sampledPixelCount = 0;

  for (let offsetY = -sampleRadius; offsetY <= sampleRadius; offsetY += 1) {
    const y = centerY + offsetY;
    if (y < 0 || y >= frameHeight) {
      continue;
    }

    for (let offsetX = -sampleRadius; offsetX <= sampleRadius; offsetX += 1) {
      const x = centerX + offsetX;
      if (x < 0 || x >= frameWidth) {
        continue;
      }

      const pixelIndex = (y * frameWidth + x) * 4;
      totalR += imageData[pixelIndex];
      totalG += imageData[pixelIndex + 1];
      totalB += imageData[pixelIndex + 2];
      sampledPixelCount += 1;
    }
  }

  if (sampledPixelCount === 0) {
    return buildRgbColor(0, 0, 0);
  }

  return buildRgbColor(
    totalR / sampledPixelCount,
    totalG / sampledPixelCount,
    totalB / sampledPixelCount,
  );
}

function pickDiverseColors(candidates, swatchCount, minimumDistance) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const minimumDistanceSquared = minimumDistance * minimumDistance;
  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= swatchCount) {
      break;
    }

    const isFarEnough = selected.every(
      (selectedColor) => getColorDistanceSquared(selectedColor, candidate.color) >= minimumDistanceSquared,
    );

    if (isFarEnough) {
      selected.push(candidate.color);
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= swatchCount) {
      break;
    }

    selected.push(candidate.color);
  }

  return selected.slice(0, swatchCount);
}

function ensurePaletteLength(colors, swatchCount, fallbackColor) {
  const palette = Array.isArray(colors) ? [...colors] : [];
  const safeFallback = fallbackColor ?? buildRgbColor(0, 0, 0);

  while (palette.length < swatchCount) {
    const lastColor = palette[palette.length - 1] ?? safeFallback;
    palette.push(lastColor);
  }

  return palette.slice(0, swatchCount);
}

function getAverageFrameColor(imageData, frameWidth, frameHeight) {
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  const totalPixels = frameWidth * frameHeight;

  if (!totalPixels) {
    return buildRgbColor(0, 0, 0);
  }

  for (let index = 0; index < imageData.length; index += 4) {
    totalR += imageData[index];
    totalG += imageData[index + 1];
    totalB += imageData[index + 2];
  }

  return buildRgbColor(totalR / totalPixels, totalG / totalPixels, totalB / totalPixels);
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

function computeRgbSaturation(red, green, blue) {
  const normalizedR = red / 255;
  const normalizedG = green / 255;
  const normalizedB = blue / 255;
  const maxChannel = Math.max(normalizedR, normalizedG, normalizedB);
  const minChannel = Math.min(normalizedR, normalizedG, normalizedB);

  if (maxChannel === minChannel) {
    return 0;
  }

  const lightness = (maxChannel + minChannel) / 2;
  const delta = maxChannel - minChannel;
  return delta / (1 - Math.abs((2 * lightness) - 1));
}

function rgbToOklab(color) {
  const linearRed = srgbToLinear(color.r / 255);
  const linearGreen = srgbToLinear(color.g / 255);
  const linearBlue = srgbToLinear(color.b / 255);

  const l = Math.cbrt((0.4122214708 * linearRed) + (0.5363325363 * linearGreen) + (0.0514459929 * linearBlue));
  const m = Math.cbrt((0.2119034982 * linearRed) + (0.6806995451 * linearGreen) + (0.1073969566 * linearBlue));
  const s = Math.cbrt((0.0883024619 * linearRed) + (0.2817188376 * linearGreen) + (0.6299787005 * linearBlue));

  return {
    L: (0.2104542553 * l) + (0.793617785 * m) - (0.0040720468 * s),
    a: (1.9779984951 * l) - (2.428592205 * m) + (0.4505937099 * s),
    b: (0.0259040371 * l) + (0.7827717662 * m) - (0.808675766 * s),
  };
}

function oklabToRgb(lab) {
  const l = lab.L + (0.3963377774 * lab.a) + (0.2158037573 * lab.b);
  const m = lab.L - (0.1055613458 * lab.a) - (0.0638541728 * lab.b);
  const s = lab.L - (0.0894841775 * lab.a) - (1.291485548 * lab.b);

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  const linearRed = (4.0767416621 * l3) - (3.3077115913 * m3) + (0.2309699292 * s3);
  const linearGreen = (-1.2684380046 * l3) + (2.6097574011 * m3) - (0.3413193965 * s3);
  const linearBlue = (-0.0041960863 * l3) - (0.7034186147 * m3) + (1.707614701 * s3);

  return buildRgbColor(
    linearToSrgb(linearRed) * 255,
    linearToSrgb(linearGreen) * 255,
    linearToSrgb(linearBlue) * 255,
  );
}

function srgbToLinear(channel) {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }

  return ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel) {
  const safeChannel = Math.max(0, Math.min(1, channel));

  if (safeChannel <= 0.0031308) {
    return 12.92 * safeChannel;
  }

  return (1.055 * (safeChannel ** (1 / 2.4))) - 0.055;
}

// Draw palette colors as equal-width vertical bars across the canvas.
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

export function resetColorSmoothing() {
  previousColors = null;
}

export function smoothColors(rawColors, lerpFactor) {
  if (!previousColors || previousColors.length !== rawColors.length) {
    previousColors = rawColors;
    return rawColors;
  }

  const smoothed = rawColors.map((rawColor, index) => {
    const previousColor = previousColors[index];
    const distance = Math.hypot(
      rawColor.r - previousColor.r,
      rawColor.g - previousColor.g,
      rawColor.b - previousColor.b,
    );

    if (distance < COLOR_DISTANCE_THRESHOLD) {
      return previousColor;
    }

    return buildRgbColor(
      previousColor.r + ((rawColor.r - previousColor.r) * lerpFactor),
      previousColor.g + ((rawColor.g - previousColor.g) * lerpFactor),
      previousColor.b + ((rawColor.b - previousColor.b) * lerpFactor),
    );
  });

  previousColors = smoothed;

  return smoothed;
}
