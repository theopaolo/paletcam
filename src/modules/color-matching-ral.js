/**
 * RAL Classic color matching using CIEDE2000 (Delta-E 2000).
 *
 * Provides perceptually accurate nearest-color matching against the full
 * RAL Classic palette — the industry standard for architecture, coatings,
 * interior design, and print specification.
 *
 * Also includes a point-sampling utility for precise single-color capture.
 */

import { RAL_CLASSIC } from './ral-classic-data.js';

// ---------------------------------------------------------------------------
// sRGB -> CIELAB (D65 / 2° observer)
// ---------------------------------------------------------------------------

// D65 reference white point
const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  return [
    0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
    0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb,
    0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb,
  ];
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116;
}

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);

  return [
    116 * fy - 16,   // L*
    500 * (fx - fy),  // a*
    200 * (fy - fz),  // b*
  ];
}

// ---------------------------------------------------------------------------
// CIEDE2000 (Delta-E 2000)
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const POW25_7 = 25 ** 7; // 6103515625

/**
 * Compute the CIEDE2000 color difference between two CIELAB colors.
 * Lower values = more similar. 0 = identical.
 *
 * Perceptual interpretation:
 *   0-1    : imperceptible
 *   1-2    : perceptible through close observation
 *   2-5    : noticeable at a glance
 *   5-10   : clearly different colors
 *   10+    : completely different colors
 *
 * @param {number[]} lab1  [L*, a*, b*]
 * @param {number[]} lab2  [L*, a*, b*]
 * @returns {number}
 */
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  // Step 1: Calculate C'ab, h'ab
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cab = (C1 + C2) / 2;
  const Cab7 = Cab ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + POW25_7)));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  let h1p = Math.atan2(b1, a1p) * DEG;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * DEG;
  if (h2p < 0) h2p += 360;

  // Step 2: Calculate dL', dC', dH'
  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  // Step 3: Calculate CIEDE2000 weighting functions
  const Lp = (L1 + L2) / 2;
  const Cp = (C1p + C2p) / 2;

  let hp;
  if (C1p * C2p === 0) {
    hp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hp = (h1p + h2p + 360) / 2;
  } else {
    hp = (h1p + h2p - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos((hp - 30) * RAD)
    + 0.24 * Math.cos(2 * hp * RAD)
    + 0.32 * Math.cos((3 * hp + 6) * RAD)
    - 0.20 * Math.cos((4 * hp - 63) * RAD);

  const Lp50sq = (Lp - 50) * (Lp - 50);
  const SL = 1 + 0.015 * Lp50sq / Math.sqrt(20 + Lp50sq);
  const SC = 1 + 0.045 * Cp;
  const SH = 1 + 0.015 * Cp * T;

  const Cp7 = Cp ** 7;
  const RC = 2 * Math.sqrt(Cp7 / (Cp7 + POW25_7));
  const dTheta = 30 * Math.exp(-((hp - 275) / 25) * ((hp - 275) / 25));
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  return Math.sqrt(
    (dLp / SL) * (dLp / SL) +
    (dCp / SC) * (dCp / SC) +
    (dHp / SH) * (dHp / SH) +
    RT * (dCp / SC) * (dHp / SH)
  );
}

// ---------------------------------------------------------------------------
// Pre-computed LAB values for RAL Classic (computed once at module load)
// ---------------------------------------------------------------------------

const RAL_LAB_CACHE = RAL_CLASSIC.map((ral) => rgbToLab(ral.r, ral.g, ral.b));

// ---------------------------------------------------------------------------
// Point sampling
// ---------------------------------------------------------------------------

export const DEFAULT_SAMPLE_RADIUS = 4;

/**
 * Sample a single color from imageData at a given point, averaging a square
 * block around (x, y) for noise reduction. Use this for precise "eyedropper"
 * or focus-point color capture.
 *
 * @param {Uint8ClampedArray} imageData  RGBA pixel data
 * @param {number} width   image width in pixels
 * @param {number} height  image height in pixels
 * @param {number} x       center X coordinate
 * @param {number} y       center Y coordinate
 * @param {number} [radius=4]  sample radius (block is (2r+1) x (2r+1) pixels)
 * @returns {{ r: number, g: number, b: number }}
 */
export function sampleColorAtPoint(imageData, width, height, x, y, radius = DEFAULT_SAMPLE_RADIUS) {
  const cx = Math.round(Math.max(0, Math.min(width - 1, x)));
  const cy = Math.round(Math.max(0, Math.min(height - 1, y)));

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let oy = -radius; oy <= radius; oy++) {
    const py = cy + oy;
    if (py < 0 || py >= height) continue;

    for (let ox = -radius; ox <= radius; ox++) {
      const px = cx + ox;
      if (px < 0 || px >= width) continue;

      const i = (py * width + px) * 4;
      // Skip fully transparent pixels
      if (imageData[i + 3] === 0) continue;

      totalR += imageData[i];
      totalG += imageData[i + 1];
      totalB += imageData[i + 2];
      count++;
    }
  }

  if (count === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  };
}

// ---------------------------------------------------------------------------
// RAL matching
// ---------------------------------------------------------------------------

/**
 * Find the closest RAL Classic colors to a given RGB color.
 *
 * Uses CIEDE2000 for perceptually accurate matching — the same formula
 * used by professional colorimeters and paint-matching systems.
 *
 * @param {number} r  0-255
 * @param {number} g  0-255
 * @param {number} b  0-255
 * @param {number} [count=3]  number of closest matches to return
 * @returns {RalMatch[]}  sorted by deltaE ascending (best match first)
 */
export function findClosestRAL(r, g, b, count = 3) {
  const inputLab = rgbToLab(r, g, b);
  const boundedCount = Math.max(1, Math.min(count, RAL_CLASSIC.length));

  const results = [];
  for (let i = 0; i < RAL_CLASSIC.length; i++) {
    results.push({
      ral: RAL_CLASSIC[i],
      deltaE: deltaE2000(inputLab, RAL_LAB_CACHE[i]),
    });
  }

  results.sort((a, b) => a.deltaE - b.deltaE);
  return results.slice(0, boundedCount);
}

/**
 * Find the closest RAL Classic colors for each color in a palette.
 *
 * @param {Array<{ r: number, g: number, b: number }>} colors
 * @param {number} [matchesPerColor=3]
 * @returns {Array<{ color: { r, g, b }, matches: RalMatch[] }>}
 */
export function matchPaletteToRAL(colors, matchesPerColor = 3) {
  return colors.map((color) => ({
    color: { r: color.r, g: color.g, b: color.b },
    matches: findClosestRAL(color.r, color.g, color.b, matchesPerColor),
  }));
}

// Re-export for convenience
export { RAL_CLASSIC } from './ral-classic-data.js';

/**
 * Human-readable quality label for a RAL match delta-E distance.
 * @param {number} deltaE
 * @returns {string}
 */
export function getRalQualityLabel(deltaE) {
  if (!Number.isFinite(deltaE)) {
    return '';
  }

  if (deltaE <= 2) {
    return 'Très proche';
  }

  if (deltaE <= 5) {
    return 'Proche';
  }

  if (deltaE <= 10) {
    return 'Bonne piste';
  }

  return 'Approximation';
}
