import { toRgbCss } from "../color-format.js";

const EXPORT_BRAND_LABEL_FALLBACK = "Colors Catchers";
const POLAROID_CARD_ASPECT_RATIO = 1.22;
const DEFAULT_POLAROID_PHOTO_ASPECT_RATIO = 4 / 3;
const POLAROID_RENDER_MAX_WIDTH = 1600;
const POLAROID_RENDER_SCALE = 1;
const POLAROID_RENDER_QUALITY = 0.95;
const LEGACY_MIN_PALETTE_PANEL_HEIGHT = 40;
const POLAROID_FRAME_SHELL_LIGHT = "#ffffff";
const POLAROID_FRAME_SHELL_DARK = "#101214";
const POLAROID_FRAME_FOOTER_LIGHT = "#f7f7f7";
const POLAROID_FRAME_FOOTER_DARK = "#101214";
const POLAROID_FOOTER_TEXT_LIGHT = "rgba(34, 34, 34, 0.9)";
const POLAROID_FOOTER_TEXT_DARK = "rgba(255, 255, 255, 0.94)";

function getBrandLabel() {
  return document.querySelector(".colorscatcher")?.textContent?.trim()
    || EXPORT_BRAND_LABEL_FALLBACK;
}

function getPolaroidCardWidth(
  sourceImageWidth,
  {
    maxWidth = POLAROID_RENDER_MAX_WIDTH,
    scale = POLAROID_RENDER_SCALE,
  } = {},
) {
  return Math.max(
    320,
    Math.round(
      Math.min(
        sourceImageWidth,
        maxWidth,
        sourceImageWidth * scale,
      ),
    ),
  );
}

