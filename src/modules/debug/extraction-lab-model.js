import { rgbToOklab } from "../color-space-oklch.js";

export const PIPELINES = Object.freeze([
  Object.freeze({
    id: "before",
    label: "Legacy sRGB",
    shortLabel: "Legacy",
    selector: "perceptual",
    colorMath: "srgb",
    description: "RGB median-cut with the superseded sRGB centroid, Tone, and smoothing math.",
  }),
  Object.freeze({
    id: "after",
    label: "RGB cut → OKLab",
    shortLabel: "Production",
    selector: "perceptual",
    colorMath: "oklab",
    description: "Current production median-cut candidates with OKLab centroids and color math.",
  }),
  Object.freeze({
    id: "grid",
    label: "Grid · sRGB Tone",
    shortLabel: "Grid RGB",
    selector: "grid",
    toneSpace: "srgb",
    description: "Original direct OKLab grid experiment, retaining its sRGB Tone interpolation.",
  }),
  Object.freeze({
    id: "grid-lab",
    label: "Grid · OKLab Tone",
    shortLabel: "Grid Lab",
    selector: "grid",
    toneSpace: "oklab",
    description: "The same Grid candidates and scoring, with Tone interpolated entirely in OKLab.",
  }),
  Object.freeze({
    id: "grid-hybrid",
    label: "Grid → Production",
    shortLabel: "Hybrid",
    selector: "grid-hybrid",
    colorMath: "oklab",
    description:
      "OKLab grid candidates selected by production neutral logic, scoring, loyalty, and smoothing.",
  }),
]);

export const DEFAULT_LAB_CONFIG = Object.freeze({
  swatchCount: 6,
  poolSize: 24,
  maxPixels: 40000,
  repulsion: 0.075,
  variety: 80,
  tone: 85,
  neutralBalance: "balanced",
  auto: true,
  smooth: true,
});

export const NEUTRAL_BALANCE_VALUES = Object.freeze(["color", "balanced", "neutrals"]);

export const LAB_PRESETS = Object.freeze({
  balanced: Object.freeze({
    label: "Balanced",
    description: "Current app defaults with image-adaptive variety and distinctness.",
    config: DEFAULT_LAB_CONFIG,
  }),
  fast: Object.freeze({
    label: "Fast scan",
    description: "Smaller candidate pool and pixel budget for rapid camera iteration.",
    config: Object.freeze({
      ...DEFAULT_LAB_CONFIG,
      poolSize: 16,
      maxPixels: 12000,
      auto: false,
    }),
  }),
  deep: Object.freeze({
    label: "Deep scan",
    description: "Larger candidate pool and full density for difficult images.",
    config: Object.freeze({
      ...DEFAULT_LAB_CONFIG,
      poolSize: 48,
      maxPixels: 60000,
      auto: false,
    }),
  }),
  soft: Object.freeze({
    label: "Soft tone",
    description: "Pushes representatives toward each cluster centroid.",
    config: Object.freeze({ ...DEFAULT_LAB_CONFIG, tone: 25, auto: false }),
  }),
  vivid: Object.freeze({
    label: "Vivid tone",
    description: "Pushes representatives toward highest-chroma real pixels.",
    config: Object.freeze({
      ...DEFAULT_LAB_CONFIG,
      variety: 100,
      tone: 100,
      auto: false,
    }),
  }),
});

const CONFIG_LIMITS = Object.freeze({
  swatchCount: [2, 12, 1],
  poolSize: [4, 64, 1],
  maxPixels: [2000, 60000, 2000],
  repulsion: [0.02, 0.15, 0.005],
  variety: [0, 100, 1],
  tone: [0, 100, 1],
});

function snap(value, min, max, step) {
  const clamped = Math.max(min, Math.min(max, Number(value)));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Number(snapped.toFixed(step < 1 ? 3 : 0));
}

export function normalizeLabConfig(input = {}) {
  const normalized = {};
  for (const [key, [min, max, step]] of Object.entries(CONFIG_LIMITS)) {
    normalized[key] = snap(input[key] ?? DEFAULT_LAB_CONFIG[key], min, max, step);
  }
  normalized.neutralBalance = NEUTRAL_BALANCE_VALUES.includes(input.neutralBalance)
    ? input.neutralBalance
    : DEFAULT_LAB_CONFIG.neutralBalance;
  normalized.auto = input.auto == null ? DEFAULT_LAB_CONFIG.auto : Boolean(input.auto);
  normalized.smooth = input.smooth == null ? DEFAULT_LAB_CONFIG.smooth : Boolean(input.smooth);
  return normalized;
}

export function labConfigFromSearchParams(searchParams) {
  const input = {};
  for (const key of Object.keys(CONFIG_LIMITS)) {
    if (searchParams.has(key)) input[key] = searchParams.get(key);
  }
  if (searchParams.has("neutralBalance")) {
    input.neutralBalance = searchParams.get("neutralBalance");
  }
  if (searchParams.has("auto")) input.auto = searchParams.get("auto") === "1";
  if (searchParams.has("smooth")) input.smooth = searchParams.get("smooth") === "1";
  return normalizeLabConfig(input);
}

export function writeLabConfigToSearchParams(config, searchParams = new URLSearchParams()) {
  const normalized = normalizeLabConfig(config);
  for (const key of Object.keys(CONFIG_LIMITS)) {
    searchParams.set(key, String(normalized[key]));
  }
  searchParams.set("neutralBalance", normalized.neutralBalance);
  searchParams.set("auto", normalized.auto ? "1" : "0");
  searchParams.set("smooth", normalized.smooth ? "1" : "0");
  return searchParams;
}

export function deltaEok(firstRgb, secondRgb) {
  const first = rgbToOklab(firstRgb.r, firstRgb.g, firstRgb.b);
  const second = rgbToOklab(secondRgb.r, secondRgb.g, secondRgb.b);
  return Math.hypot(first.L - second.L, first.a - second.a, first.b - second.b);
}

/**
 * Reorders a candidate palette so each row is the nearest unused match to the
 * production reference. This keeps side-by-side comparisons meaningful even
 * when two selectors return the same colors in a different order.
 */
export function alignPaletteToReference(reference, candidate) {
  if (reference.length === 0 || candidate.length === 0) return candidate.slice();
  const pairs = [];
  for (let refIndex = 0; refIndex < reference.length; refIndex++) {
    for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex++) {
      pairs.push({
        refIndex,
        candidateIndex,
        distance: deltaEok(reference[refIndex].rgb, candidate[candidateIndex].rgb),
      });
    }
  }
  pairs.sort((left, right) => left.distance - right.distance);

  const aligned = new Array(reference.length).fill(null);
  const usedReference = new Set();
  const usedCandidates = new Set();
  for (const { refIndex, candidateIndex } of pairs) {
    if (usedReference.has(refIndex) || usedCandidates.has(candidateIndex)) continue;
    aligned[refIndex] = candidate[candidateIndex];
    usedReference.add(refIndex);
    usedCandidates.add(candidateIndex);
  }

  for (let index = 0; index < candidate.length; index++) {
    if (!usedCandidates.has(index)) aligned.push(candidate[index]);
  }
  return aligned;
}
