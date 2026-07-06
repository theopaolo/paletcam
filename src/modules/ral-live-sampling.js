import { DEFAULT_SAMPLE_RADIUS, findClosestRAL, sampleColorAtPoint } from "./color-matching-ral.js";

export function getSamplingWindow(width, height, x, y, radius = DEFAULT_SAMPLE_RADIUS) {
  if (width <= 0 || height <= 0) {
    return {
      height: 0,
      localX: 0,
      localY: 0,
      width: 0,
      x: 0,
      y: 0,
    };
  }

  const centerX = Math.round(Math.max(0, Math.min(width - 1, x)));
  const centerY = Math.round(Math.max(0, Math.min(height - 1, y)));
  const left = Math.max(0, centerX - radius);
  const top = Math.max(0, centerY - radius);
  const right = Math.min(width - 1, centerX + radius);
  const bottom = Math.min(height - 1, centerY + radius);

  return {
    height: bottom - top + 1,
    localX: centerX - left,
    localY: centerY - top,
    width: right - left + 1,
    x: left,
    y: top,
  };
}

export function sampleColorFromContextAtPoint(
  context,
  width,
  height,
  x,
  y,
  radius = DEFAULT_SAMPLE_RADIUS,
) {
  const window = getSamplingWindow(width, height, x, y, radius);
  if (!context || window.width <= 0 || window.height <= 0) {
    return { r: 0, g: 0, b: 0 };
  }

  const imageData = context.getImageData(window.x, window.y, window.width, window.height);
  return sampleColorAtPoint(
    imageData.data,
    window.width,
    window.height,
    window.localX,
    window.localY,
    radius,
  );
}

export function findClosestRalFromContext(
  context,
  width,
  height,
  x,
  y,
  count = 1,
  radius = DEFAULT_SAMPLE_RADIUS,
) {
  const sampledColor = sampleColorFromContextAtPoint(context, width, height, x, y, radius);

  return {
    matches: findClosestRAL(sampledColor.r, sampledColor.g, sampledColor.b, count),
    sampledColor,
  };
}
