import { toRgbCss } from "./color-format.js";

const MIN_SWATCH_COUNT = 1;
const COLOR_DISTANCE_THRESHOLD = 12;

function clampSwatchCount(swatchCount) {
  return Math.max(MIN_SWATCH_COUNT, Number(swatchCount) || MIN_SWATCH_COUNT);
}

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

export function extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount) {
  const normalizedSwatchCount = clampSwatchCount(swatchCount);
  // A radius of 7 creates a 15x15 pixel sampling area (7 + 1 + 7)
  // Larger radius = more stable colors but slower and more blurred
  const SAMPLE_RADIUS = 7;

  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return [];
  }

  // Sample from the vertical center of the frame
  const sampleRow = Math.floor(frameHeight / 2);

  // For each swatch, average a block of pixels around its center point
  // instead of reading a single pixel (which is noisy on live camera feeds)
  return Array.from({ length: normalizedSwatchCount }, (_, index) => {

    // Calculate the swatch center point (sampleX)
    const sampleX = Math.floor(
      (frameWidth / normalizedSwatchCount) * index +
        frameWidth / (normalizedSwatchCount * 2)
    );

    // Reset accumulators for THIS swatch
    let totalR = 0,
        totalG = 0,
        totalB = 0,
        sampledPixelCount = 0;

    // Walk a 15x15 block around the center point
    for(let offsetY = -SAMPLE_RADIUS; offsetY <= SAMPLE_RADIUS; offsetY += 1) {

      // Skip pixels that fall outside the image bounds
      const y = sampleRow + offsetY;
      if (y < 0 || y >= frameHeight) continue;

      for(let offsetX = -SAMPLE_RADIUS; offsetX <= SAMPLE_RADIUS; offsetX += 1) {

        const x = sampleX + offsetX;
        if (x < 0 || x >= frameWidth) continue;

        const pixelIndex = (y * frameWidth + x) * 4;

        // imageData is a flat array: [R,G,B,A, R,G,B,A, ...] stored row by row
        // To find pixel (x,y): skip y full rows, then x pixels, multiply by 4 (RGBA)
        totalR += imageData[pixelIndex];
        totalG += imageData[pixelIndex + 1];
        totalB += imageData[pixelIndex + 2];

        sampledPixelCount += 1;
      }
    }

    // Guard against division by zero (shouldn't happen, but safe default)
    if (sampledPixelCount === 0) return { r: 0, g: 0, b: 0 };

     return buildRgbColor(
      Math.round(totalR / sampledPixelCount),
      Math.round(totalG / sampledPixelCount),
      Math.round(totalB / sampledPixelCount)
    );
  });
}

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
    previousColors = rawColors;       // nothing to lerp from yet
    return rawColors;
  }

  const smoothed = rawColors.map((rawColor, index) => {
    const prevColor = previousColors[index];

    const distance = Math.hypot(rawColor.r - prevColor.r, rawColor.g - prevColor.g, rawColor.b - prevColor.b)

    if (distance < COLOR_DISTANCE_THRESHOLD) return prevColor;

    const r = Math.round(prevColor.r + (rawColor.r - prevColor.r) * lerpFactor);
    const g = Math.round(prevColor.g + (rawColor.g - prevColor.g) * lerpFactor);
    const b = Math.round(prevColor.b + (rawColor.b - prevColor.b) * lerpFactor);

    return buildRgbColor(r,g,b);
  })

  previousColors = smoothed;

  return smoothed;
}
