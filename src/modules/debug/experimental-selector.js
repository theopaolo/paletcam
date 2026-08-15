/**
 * Experimental palette selector — prototype of the proposed OKLab pipeline.
 *
 * Not wired into the app. Lives in the debug harness so it can be A/B'd against
 * the production median-cut+scorer across the test gallery.
 *
 * Pipeline:
 *   1. Sample pixels -> OKLab.
 *   2. Analyze the cloud (chroma percentile) to set an image-relative neutral
 *      threshold, so a faint pink in a grey photo still counts as a color.
 *   3. Split neutral vs chromatic pixels.
 *   4. Reserve achromatic slots by lightness band (dark/mid/light) proportional
 *      to neutral mass -> guarantees black/white/grey when they are really there.
 *   5. Grid-cluster the chromatic pixels in OKLab; drop phantom (tiny) clusters.
 *   6. Greedy-select clusters with a HARD repulsion radius, chroma-led.
 *   7. Representative = the highest-chroma real pixel in each cluster (never a
 *      mean) -> kills muting, lets small vivid regions survive.
 */

import { oklabToRgb, rgbToOklab } from "../color-space-oklch.js";
import { selectPaletteCandidates } from "../hybrid-selector.js";
import { packImageDataToArgb8888 } from "../palette-pixel-pack.js";

function argbToRgb(argb) {
  return { r: (argb >>> 16) & 0xff, g: (argb >>> 8) & 0xff, b: argb & 0xff };
}

function oklabDistance(first, second) {
  return Math.hypot(first.L - second.L, first.a - second.a, first.b - second.b);
}

const NEUTRAL_POLICIES = Object.freeze({
  color: Object.freeze({ massFloor: 0.08, slotScale: 0.5 }),
  balanced: Object.freeze({ massFloor: 0.05, slotScale: 1 }),
  neutrals: Object.freeze({ massFloor: 0.03, slotScale: 1.35 }),
});

// Reserve neutral swatches across lightness bands, heaviest band first. Each
// representative is the cleanest (lowest-chroma) neutral near the band's median.
// A band must hold at least `minBandMass` pixels to earn a slot, so faint
// anti-alias greys don't claim an invisible swatch.
function pickNeutralBands(neutralPixels, slots, minBandMass, neutralBalance) {
  if (slots <= 0 || neutralPixels.length === 0) return [];

  const bands = [
    { key: "dark", lo: 0, hi: 0.34, pixels: [] },
    { key: "mid", lo: 0.34, hi: 0.66, pixels: [] },
    { key: "light", lo: 0.66, hi: 1.01, pixels: [] },
  ];
  for (const px of neutralPixels) {
    (bands.find((band) => px.L >= band.lo && px.L < band.hi) ?? bands[2]).pixels.push(px);
  }

  const eligible = bands
    .filter((band) => band.pixels.length >= minBandMass)
    .sort((a, b) => b.pixels.length - a.pixels.length);
  const ordered =
    neutralBalance === "neutrals" && slots >= 2
      ? [
          ...eligible.filter((band) => band.key !== "mid"),
          ...eligible.filter((band) => band.key === "mid"),
        ]
      : eligible;

  return ordered.slice(0, slots).map((band) => {
    if (neutralBalance === "neutrals" && band.key !== "mid") {
      const endpointScore = (pixel) =>
        pixel.c + (band.key === "dark" ? pixel.L : 1 - pixel.L) * 0.04;
      const endpoint = band.pixels.reduce((best, pixel) =>
        endpointScore(pixel) < endpointScore(best) ? pixel : best,
      );
      return { rgb: endpoint.rgb, L: endpoint.L, a: endpoint.a, b: endpoint.b };
    }
    const sortedByLightness = band.pixels.slice().sort((a, b) => a.L - b.L);
    const median = sortedByLightness[Math.floor(sortedByLightness.length / 2)];
    let cleanest = median;
    for (const px of band.pixels) {
      if (Math.abs(px.L - median.L) < 0.06 && px.c < cleanest.c) cleanest = px;
    }
    return { rgb: cleanest.rgb, L: cleanest.L, a: cleanest.a, b: cleanest.b };
  });
}

function lerpRgb(soft, vivid, t) {
  return {
    r: Math.round(soft.r + (vivid.r - soft.r) * t),
    g: Math.round(soft.g + (vivid.g - soft.g) * t),
    b: Math.round(soft.b + (vivid.b - soft.b) * t),
  };
}

// The original experiment blended Tone in gamma sRGB. `oklab` keeps the same
// candidates and scoring, changing only the interpolation geometry so the lab
// can isolate its visual effect.
export function interpolateGridTone(softRgb, vividRgb, softLab, vividLab, tone, toneSpace) {
  if (toneSpace === "oklab") {
    return oklabToRgb(
      softLab.L + (vividLab.L - softLab.L) * tone,
      softLab.a + (vividLab.a - softLab.a) * tone,
      softLab.b + (vividLab.b - softLab.b) * tone,
    );
  }
  return lerpRgb(softRgb, vividRgb, tone);
}

