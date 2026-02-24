const DEFAULT_MAX_SAMPLED_PIXELS = 12_000;

function clampPositiveInteger(value, fallbackValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackValue;
  }

  return Math.floor(numericValue);
}

function computePixelStride(frameWidth, frameHeight, maxPixels) {
  const totalPixels = frameWidth * frameHeight;
  if (totalPixels <= 0) {
    return 1;
  }

  // Use a square stride so we roughly preserve the image distribution while
  // keeping the quantizer input bounded for live preview use.
  return Math.max(1, Math.ceil(Math.sqrt(totalPixels / maxPixels)));
}

function packArgb8888(red, green, blue) {
  return (0xff << 24) | ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff);
}

export function packImageDataToArgb8888(
  imageData,
  frameWidth,
  frameHeight,
  { maxPixels = DEFAULT_MAX_SAMPLED_PIXELS } = {}
) {
  if (!imageData || frameWidth <= 0 || frameHeight <= 0) {
    return new Int32Array(0);
  }

  const boundedMaxPixels = clampPositiveInteger(maxPixels, DEFAULT_MAX_SAMPLED_PIXELS);
  const stride = computePixelStride(frameWidth, frameHeight, boundedMaxPixels);
  const estimatedCount = Math.ceil(frameWidth / stride) * Math.ceil(frameHeight / stride);
  const packedPixels = new Int32Array(estimatedCount);

  let writeIndex = 0;

  for (let y = 0; y < frameHeight; y += stride) {
    for (let x = 0; x < frameWidth; x += stride) {
      const pixelIndex = (y * frameWidth + x) * 4;
      const alpha = imageData[pixelIndex + 3];

      // Skip fully transparent pixels to avoid polluting the histogram.
      if (alpha === 0) {
        continue;
      }

      packedPixels[writeIndex] = packArgb8888(
        imageData[pixelIndex],
        imageData[pixelIndex + 1],
        imageData[pixelIndex + 2]
      );
      writeIndex += 1;
    }
  }

  return packedPixels.subarray(0, writeIndex);
}
