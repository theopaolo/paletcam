import { toColorNameHex } from "../color-name-api.js";
import { toRgbCss } from "../color-format.js";
import { embedPaletteMetadata } from "./palette-image-metadata.js";

/**
 * Sanzo Wada inspired palette verso: a cross plate for 2-4 colors, a
 * density-weighted stripe band for 5+. One data shape feeds both the DOM
 * face shown when a catch is flipped and the canvas export.
 */

const STRIPE_LAYOUT_MIN_COLORS = 5;
/* Stripe widths follow density but are eased toward balance: a power curve
   grows rare hues and reins in dominant ones (Wada's plates never let one
   color crush the rest), then a floor keeps slivers readable. */
const STRIPE_BALANCE_EXPONENT = 0.75;
const MIN_STRIPE_SHARE = 0.04;

/* Artifact colors for the canvas export — mirrors of the tokens used by the
   DOM face in public/styles/blocks/panel/palette-verso.css:
   --color-polaroid-shell-light, --color-surface-ink, --color-surface-base and
   the local --verso-hairline. Keep both sides in sync. */
const VERSO_PAPER = "#fff";
const VERSO_INK = "#111";
const VERSO_MUTED = "#222";
const VERSO_HAIRLINE = "rgb(0 0 0 / 20%)";

/* Block geometry per color count, in % of the plate area (x, y, w, h). */
const PLATE_BLOCKS = {
  2: [
    [34, 6, 32, 60],
    [20, 40, 60, 26],
  ],
  3: [
    [34, 0, 32, 32],
    [12, 32, 76, 26],
    [34, 58, 32, 32],
  ],
  4: [
    [34, 0, 32, 30],
    [8, 30, 42, 26],
    [50, 30, 42, 26],
    [34, 56, 32, 30],
  ],
};

/* Caption rows per color count: entry indexes, one row = 1 or 2 entries. */
const PLATE_CAPTION_ROWS = {
  2: [[0, 1]],
  3: [[0], [1], [2]],
  4: [[0], [1, 2], [3]],
};

function getColorShares(colors) {
  const populations = colors.map((color) => {
    const population = Number(color?.population);
    return Number.isFinite(population) && population > 0 ? population : 0;
  });
  const total = populations.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return colors.map(() => 1 / colors.length);
  }

  return populations.map((population) => population / total);
}

function getStripeWeights(shares) {
  const eased = shares.map((share) => Math.max(share ** STRIPE_BALANCE_EXPONENT, MIN_STRIPE_SHARE));
  const easedTotal = eased.reduce((sum, value) => sum + value, 0);
  return eased.map((weight) => weight / easedTotal);
}

/**
 * @param {Palette} palette
 * @param {string[]} [names]  resolved color names, aligned with palette.colors
 * @returns {{
 *   layout: "plate" | "stripes",
 *   entries: Array<{
 *     color: { r: number, g: number, b: number },
 *     name: string,
 *     hex: string,
 *     rgbLabel: string,
 *     share: number,
 *     stripeWeight: number,
 *   }>,
 * } | null}
 */
export function getPaletteVersoData(palette, names = []) {
  const colors = Array.isArray(palette?.colors) ? palette.colors : [];
  if (colors.length < 2) {
    return null;
  }

  const shares = getColorShares(colors);
  const entries = colors.map((color, index) => {
    const hex = toColorNameHex(color);
    const providedName = typeof names[index] === "string" ? names[index].trim() : "";
    return {
      color: { r: color.r, g: color.g, b: color.b },
      name: providedName || hex,
      hex,
      rgbLabel: `RGB(${color.r},${color.g},${color.b})`,
      share: shares[index],
      stripeWeight: shares[index],
    };
  });

  const layout = entries.length >= STRIPE_LAYOUT_MIN_COLORS ? "stripes" : "plate";
  if (layout === "stripes") {
    entries.sort((a, b) => b.share - a.share);
    const weights = getStripeWeights(entries.map((entry) => entry.share));
    entries.forEach((entry, index) => {
      entry.stripeWeight = weights[index];
    });
  }

  return {
    layout,
    entries,
  };
}

function createVersoName(entry) {
  const name = document.createElement("span");
  name.className = "palette-verso-name";

  const title = document.createElement("strong");
  title.textContent = entry.name;

  const values = document.createElement("span");
  values.className = "palette-verso-values";
  values.textContent = `${entry.hex} - ${entry.rgbLabel}`;

  name.append(title, values);
  return name;
}

