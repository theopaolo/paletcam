import { linearToSrgb, srgbToLinear } from "./color-math.js";

/* A patch has to be lit and not blown out to say anything about the light. A
   channel that needs more than MAX_GAIN to reach gray was a color, not a
   white or a gray. */
const MIN_PATCH_LUMINANCE = 0.02;
const MAX_PATCH_CHANNEL = 0.99;
const MAX_GAIN = 2.5;

/**
 * Per-channel gains that turn the patch gray at its own luminance, applied in
 * linear light (von Kries on sRGB primaries). Null when the patch is too dark,
 * blown out, or too colorful to be a neutral.
 * @param {Uint8ClampedArray} pixels RGBA
 * @returns {[number, number, number] | null}
 */
export function measureNeutralGains(pixels) {
  const count = Math.floor(pixels.length / 4);
  if (count < 1) {
    return null;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  for (let index = 0; index < count * 4; index += 4) {
    r += srgbToLinear(pixels[index]);
    g += srgbToLinear(pixels[index + 1]);
    b += srgbToLinear(pixels[index + 2]);
  }
  r /= count;
  g /= count;
  b /= count;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < MIN_PATCH_LUMINANCE || Math.max(r, g, b) > MAX_PATCH_CHANNEL) {
    return null;
  }

  /** @type {[number, number, number]} */
  const gains = [luminance / r, luminance / g, luminance / b];
  return gains.every((gain) => gain <= MAX_GAIN && gain >= 1 / MAX_GAIN) ? gains : null;
}

/**
 * A 768-byte table, 256 entries per channel in r, g, b order: an sRGB byte in,
 * the white-balanced sRGB byte out. Small enough to send with every worker
 * request, and three lookups per pixel to apply.
 * @param {[number, number, number]} gains
 * @returns {Uint8Array}
 */
export function createWhiteBalanceLut(gains) {
  const lut = new Uint8Array(768);
  for (let channel = 0; channel < 3; channel += 1) {
    for (let value = 0; value < 256; value += 1) {
      lut[channel * 256 + value] = linearToSrgb(srgbToLinear(value) * gains[channel]);
    }
  }
  return lut;
}

/**
 * Balances RGBA pixels in place.
 * @param {Uint8ClampedArray} pixels
 * @param {Uint8Array} lut from createWhiteBalanceLut
 */
export function applyWhiteBalanceLut(pixels, lut) {
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = lut[pixels[index]];
    pixels[index + 1] = lut[256 + pixels[index + 1]];
    pixels[index + 2] = lut[512 + pixels[index + 2]];
  }
}

/**
 * @template {{ r: number, g: number, b: number }} T
 * @param {T} color 0-255 channels
 * @param {Uint8Array} lut from createWhiteBalanceLut
 * @returns {T}
 */
export function balanceColor(color, lut) {
  return {
    ...color,
    r: lut[Math.round(color.r)],
    g: lut[256 + Math.round(color.g)],
    b: lut[512 + Math.round(color.b)],
  };
}