function toneRepresentative(cluster, tone, toneSpace) {
  return interpolateGridTone(
    cluster.meanRgb,
    cluster.rgb,
    cluster,
    cluster.vividLab,
    tone,
    toneSpace,
  );
}

// Bin pixels into OKLab cells. Each cluster keeps its mean position,
// mass, the highest-chroma pixel (vivid representative), and the mean RGB (soft
// representative) — the Tone control blends between the two.
function gridClusterPixels(chromaticPixels, cell) {
  const cells = new Map();
  for (const px of chromaticPixels) {
    const key = `${Math.floor(px.L / cell)}|${Math.floor(px.a / cell)}|${Math.floor(px.b / cell)}`;
    let cluster = cells.get(key);
    if (!cluster) {
      cluster = { sumL: 0, sumA: 0, sumB: 0, sumR: 0, sumG: 0, sumB8: 0, mass: 0, peak: null };
      cells.set(key, cluster);
    }
    cluster.sumL += px.L;
    cluster.sumA += px.a;
    cluster.sumB += px.b;
    cluster.sumR += px.rgb.r;
    cluster.sumG += px.rgb.g;
    cluster.sumB8 += px.rgb.b;
    cluster.mass += 1;
    if (!cluster.peak || px.c > cluster.peak.c) cluster.peak = px;
  }

  return [...cells.values()].map((cluster) => {
    const L = cluster.sumL / cluster.mass;
    const a = cluster.sumA / cluster.mass;
    const b = cluster.sumB / cluster.mass;
    return {
      L,
      a,
      b,
      mass: cluster.mass,
      c: cluster.peak.c,
      centroidC: Math.hypot(a, b),
      rgb: cluster.peak.rgb,
      vividLab: { L: cluster.peak.L, a: cluster.peak.a, b: cluster.peak.b },
      meanRgb: {
        r: Math.round(cluster.sumR / cluster.mass),
        g: Math.round(cluster.sumG / cluster.mass),
        b: Math.round(cluster.sumB8 / cluster.mass),
      },
    };
  });
}

function sampleOklabPixels(imageData, width, height, maxQuantizerPixels) {
  const packed = packImageDataToArgb8888(imageData, width, height, {
    maxPixels: maxQuantizerPixels,
  });
  const pixels = [];
  for (let i = 0; i < packed.length; i += 1) {
    const rgb = argbToRgb(packed[i]);
    const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
    pixels.push({ rgb, L: lab.L, a: lab.a, b: lab.b, c: Math.hypot(lab.a, lab.b) });
  }
  return pixels;
}

function getChromaDistribution(pixels) {
  const sorted = pixels.map((px) => px.c).sort((left, right) => left - right);
  return {
    p90: sorted[Math.floor(0.9 * (sorted.length - 1))],
    median: sorted[Math.floor(0.5 * (sorted.length - 1))],
  };
}

function significantClusters(clusters, pixelCount, chromaP90, phantomMassFraction) {
  const minMass = Math.max(1, pixelCount * phantomMassFraction);
  const rescueMass = Math.max(3, pixelCount * 0.001);
  const chromaKeep = Math.max(0.05, chromaP90 * 0.5);
  const significant = clusters.filter(
    (cluster) => cluster.mass >= minMass || (cluster.c >= chromaKeep && cluster.mass >= rescueMass),
  );
  return significant.length > 0 ? significant : clusters;
}

function clusterHue(cluster) {
  const hue = Math.atan2(cluster.b, cluster.a) * (180 / Math.PI);
  return hue < 0 ? hue + 360 : hue;
}

// Angular hue gap normalized to 0..1 (1 = opposite hues).
function hueGap(hueA, hueB) {
  const delta = Math.abs(hueA - hueB);
  return Math.min(delta, 360 - delta) / 180;
}

