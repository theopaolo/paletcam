export const CAMERA_FRAME_ASPECT_RATIO = 4 / 3;

export function getContainedSize(width, height, aspectRatio) {
  if (width <= 0 || height <= 0 || aspectRatio <= 0) {
    return { width: 0, height: 0 };
  }

  const containerAspectRatio = width / height;

  if (containerAspectRatio > aspectRatio) {
    const nextHeight = Math.max(1, Math.floor(height));
    const nextWidth = Math.max(1, Math.floor(nextHeight * aspectRatio));
    return { width: nextWidth, height: nextHeight };
  }

  const nextWidth = Math.max(1, Math.floor(width));
  const nextHeight = Math.max(1, Math.floor(nextWidth / aspectRatio));
  return { width: nextWidth, height: nextHeight };
}

export function getTargetFrameHeight(width) {
  if (width <= 0) {
    return 0;
  }

  return Math.max(1, Math.floor(width / CAMERA_FRAME_ASPECT_RATIO));
}

export function getCenteredAspectCropRect(
  sourceWidth,
  sourceHeight,
  targetAspectRatio = CAMERA_FRAME_ASPECT_RATIO,
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetAspectRatio <= 0) {
    return null;
  }

  const sourceAspectRatio = sourceWidth / sourceHeight;

  if (Math.abs(sourceAspectRatio - targetAspectRatio) < 0.0001) {
    return {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  if (sourceAspectRatio > targetAspectRatio) {
    const width = Math.max(1, Math.round(sourceHeight * targetAspectRatio));
    const x = Math.max(0, Math.floor((sourceWidth - width) / 2));

    return {
      x,
      y: 0,
      width: Math.min(width, sourceWidth),
      height: sourceHeight,
    };
  }

  const height = Math.max(1, Math.round(sourceWidth / targetAspectRatio));
  const y = Math.max(0, Math.floor((sourceHeight - height) / 2));

  return {
    x: 0,
    y,
    width: sourceWidth,
    height: Math.min(height, sourceHeight),
  };
}

function roundNormalizedCropValue(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function toNormalizedCropRect(sourceRect, sourceWidth, sourceHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const safeRect =
    sourceRect && sourceRect.width > 0 && sourceRect.height > 0
      ? sourceRect
      : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  const clampedX = Math.max(0, Math.min(Math.round(safeRect.x), Math.max(0, sourceWidth - 1)));
  const clampedY = Math.max(0, Math.min(Math.round(safeRect.y), Math.max(0, sourceHeight - 1)));
  const clampedWidth = Math.max(1, Math.min(Math.round(safeRect.width), sourceWidth - clampedX));
  const clampedHeight = Math.max(1, Math.min(Math.round(safeRect.height), sourceHeight - clampedY));

  return {
    x: roundNormalizedCropValue(clampedX / sourceWidth),
    y: roundNormalizedCropValue(clampedY / sourceHeight),
    width: roundNormalizedCropValue(clampedWidth / sourceWidth),
    height: roundNormalizedCropValue(clampedHeight / sourceHeight),
  };
}
