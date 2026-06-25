/**
 * Shared low-level color math for the extraction and scoring pipeline.
 *
 * Pure functions with no imports, so any color module can depend on this
 * without risking a circular import.
 */

/**
 * sRGB 0-255 channel -> linear-light 0-1.
 * @param {number} channel  0-255
 * @returns {number} 0-1
 */
export function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * RGB (0-255) -> HSL with h in [0, 360), s and l in [0, 1].
 * @param {number} r  0-255
 * @param {number} g  0-255
 * @param {number} b  0-255
 * @returns {{ h: number, s: number, l: number }}
 */
export function rgbToHsl(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (min !== max) {
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

/**
 * Squared Euclidean distance between two { r, g, b } colors.
 * @param {{ r: number, g: number, b: number }} first
 * @param {{ r: number, g: number, b: number }} second
 * @returns {number}
 */
export function rgbDistanceSquared(first, second) {
  const deltaR = first.r - second.r;
  const deltaG = first.g - second.g;
  const deltaB = first.b - second.b;

  return (deltaR * deltaR) + (deltaG * deltaG) + (deltaB * deltaB);
}

/**
 * Euclidean distance between two { r, g, b } colors.
 * @param {{ r: number, g: number, b: number }} first
 * @param {{ r: number, g: number, b: number }} second
 * @returns {number}
 */
export function rgbDistance(first, second) {
  return Math.sqrt(rgbDistanceSquared(first, second));
}
