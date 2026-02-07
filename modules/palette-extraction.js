const MIN_SWATCH_COUNT = 1;

function clampSwatchCount(swatchCount) {
  return Math.max(MIN_SWATCH_COUNT, Number(swatchCount) || MIN_SWATCH_COUNT);
}

function buildRgbColor(red, green, blue) {
  return { r: red, g: green, b: blue };
}

export function toRgbCss(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount) {
  const normalizedSwatchCount = clampSwatchCount(swatchCount);

  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return [];
  }

  const sampleRow = Math.floor(frameHeight / 2);

  return Array.from({ length: normalizedSwatchCount }, (_, index) => {
    const sampleX = Math.floor(
      (frameWidth / normalizedSwatchCount) * index +
        frameWidth / (normalizedSwatchCount * 2)
    );

    const pixelIndex = (sampleRow * frameWidth + sampleX) * 4;

    return buildRgbColor(
      imageData[pixelIndex],
      imageData[pixelIndex + 1],
      imageData[pixelIndex + 2]
    );
  });
}

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
