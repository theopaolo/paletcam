import { toColorNameHex } from "../color-name-api.js";
import { toRgbCss } from "../color-format.js";

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

const VERSO_PAPER = "#faf7f1";
const VERSO_INK = "#2b2620";
const VERSO_MUTED = "#7a7266";
const VERSO_HAIRLINE = "#e6dfd1";
const VERSO_PLATE_RULE = "#d9d1c2";

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
  const eased = shares.map((share) =>
    Math.max(share ** STRIPE_BALANCE_EXPONENT, MIN_STRIPE_SHARE),
  );
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
  const centerX = EXPORT_WIDTH / 2;
  const rowGap = 9 * s;
  const nameSize = 14 * s;
  const valueSize = 9.6 * s;
  const rowHeight = nameSize + valueSize + 7 * s;
  let cursorY = 0.62 * EXPORT_HEIGHT;

  const drawName = (entry, x) => {
    context.fillStyle = VERSO_INK;
    context.font = `600 ${nameSize}px SNPro, sans-serif`;
    context.textAlign = "center";
    context.fillText(entry.name, x, cursorY + nameSize);
    context.fillStyle = VERSO_MUTED;
    context.font = `${valueSize}px monospace`;
    context.fillText(`${entry.hex} - ${entry.rgbLabel}`, x, cursorY + nameSize + valueSize + 4 * s);
  };

  captionRows.forEach((row, rowIndex) => {
    if (rowIndex > 0) {
      context.fillStyle = VERSO_PLATE_RULE;
      context.fillRect(0.3 * EXPORT_WIDTH, cursorY - rowGap / 2, 0.4 * EXPORT_WIDTH, 1 * s);
    }

    if (row.length === 1) {
      drawName(versoData.entries[row[0]], centerX);
    } else {
      drawName(versoData.entries[row[0]], EXPORT_WIDTH * 0.3);
      drawName(versoData.entries[row[1]], EXPORT_WIDTH * 0.7);
      context.fillStyle = VERSO_PLATE_RULE;
      context.fillRect(centerX, cursorY + 2 * s, 1 * s, rowHeight - 4 * s);
    }

    cursorY += rowHeight + rowGap;
  });
}

function drawStripesExport(context, versoData) {
  const s = EXPORT_SCALE;
  const nameSize = 12.5 * s;
  const valueSize = 9.6 * s;
  const rowHeight = nameSize + 10 * s;
  const rowGap = 7 * s;
  const paddingX = 0.06 * EXPORT_WIDTH;
  const captionPaddingTop = 0.045 * EXPORT_HEIGHT;
  const captionPaddingBottom = 0.09 * EXPORT_HEIGHT;
  const captionHeight =
    captionPaddingTop +
    versoData.entries.length * (rowHeight + rowGap) -
    rowGap +
    captionPaddingBottom;
  const bandHeight = EXPORT_HEIGHT - captionHeight;
  const gap = 5 * s;
  const bandWidth = EXPORT_WIDTH - gap * (versoData.entries.length - 1);

  let stripeX = 0;
  versoData.entries.forEach((entry) => {
    const stripeWidth = entry.stripeWeight * bandWidth;
    context.fillStyle = toRgbCss(entry.color);
    context.fillRect(stripeX, 0, stripeWidth, bandHeight);
    stripeX += stripeWidth + gap;
  });

  let cursorY = bandHeight + captionPaddingTop;
  versoData.entries.forEach((entry) => {
    context.fillStyle = VERSO_INK;
    context.font = `600 ${nameSize}px SNPro, sans-serif`;
    context.textAlign = "left";
    context.fillText(entry.name, paddingX, cursorY + nameSize);

    context.fillStyle = VERSO_MUTED;
    context.font = `${valueSize}px monospace`;
    context.textAlign = "right";
    context.fillText(
      `${entry.hex} - ${entry.rgbLabel}`,
      EXPORT_WIDTH - paddingX,
      cursorY + nameSize,
    );

    context.fillStyle = VERSO_HAIRLINE;
    context.fillRect(paddingX, cursorY + rowHeight - 2 * s, EXPORT_WIDTH - paddingX * 2, 1 * s);
    cursorY += rowHeight + rowGap;
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
        document.fonts.load(`500 ${10 * EXPORT_SCALE}px SNPro`),
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

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