function loadImageFromBlob(blob) {
  if (!blob) {
    return Promise.reject(new Error("Missing image blob"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const photoUrl = URL.createObjectURL(blob);

    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(photoUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(photoUrl);
      reject(new Error("Unable to load preview image"));
    };
    image.src = photoUrl;
  });
}

export function hasPaletteMasterPhoto(palette) {
  return Boolean(palette?.photoBlob);
}

export function getPalettePhotoAspectRatioValue(palette) {
  if (palette?.captureAspectRatio === "1:1") {
    return 1;
  }

  if (palette?.captureAspectRatio === "4:3") {
    return 4 / 3;
  }

  return null;
}

export function resolveNormalizedCropRectToPixelRect({
  cropRect,
  imageWidth,
  imageHeight,
}) {
  if (!cropRect || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const normalizedX = Number(cropRect.x);
  const normalizedY = Number(cropRect.y);
  const normalizedWidth = Number(cropRect.width);
  const normalizedHeight = Number(cropRect.height);

  if (
    !Number.isFinite(normalizedX) ||
    !Number.isFinite(normalizedY) ||
    !Number.isFinite(normalizedWidth) ||
    !Number.isFinite(normalizedHeight)
  ) {
    return null;
  }

  const safeX = Math.max(0, Math.min(1, normalizedX));
  const safeY = Math.max(0, Math.min(1, normalizedY));
  const safeWidth = Math.max(0, Math.min(1 - safeX, normalizedWidth));
  const safeHeight = Math.max(0, Math.min(1 - safeY, normalizedHeight));

  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  const startX = Math.max(0, Math.min(imageWidth - 1, Math.round(safeX * imageWidth)));
  const startY = Math.max(0, Math.min(imageHeight - 1, Math.round(safeY * imageHeight)));
  const endX = Math.max(
    startX + 1,
    Math.min(imageWidth, Math.round((safeX + safeWidth) * imageWidth))
  );
  const endY = Math.max(
    startY + 1,
    Math.min(imageHeight, Math.round((safeY + safeHeight) * imageHeight))
  );

  return {
    x: startX,
    y: startY,
    width: Math.max(1, endX - startX),
    height: Math.max(1, endY - startY),
  };
}

function resolvePalettePhotoSourceRect(image, palette) {
  return resolveNormalizedCropRectToPixelRect({
    cropRect: palette?.captureCropRect,
    imageWidth: image.width,
    imageHeight: image.height,
  });
}

function traceRoundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius) {
  traceRoundedRectPath(context, x, y, width, height, radius);
  context.fill();
}

function drawImageCover({
  context,
  image,
  x,
  y,
  width,
  height,
  radius,
  sourceRect = null,
}) {
  if (width <= 0 || height <= 0) {
    return;
  }

  let sourceX = sourceRect?.x ?? 0;
  let sourceY = sourceRect?.y ?? 0;
  let sourceWidth = sourceRect?.width ?? image.width;
  let sourceHeight = sourceRect?.height ?? image.height;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const sourceAspectRatio = sourceWidth / sourceHeight;
  const targetAspectRatio = width / height;

  if (sourceAspectRatio > targetAspectRatio) {
    const availableWidth = sourceWidth;
    sourceWidth = sourceHeight * targetAspectRatio;
    sourceX += (availableWidth - sourceWidth) / 2;
  } else {
    const availableHeight = sourceHeight;
    sourceHeight = sourceWidth / targetAspectRatio;
    sourceY += (availableHeight - sourceHeight) * 0.45;
  }

  context.save();
  traceRoundedRectPath(context, x, y, width, height, radius);
  context.clip();
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
  context.restore();
}

function drawPaletteStrip({
  context,
  colors,
  x,
  y,
  width,
  height,
  panelRadius,
}) {
  const paletteColors = Array.isArray(colors) && colors.length > 0
    ? colors
    : [{ r: 236, g: 231, b: 221 }];

  if (width <= 0 || height <= 0) {
    return;
  }

  context.save();
  traceRoundedRectPath(context, x, y, width, height, panelRadius);
  context.clip();

  paletteColors.forEach((color, index) => {
    const tileX = x + ((width * index) / paletteColors.length);
    const nextTileX = x + ((width * (index + 1)) / paletteColors.length);

    context.fillStyle = toRgbCss(color);
    context.fillRect(tileX, y, nextTileX - tileX, height);
  });

  context.restore();
}

function drawBrandCaption({
  context,
  label,
  x,
  y,
  width,
  height,
  cardWidth,
  darkFooter = false,
}) {
  const safeLabel = label?.trim() || EXPORT_BRAND_LABEL_FALLBACK;
  let fontSize = Math.max(16, Math.round(cardWidth * 0.065));

  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";

  for (; fontSize >= 16; fontSize -= 1) {
    context.font = `italic 700 ${fontSize}px Air, Arial, sans-serif`;
    if (context.measureText(safeLabel).width <= width * 0.92) {
      break;
    }
  }

  context.fillStyle = darkFooter
    ? POLAROID_FOOTER_TEXT_DARK
    : POLAROID_FOOTER_TEXT_LIGHT;
  context.fillText(safeLabel, x + (width / 2), y + (height * 0.58));
  context.restore();
}

function renderPolaroidCanvas({
  canvas,
  context,
  image,
  colors,
  brandLabel,
  photoAspectRatio = DEFAULT_POLAROID_PHOTO_ASPECT_RATIO,
  photoSourceRect = null,
  expandCardForLegacyRawAspect = false,
  darkFrameShell = false,
  maxWidth = POLAROID_RENDER_MAX_WIDTH,
  scale = POLAROID_RENDER_SCALE,
}) {
  const photoSourceWidth = photoSourceRect?.width ?? image.width;
  const cardWidth = getPolaroidCardWidth(photoSourceWidth, { maxWidth, scale });
  const baseCardHeight = Math.round(cardWidth * POLAROID_CARD_ASPECT_RATIO);

  const outerRadius = 0;
  const frameSide = Math.max(16, Math.round(cardWidth * 0.055));
  const frameTop = Math.max(16, Math.round(cardWidth * 0.055));
  const frameBottom = Math.max(46, Math.round(cardWidth * 0.16));
  const innerX = frameSide;
  const innerY = frameTop;
  const innerWidth = cardWidth - (frameSide * 2);

  const panelGap = 0;
  const fallbackPhotoAspectRatio = (
    (photoSourceRect?.width ?? image.width) /
    (photoSourceRect?.height ?? image.height)
  ) || DEFAULT_POLAROID_PHOTO_ASPECT_RATIO;
  const safePhotoAspectRatio = Number.isFinite(photoAspectRatio) && photoAspectRatio > 0
    ? photoAspectRatio
    : fallbackPhotoAspectRatio;
  const preferredPhotoPanelHeight = Math.round(innerWidth / safePhotoAspectRatio);
  const baseInnerHeight = baseCardHeight - frameTop - frameBottom;
  const legacyMinPalettePanelHeight = expandCardForLegacyRawAspect
    ? Math.max(
        LEGACY_MIN_PALETTE_PANEL_HEIGHT,
        Math.round(cardWidth * 0.1),
      )
    : 1;
  const innerHeight = Math.max(
    baseInnerHeight,
    preferredPhotoPanelHeight + panelGap + legacyMinPalettePanelHeight,
  );
  const cardHeight = innerHeight + frameTop + frameBottom;

  canvas.width = cardWidth;
  canvas.height = cardHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const availablePanelsHeight = Math.max(2, innerHeight - panelGap);
  const photoPanelHeight = Math.max(
    1,
    Math.min(availablePanelsHeight - 1, preferredPhotoPanelHeight)
  );
  const palettePanelHeight = Math.max(1, availablePanelsHeight - photoPanelHeight);
  const photoPanelX = innerX;
  const photoPanelY = innerY;
  const palettePanelX = innerX;
  const palettePanelY = innerY + photoPanelHeight + panelGap;
  const panelRadius = 0;

  context.fillStyle = darkFrameShell
    ? POLAROID_FRAME_SHELL_DARK
    : POLAROID_FRAME_SHELL_LIGHT;
  fillRoundedRect(context, 0, 0, cardWidth, cardHeight, outerRadius);

  context.fillStyle = darkFrameShell
    ? POLAROID_FRAME_FOOTER_DARK
    : POLAROID_FRAME_FOOTER_LIGHT;
  context.fillRect(0, innerY + innerHeight, cardWidth, frameBottom);

  drawImageCover({
    context,
    image,
    x: photoPanelX,
    y: photoPanelY,
    width: innerWidth,
    height: photoPanelHeight,
    radius: panelRadius,
    sourceRect: photoSourceRect,
  });

  drawPaletteStrip({
    context,
    colors,
    x: palettePanelX,
    y: palettePanelY,
    width: innerWidth,
    height: palettePanelHeight,
    panelRadius,
  });

  drawBrandCaption({
    context,
    label: brandLabel,
    x: innerX,
    y: innerY + innerHeight,
    width: innerWidth,
    height: frameBottom,
    cardWidth,
    darkFooter: darkFrameShell,
  });
}

function canvasToBlob(canvas, { type = "image/webp", quality = POLAROID_RENDER_QUALITY } = {}) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || null),
      type,
      quality,
    );
  });
}

export async function renderPalettePolaroidBlob(
  palette,
  {
    darkFrameShell = false,
    maxWidth = POLAROID_RENDER_MAX_WIDTH,
    scale = POLAROID_RENDER_SCALE,
    quality = POLAROID_RENDER_QUALITY,
  } = {},
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !hasPaletteMasterPhoto(palette)) {
    return null;
  }

  const image = await loadImageFromBlob(palette.photoBlob);

  renderPolaroidCanvas({
    canvas,
    context,
    image,
    colors: palette.colors,
    brandLabel: getBrandLabel(),
    photoAspectRatio: getPalettePhotoAspectRatioValue(palette),
    photoSourceRect: resolvePalettePhotoSourceRect(image, palette),
    expandCardForLegacyRawAspect: !palette?.captureAspectRatio && !palette?.captureCropRect,
    darkFrameShell,
    maxWidth,
    scale,
  });

  return canvasToBlob(canvas, {
    type: "image/webp",
    quality,
  });
}