function createPlateFace(versoData) {
  const fragment = document.createDocumentFragment();
  const blocks = PLATE_BLOCKS[versoData.entries.length];
  const captionRows = PLATE_CAPTION_ROWS[versoData.entries.length];

  const plate = document.createElement("div");
  plate.className = "palette-verso-plate";
  versoData.entries.forEach((entry, index) => {
    const [x, y, w, h] = blocks[index];
    const block = document.createElement("div");
    block.className = "palette-verso-block";
    block.style.left = `${x}%`;
    block.style.top = `${y}%`;
    block.style.width = `${w}%`;
    block.style.height = `${h}%`;
    block.style.background = toRgbCss(entry.color);
    plate.appendChild(block);
  });

  const caption = document.createElement("div");
  caption.className = "palette-verso-caption";
  captionRows.forEach((row, rowIndex) => {
    if (rowIndex > 0) {
      const rule = document.createElement("hr");
      rule.className = "palette-verso-rule";
      caption.appendChild(rule);
    }

    if (row.length === 1) {
      caption.appendChild(createVersoName(versoData.entries[row[0]]));
      return;
    }

    const pair = document.createElement("div");
    pair.className = "palette-verso-pair";
    pair.appendChild(createVersoName(versoData.entries[row[0]]));
    const divider = document.createElement("span");
    divider.className = "palette-verso-divider";
    pair.appendChild(divider);
    pair.appendChild(createVersoName(versoData.entries[row[1]]));
    caption.appendChild(pair);
  });

  fragment.append(plate, caption);
  return fragment;
}

function createStripesFace(versoData) {
  const fragment = document.createDocumentFragment();

  const band = document.createElement("div");
  band.className = "palette-verso-band";
  versoData.entries.forEach((entry) => {
    const stripe = document.createElement("div");
    stripe.style.flexGrow = String(Math.round(entry.stripeWeight * 1000));
    stripe.style.background = toRgbCss(entry.color);
    band.appendChild(stripe);
  });

  const caption = document.createElement("div");
  caption.className = "palette-verso-lines";
  versoData.entries.forEach((entry) => {
    const line = document.createElement("div");
    line.className = "palette-verso-line";

    const title = document.createElement("strong");
    title.textContent = entry.name;

    const values = document.createElement("span");
    values.className = "palette-verso-values";
    values.textContent = `${entry.hex} - ${entry.rgbLabel}`;

    line.append(title, values);
    caption.appendChild(line);
  });

  fragment.append(band, caption);
  return fragment;
}

/**
 * @param {Palette} palette
 * @param {string[]} [names]
 * @returns {HTMLElement | null}
 */
export function createPaletteVersoElement(palette, names = []) {
  const versoData = getPaletteVersoData(palette, names);
  if (!versoData) {
    return null;
  }

  const verso = document.createElement("div");
  verso.className = `palette-verso palette-verso--${versoData.layout}`;
  verso.appendChild(
    versoData.layout === "plate" ? createPlateFace(versoData) : createStripesFace(versoData),
  );
  return verso;
}

/* ── Canvas export ── */

const EXPORT_WIDTH = 820;
const EXPORT_HEIGHT = 1000;
const EXPORT_SCALE = EXPORT_WIDTH / 410;

/* Canvas has no line boxes, so type metrics are measured off the DOM face at
   the 410x500 reference size, at the smallest clamp step (what a phone
   renders). SNPro puts its baseline at ~0.82em; the plate stacks the mono
   values under the name in a line box inherited from the 16px root. */
const NAME_BASELINE_RATIO = 0.82;
const PLATE_VALUE_LINE_HEIGHT = 18.5;
const PLATE_VALUE_BASELINE = 14.5;

function drawEntryValues(context, entry, x, baselineY, valueSize) {
  context.fillStyle = VERSO_MUTED;
  context.font = `${valueSize}px monospace`;
  context.fillText(`${entry.hex} - ${entry.rgbLabel}`, x, baselineY);
}

function drawEntryName(context, entry, x, baselineY, nameSize) {
  context.fillStyle = VERSO_INK;
  context.font = `600 ${nameSize}px SNPro, sans-serif`;
  context.fillText(entry.name, x, baselineY);
}

/* Mirrors .palette-verso-plate / .palette-verso-caption: plate inset
   10% 9% 46%, caption inset 5% side / 4% bottom, centered rows separated by
   hairlines, the whole caption anchored to the bottom of the card. */