// Greedy selection in OKLab. Each pick maximizes a blend of vividness, hue
// coverage (so one dominant hue can't claim every slot), and rarity, subject to
// a hard minimum distance. If the radius can't be satisfied, relax to the
// farthest-from-chosen remaining cluster ("unless there are no others left").
function greedySelectChromatic(clusters, slots, radius, spreadStrength, rarityStrength) {
  if (slots <= 0 || clusters.length === 0) return [];

  const maxChroma = Math.max(...clusters.map((cluster) => cluster.c)) || 1;
  const maxMass = Math.max(...clusters.map((cluster) => cluster.mass)) || 1;
  const available = clusters.map((cluster) => ({
    ...cluster,
    hue: clusterHue(cluster),
    chromaNorm: cluster.c / maxChroma,
    rarityNorm: 1 - cluster.mass / maxMass,
  }));

  const picked = [];

  while (picked.length < slots && available.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[i];
      if (picked.some((p) => oklabDistance(p, candidate) < radius)) continue;

      const hueSpread = picked.length
        ? Math.min(...picked.map((p) => hueGap(p.hue, candidate.hue)))
        : 0;
      const score =
        candidate.chromaNorm + spreadStrength * hueSpread + rarityStrength * candidate.rarityNorm;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      // Repulsion exhausted — take the farthest-from-chosen remaining cluster.
      let bestDistance = -1;
      for (let i = 0; i < available.length; i += 1) {
        const minDistance = picked.length
          ? Math.min(...picked.map((p) => oklabDistance(p, available[i])))
          : available[i].chromaNorm;
        if (minDistance > bestDistance) {
          bestDistance = minDistance;
          bestIndex = i;
        }
      }
    }

    picked.push(available.splice(bestIndex, 1)[0]);
  }

  return picked;
}

/**
 * @param {Uint8ClampedArray} imageData
 * @param {number} width
 * @param {number} height
 * @param {number} swatchCount
 * @param {object} [params]
 * @param {number} [params.repulsionRadius=0.08]
 * @param {number} [params.maxQuantizerPixels=40000]
 * @param {number} [params.phantomMassFraction=0.004]
 * @param {"srgb" | "oklab"} [params.toneSpace="srgb"]
 * @returns {{ colors: object[], clusters: object[], neutralCount: number, neutralThreshold: number }}
 */
export function selectPaletteExperimental(imageData, width, height, swatchCount, params = {}) {
  const {
    repulsionRadius = 0.08,
    maxQuantizerPixels = 40000,
    phantomMassFraction = 0.004,
    spreadStrength = 0.6,
    rarityStrength = 0.2,
    tone = 0.85,
    toneSpace = "srgb",
    neutralBalance = "balanced",
  } = params;

  const empty = { colors: [], clusters: [], neutralCount: 0, neutralThreshold: 0 };
  if (!imageData || width <= 0 || height <= 0) return empty;

  const pixels = sampleOklabPixels(imageData, width, height, maxQuantizerPixels);
  if (pixels.length === 0) return empty;

  // Image-relative neutral threshold from the 90th chroma percentile. The floor
  // is high enough that a warm off-white / cream background counts as neutral
  // (and gets reserved as a clean white) instead of polluting the warm hues.
  const { p90: chromaP90, median: medianChroma } = getChromaDistribution(pixels);
  const baseThreshold = Math.max(0.02, Math.min(0.045, chromaP90 * 0.25));
  // Dominant near-neutral field: if half the pixels are barely chromatic (a
  // cream / grey background), lift the threshold just above that mass so it
  // reads as a neutral and gets reserved, instead of polluting the warm hues.
  const dominantNeutral = medianChroma < 0.04 ? medianChroma * 1.3 : 0;
  const neutralThreshold = Math.min(0.06, Math.max(baseThreshold, dominantNeutral));

  const neutralPixels = [];
  const chromaticPixels = [];
  for (const px of pixels) {
    (px.c < neutralThreshold ? neutralPixels : chromaticPixels).push(px);
  }

  // Reserve neutral slots proportional to neutral mass (capped so chromatic
  // colors keep at least one slot when they exist).
  const neutralFraction = neutralPixels.length / pixels.length;
  const maxNeutral = chromaticPixels.length > 0 ? Math.min(swatchCount - 1, 3) : swatchCount;
  const neutralPolicy = NEUTRAL_POLICIES[neutralBalance] ?? NEUTRAL_POLICIES.balanced;
  const proportionalNeutral = Math.round(swatchCount * neutralFraction * neutralPolicy.slotScale);
  let requestedNeutral = Math.min(proportionalNeutral, maxNeutral);
  if (neutralBalance === "color" && chromaticPixels.length > 0) {
    requestedNeutral = Math.min(requestedNeutral, 1);
  } else if (neutralBalance === "neutrals" && neutralPixels.length > 0) {
    requestedNeutral = Math.max(requestedNeutral, Math.min(2, maxNeutral));
  }
  const minBandMass = Math.max(1, pixels.length * neutralPolicy.massFloor);
  const neutralColors = pickNeutralBands(
    neutralPixels,
    Math.max(0, requestedNeutral),
    minBandMass,
    neutralBalance,
  );

  const chromaticSlots = swatchCount - neutralColors.length;
  const cell = Math.max(0.02, repulsionRadius * 0.5);
  const clusters = gridClusterPixels(chromaticPixels, cell);

  // Phantom guard: drop tiny clusters — but rescue a small cluster that is
  // genuinely vivid, so a rare saturated accent (a blue eye, a yellow detail)
  // survives instead of being filtered as noise.
  const significant = significantClusters(clusters, pixels.length, chromaP90, phantomMassFraction);
  const chromaticColors = greedySelectChromatic(
    significant,
    chromaticSlots,
    repulsionRadius,
    spreadStrength,
    rarityStrength,
  ).map((cluster) => ({
    // Tone blends the representative from the cluster mean (soft) to its
    // highest-chroma pixel (vivid).
    rgb: toneRepresentative(cluster, tone, toneSpace),
    L: cluster.L,
  }));

  const colors = [...neutralColors, ...chromaticColors]
    .slice(0, swatchCount)
    .sort((x, y) => x.L - y.L)
    .map((entry) => entry.rgb);

  return {
    colors,
    clusters: significant,
    neutralCount: neutralColors.length,
    neutralThreshold,
  };
}

