import { ColorCutQuantizer } from "./color-cut-quantizer.js";
import { rgbToOklab } from "./color-space-oklch.js";
import { packImageDataToArgb8888 } from "./palette-pixel-pack.js";

function argbToRgb(argb) {
  return { r: (argb >>> 16) & 0xff, g: (argb >>> 8) & 0xff, b: argb & 0xff };
}

function lerpRgb(soft, vivid, t) {
  return {
    r: Math.round(soft.r + (vivid.r - soft.r) * t),
    g: Math.round(soft.g + (vivid.g - soft.g) * t),
    b: Math.round(soft.b + (vivid.b - soft.b) * t),
  };
}

function hueGap(hueA, hueB) {
  const delta = Math.abs(hueA - hueB);
  return Math.min(delta, 360 - delta) / 180;
}

function buildCandidates(swatches) {
  return swatches
    .filter((swatch) => swatch && typeof swatch.rgb === "number")
    .map((swatch) => {
      const meanRgb = argbToRgb(swatch.rgb);
      const vividRgb = argbToRgb(swatch.vividRgb ?? swatch.rgb);
      const meanLab = rgbToOklab(meanRgb.r, meanRgb.g, meanRgb.b);
      const vividLab = rgbToOklab(vividRgb.r, vividRgb.g, vividRgb.b);
      return {
        meanRgb,
        vividRgb,
        L: meanLab.L,
        a: meanLab.a,
        b: meanLab.b,
        c: Math.hypot(meanLab.a, meanLab.b),
        vividC: Math.hypot(vividLab.a, vividLab.b),
        mass: swatch.population ?? 0,
      };
    });
}

function computeNeutralThreshold(candidates, totalMass) {
  if (candidates.length === 0 || totalMass <= 0) return 0.02;
  const weighted = candidates
    .map((c) => ({ chroma: c.c, weight: c.mass }))
    .sort((a, b) => a.chroma - b.chroma);
  let cumulative = 0;
  let p90 = weighted[weighted.length - 1].chroma;
  for (const entry of weighted) {
    cumulative += entry.weight;
    if (cumulative >= 0.9 * totalMass) {
      p90 = entry.chroma;
      break;
    }
  }
  const baseThreshold = Math.max(0.02, Math.min(0.045, p90 * 0.25));
  return Math.min(0.06, baseThreshold);
}

// Loyalty bonus (in chroma units) for neutral exemplars near a previous
// palette color, so a band doesn't flap between two similarly-clean grays
// from one extraction to the next.
const NEUTRAL_LOYALTY_WEIGHT = 0.02;
const NEUTRAL_POLICIES = Object.freeze({
  color: Object.freeze({ massFloor: 0.08, slotScale: 0.5 }),
  balanced: Object.freeze({ massFloor: 0.05, slotScale: 1 }),
  neutrals: Object.freeze({ massFloor: 0.03, slotScale: 1.35 }),
});

function pickNeutralBands(neutralCandidates, slots, minBandMass, previousLabs, neutralBalance) {
  if (slots <= 0 || neutralCandidates.length === 0) return [];
  const bands = [
    { key: "dark", lo: 0, hi: 0.34, items: [] },
    { key: "mid", lo: 0.34, hi: 0.66, items: [] },
    { key: "light", lo: 0.66, hi: 1.01, items: [] },
  ];
  for (const cand of neutralCandidates) {
    const band = bands.find((b) => cand.L >= b.lo && cand.L < b.hi) ?? bands[2];
    band.items.push(cand);
  }
  const eligible = bands
    .filter((band) => band.items.reduce((sum, c) => sum + c.mass, 0) >= minBandMass)
    .sort((a, b) => totalMass(b) - totalMass(a));
  const ordered =
    neutralBalance === "neutrals" && slots >= 2
      ? [
          ...eligible.filter((band) => band.key !== "mid"),
          ...eligible.filter((band) => band.key === "mid"),
        ]
      : eligible;
  const exemplarScore = (candidate, band) => {
    let endpointPenalty = 0;
    if (neutralBalance === "neutrals" && band.key === "dark") {
      endpointPenalty = candidate.L * 0.04;
    } else if (neutralBalance === "neutrals" && band.key === "light") {
      endpointPenalty = (1 - candidate.L) * 0.04;
    }
    return (
      candidate.c +
      endpointPenalty -
      NEUTRAL_LOYALTY_WEIGHT * computeLoyalty(candidate, previousLabs)
    );
  };
  return ordered.slice(0, slots).map((band) => ({
    ...band.items.reduce((cleanest, c) =>
      exemplarScore(c, band) < exemplarScore(cleanest, band) ? c : cleanest,
    ),
    // The exemplar represents the whole lightness band, so its density is
    // the band's mass, not the single candidate's.
    bandMass: totalMass(band),
  }));
}