function drawPlateExport(context, versoData) {
  const s = EXPORT_SCALE;
  const plateX = 0.09 * EXPORT_WIDTH;
  const plateY = 0.1 * EXPORT_HEIGHT;
  const plateW = 0.82 * EXPORT_WIDTH;
  const plateH = 0.44 * EXPORT_HEIGHT;
  const blocks = PLATE_BLOCKS[versoData.entries.length];

  versoData.entries.forEach((entry, index) => {
    const [x, y, w, h] = blocks[index];
    context.fillStyle = toRgbCss(entry.color);
    context.fillRect(
      plateX + (x / 100) * plateW,
      plateY + (y / 100) * plateH,
      (w / 100) * plateW,
      (h / 100) * plateH,
    );
  });

  const captionRows = PLATE_CAPTION_ROWS[versoData.entries.length];
  const captionX = 0.05 * EXPORT_WIDTH;
  const captionWidth = EXPORT_WIDTH - captionX * 2;
  const centerX = EXPORT_WIDTH / 2;
  const nameSize = 14 * s;
  const valueSize = 8 * s;
  const gap = 7.2 * s;
  const hairline = 1 * s;
  const rowHeight = nameSize + PLATE_VALUE_LINE_HEIGHT * s;
  /* Rules sit in the row flow, so each seam costs one hairline and two gaps. */
  const captionHeight =
    captionRows.length * rowHeight + (captionRows.length - 1) * (hairline + gap * 2);
  /* Pair columns: 1fr 1px 1fr with a 0.5rem gap, like .palette-verso-pair. */
  const pairColumn = (captionWidth - hairline - 8 * s * 2) / 2;
  let cursorY = EXPORT_HEIGHT - 0.04 * EXPORT_HEIGHT - captionHeight;

  const drawEntry = (entry, x) => {
    drawEntryName(context, entry, x, cursorY + nameSize * NAME_BASELINE_RATIO, nameSize);
    drawEntryValues(context, entry, x, cursorY + nameSize + PLATE_VALUE_BASELINE * s, valueSize);
  };

  context.textAlign = "center";
  captionRows.forEach((row, rowIndex) => {
    if (rowIndex > 0) {
      context.fillStyle = VERSO_HAIRLINE;
      context.fillRect(captionX + captionWidth * 0.2, cursorY - gap, captionWidth * 0.6, hairline);
    }

    if (row.length === 1) {
      drawEntry(versoData.entries[row[0]], centerX);
    } else {
      drawEntry(versoData.entries[row[0]], captionX + pairColumn / 2);
      drawEntry(versoData.entries[row[1]], captionX + captionWidth - pairColumn / 2);
      context.fillStyle = VERSO_HAIRLINE;
      context.fillRect(centerX - hairline / 2, cursorY, hairline, rowHeight);
    }

    cursorY += rowHeight + hairline + gap * 2;
  });
}

/* Mirrors .palette-verso--stripes: a padded band of gapless stripes that
   flexes to fill whatever the content-sized caption leaves. */
function drawStripesExport(context, versoData) {
  const s = EXPORT_SCALE;
  const bandPadding = 16 * s;
  const captionPadding = 16 * s;
  const nameSize = 12 * s;
  const valueSize = 8 * s;
  const rowGap = 8 * s;
  const rowPaddingBottom = 4.8 * s;
  const hairline = 1 * s;
  const rowCount = versoData.entries.length;
  /* Every row but the last carries a bottom hairline (:last-child drops it). */
  const captionHeight =
    captionPadding * 2 +
    rowCount * (nameSize + rowPaddingBottom) +
    (rowCount - 1) * (hairline + rowGap);
  const bandHeight = EXPORT_HEIGHT - captionHeight;
  const bandWidth = EXPORT_WIDTH - bandPadding * 2;

  let stripeX = bandPadding;
  versoData.entries.forEach((entry, index) => {
    /* Last stripe closes on the padding edge so rounding never leaves a seam. */
    const stripeEnd =
      index === rowCount - 1 ? bandPadding + bandWidth : stripeX + entry.stripeWeight * bandWidth;
    context.fillStyle = toRgbCss(entry.color);
    context.fillRect(stripeX, bandPadding, stripeEnd - stripeX, bandHeight - bandPadding * 2);
    stripeX = stripeEnd;
  });

  let cursorY = bandHeight + captionPadding;
  versoData.entries.forEach((entry, index) => {
    const baselineY = cursorY + nameSize * NAME_BASELINE_RATIO;

    context.textAlign = "left";
    drawEntryName(context, entry, captionPadding, baselineY, nameSize);

    context.textAlign = "right";
    drawEntryValues(context, entry, EXPORT_WIDTH - captionPadding, baselineY, valueSize);

    cursorY += nameSize + rowPaddingBottom;
    if (index < rowCount - 1) {
      context.fillStyle = VERSO_HAIRLINE;
      context.fillRect(captionPadding, cursorY, EXPORT_WIDTH - captionPadding * 2, hairline);
      cursorY += hairline + rowGap;
    }
  });
}

/**
 * @param {Palette} palette
 * @param {string[]} [names]
 * @returns {Promise<Blob | null>}
 */
export async function renderPaletteVersoBlob(palette, names = []) {
  const versoData = getPaletteVersoData(palette, names);
  if (!versoData) {
    return null;
  }

  if (document.fonts?.load) {
    try {
      await Promise.all([
        document.fonts.load(`600 ${14 * EXPORT_SCALE}px SNPro`),
        document.fonts.load(`600 ${12 * EXPORT_SCALE}px SNPro`),
      ]);
    } catch (_error) {
      // Export falls back to the generic sans-serif stack.
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = VERSO_PAPER;
  context.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  context.textBaseline = "alphabetic";

  if (versoData.layout === "plate") {
    drawPlateExport(context, versoData);
  } else {
    drawStripesExport(context, versoData);
  }

  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });

  return embedPaletteMetadata(blob, palette?.colors);
}
