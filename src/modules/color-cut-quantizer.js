/**
 * ColorCutQuantizer (JS port of AndroidX Palette's ColorCutQuantizer.java)
 *
 * - Quantizes RGB into 5 bits/channel (32 levels each) => 32^3 = 32768 bins
 * - Builds a histogram of bins
 * - If distinct colors <= maxColors => return them
 * - Else: splits color-space "boxes" (Vboxes) by volume until maxColors
 * - Returns average color of each box weighted by histogram population
 *
 * Notes:
 * - Android version supports filters using HSL; here it's optional.
 * - This is focused on correctness + clarity; you can micro-opt later.
 */

/** ----- Bit packing constants (same as Android) ----- */
const QUANTIZE_WORD_WIDTH = 5;
const QUANTIZE_WORD_MASK = (1 << QUANTIZE_WORD_WIDTH) - 1; // 31

const COMPONENT_RED = -3;
const COMPONENT_GREEN = -2;
const COMPONENT_BLUE = -1;

/** ----- RGB helpers (Android-like ints) ----- */
function red888(rgb)   { return (rgb >> 16) & 0xff; }
function green888(rgb) { return (rgb >> 8) & 0xff; }
function blue888(rgb)  { return rgb & 0xff; }

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
  return approximateToRgb888(
    quantizedRed(colorQ),
    quantizedGreen(colorQ),
    quantizedBlue(colorQ)
  );
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

/** ----- Tiny Swatch object like Palette.Swatch ----- */
class Swatch {
  constructor(rgb, population) {
    this.rgb = rgb; // 0xFFRRGGBB
    this.population = population;
  }
}

/**
 * Optional filter shape:
 * filter.isAllowed(rgb888, hslArray) => boolean
 * You can omit filters or pass [].
 */
export class ColorCutQuantizer {
  constructor(pixelsRgb888, maxColors, filters = null) {
    this.filters = filters;

    // 32^3 = 32768 bins
    this.histogram = new Int32Array(1 << (QUANTIZE_WORD_WIDTH * 3));
    const hist = this.histogram;

    // Quantize each pixel into histogram bins
    for (let i = 0; i < pixelsRgb888.length; i++) {
      const q = quantizeFromRgb888(pixelsRgb888[i]);
      pixelsRgb888[i] = q;       // same as Android: overwrite
      hist[q] += 1;
    }

    // Count distinct colors (after optional filtering)
    let distinctCount = 0;
    for (let c = 0; c < hist.length; c++) {
      if (hist[c] > 0 && this.shouldIgnoreQuantColor(c)) {
        hist[c] = 0;
      }
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
    const out = [];
    for (const v of vboxes) {
      const sw = v.getAverageColor();
      if (!this.shouldIgnoreSwatch(sw)) out.push(sw);
    }
    return out;
  }

  shouldIgnoreQuantColor(colorQ) {
    if (!this.filters || this.filters.length === 0) return false;
    const rgb = approximateToRgb888FromQuant(colorQ);
    const hsl = rgbToHsl(rgb);
    for (const f of this.filters) {
      if (!f.isAllowed(rgb, hsl)) return true;
    }
    return false;
  }

  shouldIgnoreSwatch(swatch) {
    if (!this.filters || this.filters.length === 0) return false;
    const hsl = rgbToHsl(swatch.rgb);
    for (const f of this.filters) {
      if (!f.isAllowed(swatch.rgb, hsl)) return true;
    }
    return false;
  }
}

/** ----- Vbox (inner class in Android) ----- */
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
    return (
      (this.maxR - this.minR + 1) *
      (this.maxG - this.minG + 1) *
      (this.maxB - this.minB + 1)
    );
  }

  fitBox() {
    const colors = this.q.colors;
    const hist = this.q.histogram;

    let minR = Infinity, minG = Infinity, minB = Infinity;
    let maxR = -Infinity, maxG = -Infinity, maxB = -Infinity;
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

    this.minR = minR; this.maxR = maxR;
    this.minG = minG; this.maxG = maxG;
    this.minB = minB; this.maxB = maxB;
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

    // Sort subrange (numeric ascending)
    // NOTE: Int32Array doesn't have built-in range sort; convert slice for this range.
    // For speed later, you can keep colors as a normal Array and use in-place sort.
    const tmp = Array.from(colors.slice(this.lower, this.upper + 1));
    tmp.sort((a, b) => a - b);
    colors.set(tmp, this.lower);

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

    let rSum = 0, gSum = 0, bSum = 0;
    let total = 0;

    for (let i = this.lower; i <= this.upper; i++) {
      const c = colors[i];
      const pop = hist[c];
      total += pop;

      rSum += pop * quantizedRed(c);
      gSum += pop * quantizedGreen(c);
      bSum += pop * quantizedBlue(c);
    }

    const rMean = Math.round(rSum / total);
    const gMean = Math.round(gSum / total);
    const bMean = Math.round(bSum / total);

    return new Swatch(approximateToRgb888(rMean, gMean, bMean), total);
  }
}

/** ----- Minimal max-heap (priority queue) ----- */
class MaxHeap {
  constructor(scoreFn) {
    this.scoreFn = scoreFn; // larger score => higher priority
    this.data = [];
  }
  size() { return this.data.length; }
  toArray() { return this.data.slice(); }

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

/** ----- RGB->HSL (for optional filtering) ----- */
function rgbToHsl(rgb) {
  const r = red888(rgb) / 255;
  const g = green888(rgb) / 255;
  const b = blue888(rgb) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}
