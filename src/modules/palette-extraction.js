import { toRgbCss } from "./color-format.js";
import {
  extractGridPaletteColors,
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_RADIUS,
  SAMPLE_ROW_COUNT,
} from "./palette-extract-grid.js";

const COLOR_DISTANCE_THRESHOLD = 35;

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

// Orchestrator entrypoint. For now this delegates to the grid strategy.
// Keeping this wrapper stable makes it easy to add a switchable median-cut mode next.
export function extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount) {
  return extractGridPaletteColors(imageData, frameWidth, frameHeight, swatchCount);
}

export { SAMPLE_COL_COUNT, SAMPLE_DIAMETER, SAMPLE_RADIUS, SAMPLE_ROW_COUNT };

// Draw palette colors as equal-width vertical bars across the canvas
export function renderPaletteBars(context, colors, canvasWidth, canvasHeight) {
  if (!context || canvasWidth <= 0 || canvasHeight <= 0 || colors.length === 0) {
    return;
  }

  const barWidth = canvasWidth / colors.length;

  colors.forEach((color, index) => {
    context.fillStyle = toRgbCss(color);
    context.fillRect(index * barWidth, 0, barWidth, canvasHeight);
  });
}

let previousColors = null;

export function smoothColors(rawColors, lerpFactor) {
  if (!previousColors || previousColors.length !== rawColors.length) {
    previousColors = rawColors; // nothing to lerp from yet
    return rawColors;
  }

  const smoothed = rawColors.map((rawColor, index) => {
    const prevColor = previousColors[index];

    const distance = Math.hypot(
      rawColor.r - prevColor.r,
      rawColor.g - prevColor.g,
      rawColor.b - prevColor.b
    );

    if (distance < COLOR_DISTANCE_THRESHOLD) return prevColor;

    const r = Math.round(prevColor.r + (rawColor.r - prevColor.r) * lerpFactor);
    const g = Math.round(prevColor.g + (rawColor.g - prevColor.g) * lerpFactor);
    const b = Math.round(prevColor.b + (rawColor.b - prevColor.b) * lerpFactor);

    return buildRgbColor(r, g, b);
  });

  previousColors = smoothed;

  return smoothed;
}