function totalMass(band) {
  return band.items.reduce((sum, c) => sum + c.mass, 0);
}

function greedySelectChromatic(
  candidates,
  slots,
  radius,
  spreadStrength,
  rarityStrength,
  tone,
  hueRadiusDeg,
  previousLabs,
  loyaltyStrength,
) {
  if (slots <= 0 || candidates.length === 0) return [];
  const maxChroma = Math.max(...candidates.map((c) => c.vividC)) || 1;
  const maxMass = Math.max(...candidates.map((c) => c.mass)) || 1;
  const available = candidates.map((c) => {
    const blendedRgb = lerpRgb(c.meanRgb, c.vividRgb, tone);
    const blendedLab = rgbToOklab(blendedRgb.r, blendedRgb.g, blendedRgb.b);
    const blendedHue = Math.atan2(blendedLab.b, blendedLab.a) * (180 / Math.PI);
    return {
      ...c,
      blendedRgb,
      blendedL: blendedLab.L,
      blendedA: blendedLab.a,
      blendedB: blendedLab.b,
      hue: blendedHue < 0 ? blendedHue + 360 : blendedHue,
      chromaNorm: c.vividC / maxChroma,
      rarityNorm: 1 - c.mass / maxMass,
      loyaltyNorm: computeLoyalty(blendedLab, previousLabs),
    };
  });
  const picked = [];

  while (picked.length < slots && available.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[i];
      if (picked.some((p) => blendedDist(p, candidate) < radius)) continue;
      if (picked.some((p) => hueGap(p.hue, candidate.hue) * 180 < hueRadiusDeg)) continue;
      const hueSpread = picked.length
        ? Math.min(...picked.map((p) => hueGap(p.hue, candidate.hue)))
        : 0;
      const score =
        candidate.chromaNorm +
        spreadStrength * hueSpread +
        rarityStrength * candidate.rarityNorm +
        loyaltyStrength * candidate.loyaltyNorm;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) {
      let bestDistance = -1;
      for (let i = 0; i < available.length; i += 1) {
        const minDistance = picked.length
          ? Math.min(...picked.map((p) => blendedDist(p, available[i])))
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

// Hysteresis: candidates near a swatch from the previous extraction get a
// score bonus, so near-equal alternatives don't flip the palette every frame.
const LOYALTY_RADIUS = 0.1;

function computeLoyalty(candidateLab, previousLabs) {
  if (!previousLabs || previousLabs.length === 0) return 0;
  let minDistance = Infinity;
  for (const prev of previousLabs) {
    const distance = Math.hypot(
      candidateLab.L - prev.L,
      candidateLab.a - prev.a,
      candidateLab.b - prev.b,
    );
    if (distance < minDistance) minDistance = distance;
  }
  return Math.max(0, 1 - minDistance / LOYALTY_RADIUS);
}

function blendedDist(picked, candidate) {
  return Math.hypot(
    picked.blendedL - candidate.blendedL,
    picked.blendedA - candidate.blendedA,
    picked.blendedB - candidate.blendedB,
  );
}

function padToCount(colors, candidates, swatchCount, tone) {
  if (colors.length >= swatchCount) return colors.slice(0, swatchCount);
  const usedKeys = new Set(colors.map((c) => `${c.r},${c.g},${c.b}`));
  const filler = [];
  for (const cand of candidates) {
    if (filler.length + colors.length >= swatchCount) break;
    const rgb = lerpRgb(cand.meanRgb, cand.vividRgb, tone);
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    if (!usedKeys.has(key)) {
      filler.push({ ...rgb, population: Math.round(cand.mass ?? 0) });
      usedKeys.add(key);
    }
  }
  while (colors.length + filler.length < swatchCount) {
    filler.push({ ...colors[colors.length - 1] });
  }
  return [...colors, ...filler].slice(0, swatchCount);
}

export function selectPaletteHybrid(imageData, width, height, swatchCount, params = {}) {
  const {
    repulsionRadius = 0.08,
    maxQuantizerPixels = 40000,
    quantizedPoolSize = 24,
    spreadStrength = 0.6,
    rarityStrength = 0.2,
    tone = 0.85,
    neutralBalance = "balanced",
    previousColors = [],
    loyaltyStrength = 0.3,
  } = params;

  const empty = { colors: [], candidates: [], neutralCount: 0, neutralThreshold: 0 };
  if (!imageData || width <= 0 || height <= 0) return empty;

  const packed = packImageDataToArgb8888(imageData, width, height, {
    maxPixels: maxQuantizerPixels,
  });
  if (packed.length === 0) return empty;

  const poolSize = Math.max(swatchCount, quantizedPoolSize);
  // `packed` is a fresh throwaway buffer, so the quantizer may mutate it.
  const quantizer = new ColorCutQuantizer(packed, poolSize);
  const swatches = quantizer.getQuantizedColors?.() ?? [];
  if (swatches.length === 0) return empty;

  const candidates = buildCandidates(swatches);
  if (candidates.length === 0) return empty;

  const totalMass = candidates.reduce((sum, c) => sum + c.mass, 0);
  const neutralThreshold = computeNeutralThreshold(candidates, totalMass);

  const neutralCandidates = candidates.filter((c) => c.c < neutralThreshold);
  const chromaticCandidates = candidates.filter((c) => c.c >= neutralThreshold);

  const neutralFraction = neutralCandidates.reduce((sum, c) => sum + c.mass, 0) / totalMass;
  const maxNeutral = chromaticCandidates.length > 0 ? Math.min(swatchCount - 1, 3) : swatchCount;
  const neutralPolicy = NEUTRAL_POLICIES[neutralBalance] ?? NEUTRAL_POLICIES.balanced;
  const proportionalNeutral = Math.round(swatchCount * neutralFraction * neutralPolicy.slotScale);
  let requestedNeutral = Math.min(proportionalNeutral, maxNeutral);
  if (neutralBalance === "color" && chromaticCandidates.length > 0) {
    requestedNeutral = Math.min(requestedNeutral, 1);
  } else if (neutralBalance === "neutrals" && neutralCandidates.length > 0) {
    requestedNeutral = Math.max(requestedNeutral, Math.min(2, maxNeutral));
  }
  const previousLabs = Array.isArray(previousColors)
    ? previousColors
        .filter((color) => color && Number.isFinite(color.r))
        .map((color) => rgbToOklab(color.r, color.g, color.b))
    : [];

  const minBandMass = Math.max(1, totalMass * neutralPolicy.massFloor);
  const neutralPicks = pickNeutralBands(
    neutralCandidates,
    Math.max(0, requestedNeutral),
    minBandMass,
    previousLabs,
    neutralBalance,
  );

  const chromaticSlots = swatchCount - neutralPicks.length;
  const chromaticPicks = greedySelectChromatic(
    chromaticCandidates,
    chromaticSlots,
    repulsionRadius,
    spreadStrength,
    rarityStrength,
    tone,
    25,
    previousLabs,
    loyaltyStrength,
  );

  const neutralColors = neutralPicks.map((c) => ({
    rgb: c.meanRgb,
    L: c.L,
    population: Math.round(c.bandMass ?? c.mass ?? 0),
  }));
  const chromaticColors = chromaticPicks.map((c) => ({
    rgb: lerpRgb(c.meanRgb, c.vividRgb, tone),
    L: c.L,
    population: Math.round(c.mass ?? 0),
  }));

  const sorted = [...neutralColors, ...chromaticColors].sort((x, y) => x.L - y.L);
  let colors = sorted.map((entry) => ({ ...entry.rgb, population: entry.population }));
  colors = padToCount(colors, [...chromaticCandidates], swatchCount, tone);

  return {
    colors,
    candidates: chromaticCandidates,
    neutralCount: neutralPicks.length,
    neutralThreshold,
  };
}
