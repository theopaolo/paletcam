/**
 * OKLCH color space conversion utilities.
 *
 * Provides perceptually uniform color representation used for:
 * - OKLCH-space quantization (median-cut in L/C/H instead of R/G/B)
 * - Rich color metadata (PaletteColor)
 * - Semantic swatch classification
 */

// ---------------------------------------------------------------------------
// sRGB <-> Linear
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, s * 255)));
}

// ---------------------------------------------------------------------------
// RGB -> OKLab -> OKLCH
// ---------------------------------------------------------------------------

/** @param {number} r 0-255  @param {number} g 0-255  @param {number} b 0-255 */
export function rgbToOklch(r, g, b) {
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
  const L = 0.2104542553 * l3 + 0.7936177850 * m3 - 0.0040720468 * s3;
  const a = 1.9779984951 * l3 - 2.4285922050 * m3 + 0.4505937099 * s3;
  const bLab = 0.0259040371 * l3 + 0.7827717662 * m3 - 0.8086757660 * s3;

  // OKLab -> OKLCH
  const C = Math.sqrt(a * a + bLab * bLab);
  let H = Math.atan2(bLab, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

// ---------------------------------------------------------------------------
// OKLCH -> OKLab -> RGB
// ---------------------------------------------------------------------------

/** @returns {[number, number, number]} [r, g, b] each 0-255, clamped */
export function oklchToRgb(l, c, h) {
  const hRad = h * (Math.PI / 180);
  const a = c * Math.cos(hRad);
  const bLab = c * Math.sin(hRad);

  const l3 = l + 0.3963377774 * a + 0.2158037573 * bLab;
  const m3 = l - 0.1055613458 * a - 0.0638541728 * bLab;
  const s3 = l - 0.0894841775 * a - 1.2914855480 * bLab;

  const l_ = l3 * l3 * l3;
  const m_ = m3 * m3 * m3;
  const s_ = s3 * s3 * s3;

  const lr = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
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

// ---------------------------------------------------------------------------
// HSL (for PaletteColor — standalone, avoids circular dep with palette-scoring)
// ---------------------------------------------------------------------------

export function rgbToHsl(r, g, b) {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (min !== max) {
    const delta = max - min;
    s = delta / (1 - Math.abs(2 * l - 1));

    if (max === rN) h = ((gN - bN) / delta) % 6;
    else if (max === gN) h = (bN - rN) / delta + 2;
    else h = (rN - gN) / delta + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

// ---------------------------------------------------------------------------
// Batch helpers for OKLCH quantization pipeline
// ---------------------------------------------------------------------------

const MAX_CHROMA = 0.4;

/**
 * Convert RGBA imageData pixels to OKLCH, scaled to 0-255 and packed as
 * ARGB8888 ints — ready for ColorCutQuantizer.
 *
 * Scaling: L(0-1)->0-255, C(0-0.4)->0-255, H(0-360)->0-255
 *
 * @param {Uint8ClampedArray} imageData
 * @param {number} width
 * @param {number} height
 * @param {number} stride  pixel stride (1 = every pixel)
 * @returns {Int32Array}
 */
export function packImageDataToOklchArgb(imageData, width, height, stride) {
  const estimatedCount = Math.ceil(width / stride) * Math.ceil(height / stride);
  const packed = new Int32Array(estimatedCount);
  let writeIndex = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const alpha = imageData[i + 3];
      if (alpha === 0) continue;

      const { l, c, h } = rgbToOklch(imageData[i], imageData[i + 1], imageData[i + 2]);
      const lScaled = Math.round(l * 255);
      const cScaled = Math.round((c / MAX_CHROMA) * 255);
      const hScaled = Math.round((h / 360) * 255);

      packed[writeIndex++] =
        (0xff << 24) |
        ((lScaled & 0xff) << 16) |
        ((cScaled & 0xff) << 8) |
        (hScaled & 0xff);
    }
  }

  return packed.subarray(0, writeIndex);
}

/**
 * Convert a swatch whose .rgb stores packed scaled-OKLCH back to real RGB.
 * @param {number} packedOklch  ARGB8888 with L/C/H in R/G/B positions
 * @returns {{ r: number, g: number, b: number }}
 */
export function swatchOklchToRgb(packedOklch) {
  const lScaled = (packedOklch >>> 16) & 0xff;
  const cScaled = (packedOklch >>> 8) & 0xff;
  const hScaled = packedOklch & 0xff;

  const l = lScaled / 255;
  const c = (cScaled / 255) * MAX_CHROMA;
  const h = (hScaled / 255) * 360;

  const [r, g, b] = oklchToRgb(l, c, h);
  return { r, g, b };
}