/**
 * Experimental hybrid: OKLab grid cells generate the candidate pool, then
 * the production neutral reservation, hue guard, perceptual scorer, loyalty,
 * Tone interpolation, and final ordering choose the palette.
 */
export function selectPaletteGridHybrid(imageData, width, height, swatchCount, params = {}) {
  const {
    repulsionRadius = 0.08,
    maxQuantizerPixels = 40000,
    phantomMassFraction = 0.004,
  } = params;
  const empty = {
    colors: [],
    candidates: [],
    gridCandidates: [],
    neutralCount: 0,
    neutralThreshold: 0,
  };
  if (!imageData || width <= 0 || height <= 0) return empty;

  const pixels = sampleOklabPixels(imageData, width, height, maxQuantizerPixels);
  if (pixels.length === 0) return empty;

  const { p90: chromaP90 } = getChromaDistribution(pixels);
  const cell = Math.max(0.02, repulsionRadius * 0.5);
  const clusters = significantClusters(
    gridClusterPixels(pixels, cell),
    pixels.length,
    chromaP90,
    phantomMassFraction,
  );
  const gridCandidates = clusters.map((cluster) => ({
    meanRgb: oklabToRgb(cluster.L, cluster.a, cluster.b),
    vividRgb: cluster.rgb,
    L: cluster.L,
    a: cluster.a,
    b: cluster.b,
    c: cluster.centroidC,
    vividLab: cluster.vividLab,
    vividC: cluster.c,
    mass: cluster.mass,
  }));
  const selected = selectPaletteCandidates(gridCandidates, swatchCount, {
    ...params,
    colorMath: "oklab",
  });
  return { ...selected, gridCandidates };
}

/**
 * Analyze an image and suggest selector defaults (David's "preset from the
 * image" idea): a hue-concentrated image wants more Variety to surface its few
 * other hues; a wider colour cloud wants a larger Distinctness radius.
 *
 * @returns {{ variety: number, distinctness: number }}  variety 0..1, distinctness = OKLab radius
 */
export function suggestSelectorParams(imageData, width, height, maxQuantizerPixels = 40000) {
  const fallback = { variety: 0.8, distinctness: 0.06 };
  if (!imageData || width <= 0 || height <= 0) return fallback;

  const packed = packImageDataToArgb8888(imageData, width, height, {
    maxPixels: maxQuantizerPixels,
  });
  if (packed.length === 0) return fallback;

  let sumHueX = 0;
  let sumHueY = 0;
  let chromaWeight = 0;
  let sumA = 0;
  let sumB = 0;
  const labs = [];

  for (let i = 0; i < packed.length; i += 1) {
    const rgb = argbToRgb(packed[i]);
    const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
    const c = Math.hypot(lab.a, lab.b);
    labs.push(lab);
    sumA += lab.a;
    sumB += lab.b;
    if (c > 0.03) {
      const hue = Math.atan2(lab.b, lab.a);
      sumHueX += Math.cos(hue) * c;
      sumHueY += Math.sin(hue) * c;
      chromaWeight += c;
    }
  }

  // Chroma-weighted hue concentration: ~1 = single hue (monochrome), ~0 = spread.
  const concentration = chromaWeight > 0 ? Math.hypot(sumHueX, sumHueY) / chromaWeight : 0;

  // RMS spread of the cloud in the chromatic plane.
  const meanA = sumA / labs.length;
  const meanB = sumB / labs.length;
  let sumSq = 0;
  for (const lab of labs) sumSq += (lab.a - meanA) ** 2 + (lab.b - meanB) ** 2;
  const spread = Math.sqrt(sumSq / labs.length);

  return {
    variety: Math.max(0.55, Math.min(1, 0.55 + 0.5 * concentration)),
    distinctness: Math.max(0.05, Math.min(0.085, 0.05 + spread * 0.25)),
  };
}
