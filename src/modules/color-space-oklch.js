/**
 * OKLCH color space conversion utilities.
 *
 * Provides perceptually uniform color representation used for:
 * - Rich color metadata (PaletteColor)
 * - Perceptual palette scoring (hue rarity / diversity)
 * - Semantic swatch classification
 */

import { srgbToLinear } from "./color-math.js";

// ---------------------------------------------------------------------------
// Linear sRGB
// ---------------------------------------------------------------------------

function linearToSrgb(c) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, s * 255)));
}

// ---------------------------------------------------------------------------
// RGB -> OKLab -> OKLCH
// ---------------------------------------------------------------------------

/**
 * RGB -> OKLab (Cartesian L, a, b).
 *
 * Use this for geometry — distance, averaging, clustering — because a and b
 * are signed linear axes (no hue wrap). Derive chroma/hue from it only when
 * you need the semantics (see rgbToOklch).
 *
 * @param {number} r 0-255  @param {number} g 0-255  @param {number} b 0-255
 * @returns {{ L: number, a: number, b: number }}
 */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // Linear sRGB -> LMS (Oklab M1 matrix)
  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // Cube root (LMS -> Lab cone response)
  const l3 = Math.cbrt(l_);
  const m3 = Math.cbrt(m_);
  const s3 = Math.cbrt(s_);

  // LMS cone response -> OKLab
  return {
    L: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    a: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  };
}

/** @param {number} r 0-255  @param {number} g 0-255  @param {number} b 0-255 */
export function rgbToOklch(r, g, b) {
  const { L, a, b: bLab } = rgbToOklab(r, g, b);

  // OKLab -> OKLCH (polar form of the same space)
  const C = Math.sqrt(a * a + bLab * bLab);
  let H = Math.atan2(bLab, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

// ---------------------------------------------------------------------------
// OKLCH -> OKLab -> RGB
// ---------------------------------------------------------------------------

/**
 * OKLab (Cartesian) -> RGB.
 *
 * Blends and centroids of in-gamut colors can land slightly outside the sRGB
 * gamut (the gamut is not convex in OKLab); linearToSrgb clamps per channel,
 * which is accurate enough for those small overshoots.
 *
 * @returns {{ r: number, g: number, b: number }} each 0-255, clamped
 */
export function oklabToRgb(l, a, bLab) {
  const l3 = l + 0.3963377774 * a + 0.2158037573 * bLab;
  const m3 = l - 0.1055613458 * a - 0.0638541728 * bLab;
  const s3 = l - 0.0894841775 * a - 1.291485548 * bLab;

  const l_ = l3 * l3 * l3;
  const m_ = m3 * m3 * m3;
  const s_ = s3 * s3 * s3;

  const lr = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) };
}

/** @returns {[number, number, number]} [r, g, b] each 0-255, clamped */
export function oklchToRgb(l, c, h) {
  const hRad = h * (Math.PI / 180);
  const { r, g, b } = oklabToRgb(l, c * Math.cos(hRad), c * Math.sin(hRad));
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// WCAG relative luminance (sRGB -> linear weighted sum)
// ---------------------------------------------------------------------------

export function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
