import { drawFrameToCanvas } from "../camera-ui.js";
import { getCenteredAspectCropRect } from "./geometry.js";

const PHOTO_EXPORT_MAX_WIDTH = 2048;

export function createPhotoExportCanvas({
  fallbackCanvas,
  fallbackWidth,
  fallbackHeight,
  cameraFeed,
  facingMode,
  shouldMirrorUserFacing,
  sourceRect = undefined,
}) {
  const photoCanvas = document.createElement("canvas");
  const photoContext = photoCanvas.getContext("2d");

  if (!photoContext) {
    return null;
  }

  const hasNativeVideoFrame = Boolean(
    cameraFeed && cameraFeed.videoWidth > 0 && cameraFeed.videoHeight > 0,
  );
  const sourceWidth = hasNativeVideoFrame ? cameraFeed.videoWidth : fallbackWidth;
  const sourceHeight = hasNativeVideoFrame ? cameraFeed.videoHeight : fallbackHeight;
  const defaultSourceRect = hasNativeVideoFrame
    ? getCenteredAspectCropRect(sourceWidth, sourceHeight)
    : null;
  const effectiveSourceRect = sourceRect === undefined ? defaultSourceRect : sourceRect;
  const exportSourceWidth = effectiveSourceRect?.width ?? sourceWidth;
  const exportSourceHeight = effectiveSourceRect?.height ?? sourceHeight;

  if (exportSourceWidth <= 0 || exportSourceHeight <= 0) {
    return null;
  }

  const photoWidth = Math.min(exportSourceWidth, PHOTO_EXPORT_MAX_WIDTH);
  const photoHeight = Math.max(
    1,
    Math.round((exportSourceHeight / exportSourceWidth) * photoWidth),
  );

  photoCanvas.width = photoWidth;
  photoCanvas.height = photoHeight;
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = "high";

  if (hasNativeVideoFrame) {
    drawFrameToCanvas({
      context: photoContext,
      cameraFeed,
      width: photoWidth,
      height: photoHeight,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: effectiveSourceRect,
    });
  } else {
    photoContext.drawImage(
      fallbackCanvas,
      0,
      0,
      fallbackWidth,
      fallbackHeight,
      0,
      0,
      photoWidth,
      photoHeight,
    );
  }

  return photoCanvas;
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

export async function exportPhotoBlob({
  fallbackCanvas,
  fallbackWidth,
  fallbackHeight,
  cameraFeed,
  facingMode,
  shouldMirrorUserFacing,
  sourceRect = undefined,
  photoExportQuality,
}) {
  const photoCanvas = createPhotoExportCanvas({
    fallbackCanvas,
    fallbackWidth,
    fallbackHeight,
    cameraFeed,
    facingMode,
    shouldMirrorUserFacing,
    sourceRect,
  });

  if (!photoCanvas) {
    return canvasToBlob(fallbackCanvas, "image/jpeg", photoExportQuality);
  }

  const webpBlob = await canvasToBlob(photoCanvas, "image/webp", photoExportQuality);
  if (webpBlob?.type === "image/webp") {
    return webpBlob;
  }

  return canvasToBlob(photoCanvas, "image/jpeg", photoExportQuality);
}
