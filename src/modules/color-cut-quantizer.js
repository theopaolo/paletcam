import { oklabToRgb, rgbToOklab } from "./color-space-oklch.js";

/**
 * ColorCutQuantizer — median-cut color quantization.
 *
 * - Quantizes RGB into 5 bits/channel (32 levels each) => 32^3 = 32768 bins
 * - Builds a histogram of bins
 * - If distinct colors <= maxColors => return them
 * - Else: splits color-space "boxes" (Vboxes) by volume until maxColors
 * - Returns each box's population-weighted OKLab centroid (the boxes are cut
 *   in RGB for speed/stability; averaging in gamma sRGB would darken/gray
 *   the mean, so only the centroid is perceptual)
 *
 * Each Swatch also carries a `vividRgb` exemplar — the highest-chroma
 * quantized color in the box (expanded to 8-bit). Consumers that want the
 * "mean" use `rgb`; consumers that want the "vivid peak" use `vividRgb`.
 * The two are identical when a box contains a single distinct color.
 */

/** ----- Bit packing constants ----- */
const QUANTIZE_WORD_WIDTH = 5;
const QUANTIZE_WORD_MASK = (1 << QUANTIZE_WORD_WIDTH) - 1; // 31

const COMPONENT_RED = -3;
const COMPONENT_GREEN = -2;
const COMPONENT_BLUE = -1;

/** ----- RGB helpers (Android-like ints) ----- */
function red888(rgb) {
  return (rgb >> 16) & 0xff;
}
function green888(rgb) {
  return (rgb >> 8) & 0xff;
}
function blue888(rgb) {
  return rgb & 0xff;
}

function rgb888(r, g, b) {
  // return 0xFFRRGGBB
  return (0xff << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** ----- Word-width conversion (same logic as Android) ----- */
function modifyWordWidth(value, currentWidth, targetWidth) {
  let newValue;
  if (targetWidth > currentWidth) newValue = value << (targetWidth - currentWidth);
  else newValue = value >> (currentWidth - targetWidth);
  return newValue & ((1 << targetWidth) - 1);
}

/** ----- Quantize 8-bit/channel -> 5-bit/channel packed int ----- */
function quantizeFromRgb888(color888) {
  const r = modifyWordWidth(red888(color888), 8, QUANTIZE_WORD_WIDTH);
  const g = modifyWordWidth(green888(color888), 8, QUANTIZE_WORD_WIDTH);
  const b = modifyWordWidth(blue888(color888), 8, QUANTIZE_WORD_WIDTH);
  return (r << (QUANTIZE_WORD_WIDTH * 2)) | (g << QUANTIZE_WORD_WIDTH) | b; // 15 bits
}

/** ----- Approximate 5-bit/channel -> 8-bit/channel (expand) ----- */
function approximateToRgb888FromQuant(colorQ) {
  return approximateToRgb888(quantizedRed(colorQ), quantizedGreen(colorQ), quantizedBlue(colorQ));
}

function approximateToRgb888(r5, g5, b5) {
  const r8 = modifyWordWidth(r5, QUANTIZE_WORD_WIDTH, 8);
  const g8 = modifyWordWidth(g5, QUANTIZE_WORD_WIDTH, 8);
  const b8 = modifyWordWidth(b5, QUANTIZE_WORD_WIDTH, 8);
  return rgb888(r8, g8, b8);
}

function quantizedRed(colorQ) {
  return (colorQ >> (QUANTIZE_WORD_WIDTH * 2)) & QUANTIZE_WORD_MASK;
}
function quantizedGreen(colorQ) {
  return (colorQ >> QUANTIZE_WORD_WIDTH) & QUANTIZE_WORD_MASK;
}
function quantizedBlue(colorQ) {
  return colorQ & QUANTIZE_WORD_MASK;
}

/**
 * Modify "significant octet" trick:
 * Repack bits so sorting by integer sorts primarily by chosen component.
 * - RED: RGB (already)
 * - GREEN: GRB
 * - BLUE: BGR
 *
 * Called twice around sort to "swap" and then swap back.
 */
function modifySignificantOctet(a, dimension, lower, upper) {
  if (dimension === COMPONENT_RED) return;

  for (let i = lower; i <= upper; i++) {
    const color = a[i];
    if (dimension === COMPONENT_GREEN) {
      a[i] =
        (quantizedGreen(color) << (QUANTIZE_WORD_WIDTH * 2)) |
        (quantizedRed(color) << QUANTIZE_WORD_WIDTH) |
        quantizedBlue(color);
    } else if (dimension === COMPONENT_BLUE) {
      a[i] =
        (quantizedBlue(color) << (QUANTIZE_WORD_WIDTH * 2)) |
        (quantizedGreen(color) << QUANTIZE_WORD_WIDTH) |
        quantizedRed(color);
    }
  }
}

/** ----- Tiny Swatch object (rgb + population + vivid exemplar) ----- */
class Swatch {
  constructor(rgb, population, vividRgb) {
    this.rgb = rgb; // 0xFFRRGGBB — population-weighted OKLab centroid of the box
    this.population = population;
    this.vividRgb = vividRgb ?? rgb;
  }
}

/**
 * OKLab coordinates of a 5-bit quantized color, expanded to 8-bit first.
 *
 * OKLab is a pure function of the 15-bit code, and live extraction touches
 * every distinct color on every frame, so L/a/b are cached interleaved in a
 * lazily-filled lookup table (NaN marks unset entries — L is 0 for black, so
 * a sign sentinel would not work).
 *
 * Returns the base index of the entry; read L/a/b at base, base+1, base+2.
 */
let labLut = null;

function quantizedLabIndex(colorQ) {
  if (labLut === null) {
    labLut = new Float32Array((1 << (QUANTIZE_WORD_WIDTH * 3)) * 3).fill(NaN);
  }

  const base = colorQ * 3;
  if (Number.isNaN(labLut[base])) {
    const rgb888 = approximateToRgb888FromQuant(colorQ);
    const lab = rgbToOklab(red888(rgb888), green888(rgb888), blue888(rgb888));
    labLut[base] = lab.L;
    labLut[base + 1] = lab.a;
    labLut[base + 2] = lab.b;
  }
  return base;
}

// Shared histogram buffer: the quantizer only reads it during construction,
// so reusing one buffer per realm avoids a 128KB allocation per extraction.
let sharedHistogram = null;

export class ColorCutQuantizer {
  constructor(pixelsRgb888, maxColors, { centroidSpace = "oklab" } = {}) {
    this.centroidSpace = centroidSpace;
    // 32^3 = 32768 bins
    if (sharedHistogram === null) {
      sharedHistogram = new Int32Array(1 << (QUANTIZE_WORD_WIDTH * 3));
    } else {
      sharedHistogram.fill(0);
    }
    this.histogram = sharedHistogram;
    const hist = this.histogram;

    // Quantize each pixel into histogram bins
    for (let i = 0; i < pixelsRgb888.length; i++) {
      const q = quantizeFromRgb888(pixelsRgb888[i]);
      pixelsRgb888[i] = q; // overwrite with quantized value
      hist[q] += 1;
    }

    // Count distinct colors
    let distinctCount = 0;
    for (let c = 0; c < hist.length; c++) {
      if (hist[c] > 0) distinctCount++;
    }

    // Build list of distinct colors
    this.colors = new Int32Array(distinctCount);
    let idx = 0;
    for (let c = 0; c < hist.length; c++) {
      if (hist[c] > 0) this.colors[idx++] = c;
    }

    // If already under limit, just return those bins as swatches
    if (distinctCount <= maxColors) {
      this.quantizedColors = [];
      for (let i = 0; i < this.colors.length; i++) {
        const c = this.colors[i];
        this.quantizedColors.push(new Swatch(approximateToRgb888FromQuant(c), hist[c]));
      }
    } else {
      this.quantizedColors = this.quantizePixels(maxColors);
    }
  }

  getQuantizedColors() {
    return this.quantizedColors;
  }

  quantizePixels(maxColors) {
    // Priority queue by volume (descending)
    const pq = new MaxHeap((a, b) => a.getVolume() - b.getVolume());
    pq.push(new Vbox(this, 0, this.colors.length - 1));

    this.splitBoxes(pq, maxColors);
    return this.generateAverageColors(pq.toArray());
  }

  splitBoxes(heap, maxSize) {
    while (heap.size() < maxSize) {
      const vbox = heap.pop();
      if (vbox?.canSplit()) {
        heap.push(vbox.splitBox());
        heap.push(vbox);
      } else {
        return;
      }
    }
  }

  generateAverageColors(vboxes) {
    return vboxes.map((vbox) => vbox.getAverageColor());
  }
}

/** ----- Vbox: a box in quantized color space ----- */
class Vbox {
  constructor(quantizer, lowerIndex, upperIndex) {
    this.q = quantizer;
    this.lower = lowerIndex;
    this.upper = upperIndex;
    this.fitBox();
  }

  getColorCount() {
    return 1 + this.upper - this.lower;
  }

  canSplit() {
    return this.getColorCount() > 1;
  }

  getVolume() {
    return (this.maxR - this.minR + 1) * (this.maxG - this.minG + 1) * (this.maxB - this.minB + 1);
  }

  fitBox() {
    const colors = this.q.colors;
    const hist = this.q.histogram;

    let minR = Infinity,
      minG = Infinity,
      minB = Infinity;
    let maxR = -Infinity,
      maxG = -Infinity,
      maxB = -Infinity;
    let pop = 0;

    for (let i = this.lower; i <= this.upper; i++) {
      const c = colors[i];
      pop += hist[c];

      const r = quantizedRed(c);
      const g = quantizedGreen(c);
      const b = quantizedBlue(c);

      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }

    this.minR = minR;
    this.maxR = maxR;
    this.minG = minG;
    this.maxG = maxG;
    this.minB = minB;
    this.maxB = maxB;
    this.population = pop;
  }

  splitBox() {
    if (!this.canSplit()) throw new Error("Cannot split a box with only 1 color");

    const splitPoint = this.findSplitPoint();
    const newBox = new Vbox(this.q, splitPoint + 1, this.upper);

    this.upper = splitPoint;
    this.fitBox();

    return newBox;
  }

  getLongestColorDimension() {
    const rLen = this.maxR - this.minR;
    const gLen = this.maxG - this.minG;
    const bLen = this.maxB - this.minB;

    if (rLen >= gLen && rLen >= bLen) return COMPONENT_RED;
    if (gLen >= rLen && gLen >= bLen) return COMPONENT_GREEN;
    return COMPONENT_BLUE;
  }

  findSplitPoint() {
    const longest = this.getLongestColorDimension();
    const colors = this.q.colors;
    const hist = this.q.histogram;

    // Repack so sort prioritizes the chosen component
    modifySignificantOctet(colors, longest, this.lower, this.upper);

    // Sort subrange in place — TypedArray#sort is numeric ascending by default.
    colors.subarray(this.lower, this.upper + 1).sort();

    // Revert packing back to RGB
    modifySignificantOctet(colors, longest, this.lower, this.upper);

    const midPop = Math.floor(this.population / 2);
    let count = 0;
    for (let i = this.lower; i <= this.upper; i++) {
      count += hist[colors[i]];
      if (count >= midPop) {
        return Math.min(this.upper - 1, i);
      }
    }
    return this.lower;
  }

  getAverageColor() {
    const colors = this.q.colors;
    const hist = this.q.histogram;

    let lSum = 0,
      aSum = 0,
      bSum = 0,
      rSum = 0,
      gSum = 0,
      b8Sum = 0;
    let total = 0;
    let bestQ = -1;
    let bestChroma = -1;

    for (let i = this.lower; i <= this.upper; i++) {
      const c = colors[i];
      const pop = hist[c];
      total += pop;

      const base = quantizedLabIndex(c);
      lSum += pop * labLut[base];
      aSum += pop * labLut[base + 1];
      bSum += pop * labLut[base + 2];

      // Kept solely for the debug harness' faithful “before” comparison.
      // Production uses the default OKLab centroid.
      if (this.q.centroidSpace === "srgb") {
        rSum += pop * quantizedRed(c);
        gSum += pop * quantizedGreen(c);
        b8Sum += pop * quantizedBlue(c);
      }

      const chroma = Math.hypot(labLut[base + 1], labLut[base + 2]);
      if (chroma > bestChroma) {
        bestChroma = chroma;
        bestQ = c;
      }
    }

    const vividRgb = bestQ >= 0 ? approximateToRgb888FromQuant(bestQ) : undefined;
    if (this.q.centroidSpace === "srgb") {
      return new Swatch(
        approximateToRgb888(
          Math.round(rSum / total),
          Math.round(gSum / total),
          Math.round(b8Sum / total),
        ),
        total,
        vividRgb,
      );
    }

    const { r, g, b } = oklabToRgb(lSum / total, aSum / total, bSum / total);
    return new Swatch(rgb888(r, g, b), total, vividRgb);
  }
}

/** ----- Minimal max-heap (priority queue) ----- */
class MaxHeap {
  constructor(scoreFn) {
    this.scoreFn = scoreFn; // larger score => higher priority
    this.data = [];
  }
  size() {
    return this.data.length;
  }
  toArray() {
    return this.data.slice();
  }

  push(item) {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    const n = this.data.length;
    if (n === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (n > 1) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(i) {
    const { data, scoreFn } = this;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (scoreFn(data[i], data[p]) <= 0) break;
      [data[i], data[p]] = [data[p], data[i]];
      i = p;
    }
  }

  sinkDown(i) {
    const { data, scoreFn } = this;
    const n = data.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let best = i;

      if (l < n && scoreFn(data[l], data[best]) > 0) best = l;
      if (r < n && scoreFn(data[r], data[best]) > 0) best = r;
      if (best === i) break;

      [data[i], data[best]] = [data[best], data[i]];
      i = best;
    }
  }
}
