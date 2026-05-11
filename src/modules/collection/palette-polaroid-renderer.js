import { getAppSettings } from "../../app-settings.js";
import { toRgbCss } from "../color-format.js";
import { getColorNames } from "../color-name-api.js";
import { relativeLuminance } from "../color-space-oklch.js";
import { findClosestRAL, getRalQualityLabel } from "../color-matching-ral.js";

const POLAROID_CARD_ASPECT_RATIO = 1.22;
const DEFAULT_POLAROID_PHOTO_ASPECT_RATIO = 4 / 3;
const POLAROID_RENDER_MAX_WIDTH = 1600;
const POLAROID_RENDER_SCALE = 1;
const POLAROID_RENDER_QUALITY = 0.95;
const LEGACY_MIN_PALETTE_PANEL_HEIGHT = 40;
const POLAROID_COLOR_TOKEN_NAMES = Object.freeze({
  footerDark: "--color-polaroid-footer-dark",
  footerLight: "--color-polaroid-footer-light",
  footerTextDark: "--color-polaroid-footer-text-dark",
  footerTextLight: "--color-polaroid-footer-text-light",
  shellDark: "--color-polaroid-shell-dark",
  shellLight: "--color-polaroid-shell-light",
});
const POLAROID_CARD_RADIUS = 4;
const POLAROID_BRAND_FONT_LOAD = '400 16px "SNPro"';
const POLAROID_BRAND_FONT_FAMILY = '"SNPro", Arial, sans-serif';
const PREVIEW_IMAGE_LOAD_TIMEOUT_MS = 8000;
const PREVIEW_FONT_LOAD_TIMEOUT_MS = 1200;
const PREVIEW_CANVAS_TO_BLOB_TIMEOUT_MS = 4000;
const RAL_RETICLE_MIN_RADIUS = 8;
const RAL_RETICLE_MAX_RADIUS = 18;
const POLAROID_COLOR_NAME_MIN_FONT_SIZE = 10;
const POLAROID_COLOR_NAME_MAX_FONT_SIZE = 22;
const PALETTE_FALLBACK_COLORS = [{ r: 236, g: 231, b: 221 }];
const PREVIEW_IMAGE_TYPE_WEBP = "image/webp";
const PREVIEW_IMAGE_TYPE_JPEG = "image/jpeg";
let supportsWebpPreviewImages;
let cachedPolaroidColorTokens = null;

function getPalettePolaroidRenderSettings(palette) {
  if (palette?.polaroidRenderSettings && typeof palette.polaroidRenderSettings === "object") {
    return palette.polaroidRenderSettings;
  }

  const settings = getAppSettings();
  return {
    footerLabel: settings.polaroidFooterLabel,
    showColorNames: Boolean(settings.polaroidShowColorNames),
  };
}

function getBrandLabel(palette) {
  return getPalettePolaroidRenderSettings(palette).footerLabel;
}

function shouldShowColorNamesOnPolaroid(palette) {
  return Boolean(getPalettePolaroidRenderSettings(palette).showColorNames);
}

function canUseWebpPreviewImages() {
  try {
    const canvas = document?.createElement?.("canvas");
    if (!canvas || typeof canvas.toDataURL !== "function") {
      return true;
    }

    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL(PREVIEW_IMAGE_TYPE_WEBP).startsWith(`data:${PREVIEW_IMAGE_TYPE_WEBP}`);
  } catch (_error) {
    return true;
  }
}

export function getPalettePreviewImageMimeType() {
  supportsWebpPreviewImages ??= canUseWebpPreviewImages();
  return supportsWebpPreviewImages ? PREVIEW_IMAGE_TYPE_WEBP : PREVIEW_IMAGE_TYPE_JPEG;
}

export function resetPalettePreviewImageSupportForTests() {
  supportsWebpPreviewImages = undefined;
  cachedPolaroidColorTokens = null;
}

function getComputedStyleReader() {
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    return window.getComputedStyle.bind(window);
  }

  if (typeof globalThis.getComputedStyle === "function") {
    return globalThis.getComputedStyle.bind(globalThis);
  }

  return null;
}

function readRequiredRootToken(styles, tokenName) {
  const value = styles.getPropertyValue(tokenName).trim();

  if (!value) {
    throw new Error(`Missing required design token: ${tokenName}`);
  }

  return value;
}

function resolvePolaroidColorTokens() {
  if (cachedPolaroidColorTokens) {
    return cachedPolaroidColorTokens;
  }

  const rootElement = document?.documentElement;
  const readComputedStyle = getComputedStyleReader();

  if (!rootElement || !readComputedStyle) {
    throw new Error("Polaroid rendering requires document root styles to resolve design tokens");
  }

  const styles = readComputedStyle(rootElement);

  cachedPolaroidColorTokens = {
    footerDark: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.footerDark),
    footerLight: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.footerLight),
    footerTextDark: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.footerTextDark),
    footerTextLight: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.footerTextLight),
    shellDark: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.shellDark),
    shellLight: readRequiredRootToken(styles, POLAROID_COLOR_TOKEN_NAMES.shellLight),
  };
  return cachedPolaroidColorTokens;
}

function getPolaroidCardWidth(
  sourceImageWidth,
  {
    maxWidth = POLAROID_RENDER_MAX_WIDTH,
    minWidth = 320,
    scale = POLAROID_RENDER_SCALE,
  } = {},
) {
  return Math.max(
    minWidth,
    Math.round(Math.min(sourceImageWidth, maxWidth, sourceImageWidth * scale)),
  );
}

function loadImageFromBlob(blob) {
  if (!blob) {
    return Promise.reject(new Error("Missing image blob"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const photoUrl = URL.createObjectURL(blob);
    let settled = false;
    let released = false;

    const release = () => {
      if (released) {
        return;
      }

      released = true;
      URL.revokeObjectURL(photoUrl);
    };

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      clearTimeout(timeoutId);
    };

    const finalize = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    image.decoding = "async";
    image.onload = () => {
      finalize(() => resolve({ image, release }));
    };
    image.onerror = () => {
      finalize(() => {
        release();
        reject(new Error("Unable to load preview image"));
      });
    };
    const timeoutId = setTimeout(() => {
      image.src = "";
      finalize(() => {
        release();
        reject(new Error("Timed out loading preview image"));
      });
    }, PREVIEW_IMAGE_LOAD_TIMEOUT_MS);
    image.src = photoUrl;
  });
}

async function waitForBrandFont() {
  const fontLoader = document.fonts?.load;

  if (typeof fontLoader !== "function") {
    return;
  }

  await Promise.race([
    fontLoader.call(document.fonts, POLAROID_BRAND_FONT_LOAD).catch(() => undefined),
    new Promise((resolve) => {
      setTimeout(resolve, PREVIEW_FONT_LOAD_TIMEOUT_MS);
    }),
  ]);
}

export function hasPaletteMasterPhoto(palette) {
  return Boolean(
    palette?.photoBlob instanceof Blob ||
      palette?.previewViewerBlob instanceof Blob ||
      palette?.previewGalleryBlob instanceof Blob ||
      palette?.previewBlob instanceof Blob ||
      palette?.hasPhotoAsset,
  );
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

/**
 * @param {object} options
 * @param {CropRect | null} options.cropRect
 * @param {number} options.imageWidth
 * @param {number} options.imageHeight
 * @returns {PixelRect | null}
 */
export function resolveNormalizedCropRectToPixelRect({ cropRect, imageWidth, imageHeight }) {
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
    Math.min(imageWidth, Math.round((safeX + safeWidth) * imageWidth)),
  );
  const endY = Math.max(
    startY + 1,
    Math.min(imageHeight, Math.round((safeY + safeHeight) * imageHeight)),
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

function drawImageCover({ context, image, x, y, width, height, sourceRect = null }) {
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

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawPaletteStrip({ context, colors, x, y, width, height }) {
  const paletteColors =
    Array.isArray(colors) && colors.length > 0 ? colors : PALETTE_FALLBACK_COLORS;

  if (width <= 0 || height <= 0) {
    return;
  }

  paletteColors.forEach((color, index) => {
    const tileX = x + (width * index) / paletteColors.length;
    const nextTileX = x + (width * (index + 1)) / paletteColors.length;

    context.fillStyle = toRgbCss(color);
    context.fillRect(tileX, y, nextTileX - tileX, height);
  });
}

function drawPaletteStripColorNames({
  context,
  colors,
  colorNames,
  x,
  y,
  width,
  height,
  cardWidth,
}) {
  const paletteColors =
    Array.isArray(colors) && colors.length > 0 ? colors : PALETTE_FALLBACK_COLORS;

  if (width <= 0 || height <= 0 || !Array.isArray(colorNames) || colorNames.length === 0) {
    return;
  }

  context.save();
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  paletteColors.forEach((color, index) => {
    const label = String(colorNames[index] ?? "").trim();
    if (!label) {
      return;
    }

    const tileX = x + (width * index) / paletteColors.length;
    const nextTileX = x + (width * (index + 1)) / paletteColors.length;
    const tileWidth = nextTileX - tileX;
    const isLightBackground = relativeLuminance(color.r, color.g, color.b) > 0.179;
    const textColor = isLightBackground ? "rgba(20, 16, 12, 0.9)" : "rgba(255, 250, 244, 0.95)";
    const shadowColor = isLightBackground ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.28)";
    const paddingBottom = Math.max(8, Math.round(height * 0.08));
    const paddingX = paddingBottom;
    const anchorX = tileX + paddingX;
    const anchorY = y + height - paddingBottom;
    const maxLabelWidth = Math.max(24, height - (paddingBottom * 2));
    const maxFontSize = Math.max(
      POLAROID_COLOR_NAME_MIN_FONT_SIZE,
      Math.min(
        POLAROID_COLOR_NAME_MAX_FONT_SIZE,
        Math.round(Math.min(tileWidth * 0.24, cardWidth * 0.018)),
      ),
    );
    const fittedFontSize = fitTextToWidth(context, label.toUpperCase(), {
      maxWidth: maxLabelWidth,
      maxFontSize,
      minFontSize: POLAROID_COLOR_NAME_MIN_FONT_SIZE,
      fontWeight: 700,
    });

    context.save();
    context.translate(anchorX, anchorY);
    context.rotate(-Math.PI / 2);
    context.font = `700 ${fittedFontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
    context.fillStyle = textColor;
    context.shadowColor = shadowColor;
    context.shadowBlur = 1;
    context.fillText(label.toUpperCase(), 0, 0);
    context.restore();
  });

  context.restore();
}

function drawRalReticleOverlay({ context, x, y, width, height }) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radius = Math.max(
    RAL_RETICLE_MIN_RADIUS,
    Math.min(RAL_RETICLE_MAX_RADIUS, Math.round(Math.min(width, height) * 0.028)),
  );
  const strokeWidth = Math.max(1, Math.min(2, radius * 0.08));
  const crossInset = Math.max(1, strokeWidth / 2);
  const crossHalfLength = radius + crossInset;

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = strokeWidth;
  context.shadowColor = "rgba(0, 0, 0, 0.38)";
  context.shadowBlur = Math.max(2, radius * 0.6);

  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();

  context.shadowBlur = Math.max(1, radius * 0.2);

  context.beginPath();
  context.moveTo(centerX - crossHalfLength, centerY);
  context.lineTo(centerX + crossHalfLength, centerY);
  context.moveTo(centerX, centerY - crossHalfLength);
  context.lineTo(centerX, centerY + crossHalfLength);
  context.stroke();
  context.restore();
}

function getPaletteRalDetails(palette) {
  if (palette?.captureMode !== "ral") {
    return null;
  }

  const storedMatch =
    palette?.ralMatch && typeof palette.ralMatch === "object" ? palette.ralMatch : null;

  const hasStoredColor =
    Number.isFinite(storedMatch?.r) &&
    Number.isFinite(storedMatch?.g) &&
    Number.isFinite(storedMatch?.b);

  const fallbackColor = hasStoredColor
    ? storedMatch
    : Array.isArray(palette?.colors) && palette.colors.length > 0
      ? palette.colors[0]
      : null;

  if (!fallbackColor) {
    return null;
  }

  const match = findClosestRAL(fallbackColor.r, fallbackColor.g, fallbackColor.b, 1)[0] ?? null;
  if (!match && !hasStoredColor) {
    return null;
  }

  return {
    code:
      typeof storedMatch?.code === "string" && storedMatch.code.trim()
        ? storedMatch.code
        : (match?.ral.code ?? ""),
    name:
      typeof storedMatch?.name === "string" && storedMatch.name.trim()
        ? storedMatch.name
        : (match?.ral.name ?? ""),
    r: hasStoredColor ? storedMatch.r : (match?.ral.r ?? fallbackColor.r),
    g: hasStoredColor ? storedMatch.g : (match?.ral.g ?? fallbackColor.g),
    b: hasStoredColor ? storedMatch.b : (match?.ral.b ?? fallbackColor.b),
    deltaE: Number.isFinite(storedMatch?.deltaE) ? storedMatch.deltaE : (match?.deltaE ?? null),
  };
}

function fitTextToWidth(context, text, { maxWidth, maxFontSize, minFontSize, fontWeight } = {}) {
  let fontSize = Math.max(minFontSize, maxFontSize);

  for (; fontSize > minFontSize; fontSize -= 1) {
    context.font = `${fontWeight} ${fontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
    if (context.measureText(text).width <= maxWidth) {
      return fontSize;
    }
  }

  context.font = `${fontWeight} ${minFontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
  return minFontSize;
}

function drawRalStripCaption({ context, palette, x, y, width, height, cardWidth }) {
  const ralDetails = getPaletteRalDetails(palette);
  if (!ralDetails || width <= 0 || height <= 0) {
    return;
  }

  const isLightBackground = relativeLuminance(ralDetails.r, ralDetails.g, ralDetails.b) > 0.179;
  const codeText = String(ralDetails.code ?? "")
    .trim()
    .toUpperCase();
  const nameText = String(ralDetails.name ?? "")
    .trim()
    .toUpperCase();
  const qualityText = String(getRalQualityLabel(ralDetails.deltaE) ?? "")
    .trim()
    .toUpperCase();
  const primaryColor = isLightBackground ? "rgba(34, 28, 20, 0.92)" : "rgba(255, 250, 244, 0.94)";
  const secondaryColor = isLightBackground ? "rgba(34, 28, 20, 0.82)" : "rgba(255, 250, 244, 0.82)";
  const accentColor = isLightBackground ? "rgba(133, 95, 0, 0.96)" : "#ffc81a";
  const paddingX = Math.max(10, Math.round(cardWidth * 0.018));
  const paddingBottom = Math.max(8, Math.round(height * 0.055));
  const availableWidth = Math.max(48, width - paddingX * 2);
  const codeMaxFontSize = Math.max(8, Math.min(height * 0.085, cardWidth * 0.016));
  const nameMaxFontSize = Math.max(10, Math.min(height * 0.12, cardWidth * 0.022));
  const qualityMaxFontSize = Math.max(8, Math.min(height * 0.07, cardWidth * 0.014));

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  const codeFontSize = fitTextToWidth(context, codeText, {
    maxWidth: availableWidth,
    maxFontSize: Math.round(codeMaxFontSize),
    minFontSize: 8,
    fontWeight: 500,
  });
  const nameFontSize = fitTextToWidth(context, nameText, {
    maxWidth: availableWidth,
    maxFontSize: Math.round(nameMaxFontSize),
    minFontSize: 10,
    fontWeight: 700,
  });
  const qualityFontSize = fitTextToWidth(context, qualityText, {
    maxWidth: availableWidth,
    maxFontSize: Math.round(qualityMaxFontSize),
    minFontSize: 8,
    fontWeight: 500,
  });

  const gap = Math.max(2, Math.round(height * 0.02));
  const anchorX = x + paddingX;
  const qualityY = y + height - paddingBottom;
  const nameY = qualityY - qualityFontSize - gap;
  const codeY = nameY - nameFontSize - gap;

  context.font = `500 ${codeFontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
  context.fillStyle = secondaryColor;
  context.fillText(codeText, anchorX, codeY);

  context.font = `700 ${nameFontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
  context.fillStyle = primaryColor;
  context.fillText(nameText, anchorX, nameY);

  if (qualityText) {
    context.font = `500 ${qualityFontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
    context.fillStyle = accentColor;
    context.fillText(qualityText, anchorX, qualityY);
  }

  context.restore();
}

function addRoundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawBrandCaption({ context, label, x, y, width, height, cardWidth, footerTextColor }) {
  const safeLabel = label?.trim() || getBrandLabel();
  let fontSize = Math.max(16, Math.round(cardWidth * 0.045));

  context.save();
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (; fontSize >= 16; fontSize -= 1) {
    context.font = `600 ${fontSize}px ${POLAROID_BRAND_FONT_FAMILY}`;
    if (context.measureText(safeLabel).width <= width * 0.92) {
      break;
    }
  }

  context.letterSpacing = "-1px";
  context.fillStyle = footerTextColor;
  context.fillText(safeLabel, x + width, y + height * 0.58);
  context.restore();
}

function renderPolaroidCanvas({
  canvas,
  context,
  image,
  palette,
  colors,
  colorNames,
  brandLabel,
  photoAspectRatio = DEFAULT_POLAROID_PHOTO_ASPECT_RATIO,
  photoSourceRect = null,
  expandCardForLegacyRawAspect = false,
  darkFrameShell = false,
  maxWidth = POLAROID_RENDER_MAX_WIDTH,
  minWidth = 320,
  scale = POLAROID_RENDER_SCALE,
}) {
  const polaroidColors = resolvePolaroidColorTokens();
  const photoSourceWidth = photoSourceRect?.width ?? image.width;
  const cardWidth = getPolaroidCardWidth(photoSourceWidth, { maxWidth, minWidth, scale });
  const baseCardHeight = Math.round(cardWidth * POLAROID_CARD_ASPECT_RATIO);

  const frameSide = Math.max(16, Math.round(cardWidth * 0.055));
  const frameTop = Math.max(16, Math.round(cardWidth * 0.055));
  const frameBottom = Math.max(46, Math.round(cardWidth * 0.16));
  const innerX = frameSide;
  const innerY = frameTop;
  const innerWidth = cardWidth - frameSide * 2;

  const fallbackPhotoAspectRatio =
    (photoSourceRect?.width ?? image.width) / (photoSourceRect?.height ?? image.height) ||
    DEFAULT_POLAROID_PHOTO_ASPECT_RATIO;
  const safePhotoAspectRatio =
    Number.isFinite(photoAspectRatio) && photoAspectRatio > 0
      ? photoAspectRatio
      : fallbackPhotoAspectRatio;
  const preferredPhotoPanelHeight = Math.round(innerWidth / safePhotoAspectRatio);
  const baseInnerHeight = baseCardHeight - frameTop - frameBottom;
  const legacyMinPalettePanelHeight = expandCardForLegacyRawAspect
    ? Math.max(LEGACY_MIN_PALETTE_PANEL_HEIGHT, Math.round(cardWidth * 0.1))
    : 1;
  const innerHeight = Math.max(
    baseInnerHeight,
    preferredPhotoPanelHeight + legacyMinPalettePanelHeight,
  );
  const cardHeight = innerHeight + frameTop + frameBottom;

  canvas.width = cardWidth;
  canvas.height = cardHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, cardWidth, cardHeight);

  const availablePanelsHeight = Math.max(2, innerHeight);
  const photoPanelHeight = Math.max(
    1,
    Math.min(availablePanelsHeight - 1, preferredPhotoPanelHeight),
  );
  const palettePanelHeight = Math.max(1, availablePanelsHeight - photoPanelHeight);
  const photoPanelX = innerX;
  const photoPanelY = innerY;
  const palettePanelX = innerX;
  const palettePanelY = innerY + photoPanelHeight;

  context.save();
  addRoundedRectPath(context, 0, 0, cardWidth, cardHeight, POLAROID_CARD_RADIUS);
  context.clip();

  context.fillStyle = darkFrameShell ? polaroidColors.shellDark : polaroidColors.shellLight;
  context.fillRect(0, 0, cardWidth, cardHeight);

  context.fillStyle = darkFrameShell ? polaroidColors.footerDark : polaroidColors.footerLight;
  context.fillRect(0, innerY + innerHeight, cardWidth, frameBottom);

  drawImageCover({
    context,
    image,
    x: photoPanelX,
    y: photoPanelY,
    width: innerWidth,
    height: photoPanelHeight,
    sourceRect: photoSourceRect,
  });

  if (palette?.captureMode === "ral") {
    drawRalReticleOverlay({
      context,
      x: photoPanelX,
      y: photoPanelY,
      width: innerWidth,
      height: photoPanelHeight,
    });
  }

  drawPaletteStrip({
    context,
    colors,
    x: palettePanelX,
    y: palettePanelY,
    width: innerWidth,
    height: palettePanelHeight,
  });

  if (shouldShowColorNamesOnPolaroid(palette) && palette?.captureMode !== "ral") {
    drawPaletteStripColorNames({
      context,
      colors,
      colorNames,
      x: palettePanelX,
      y: palettePanelY,
      width: innerWidth,
      height: palettePanelHeight,
      cardWidth,
    });
  }

  drawRalStripCaption({
    context,
    palette,
    x: palettePanelX,
    y: palettePanelY,
    width: innerWidth,
    height: palettePanelHeight,
    cardWidth,
  });

  drawBrandCaption({
    context,
    label: brandLabel,
    x: innerX,
    y: innerY + innerHeight,
    width: innerWidth,
    height: frameBottom,
    cardWidth,
    footerTextColor: darkFrameShell
      ? polaroidColors.footerTextDark
      : polaroidColors.footerTextLight,
  });

  context.restore();
}

function canvasToBlob(
  canvas,
  { type = getPalettePreviewImageMimeType(), quality = POLAROID_RENDER_QUALITY } = {},
) {
  return new Promise((resolve) => {
    let settled = false;

    const finalize = (blob) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(blob || null);
    };

    const timeoutId = setTimeout(() => {
      finalize(null);
    }, PREVIEW_CANVAS_TO_BLOB_TIMEOUT_MS);

    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === type) {
          finalize(blob);
          return;
        }
        if (type !== PREVIEW_IMAGE_TYPE_JPEG) {
          canvas.toBlob((jpegBlob) => finalize(jpegBlob || null), PREVIEW_IMAGE_TYPE_JPEG, quality);
          return;
        }
        finalize(blob || null);
      },
      type,
      quality,
    );
  });
}

/**
 * @param {Palette} palette
 * @param {object} [options]
 * @param {boolean} [options.darkFrameShell]
 * @param {number} [options.maxWidth]
 * @param {number} [options.minWidth]
 * @param {number} [options.scale]
 * @param {number} [options.quality]
 * @returns {Promise<Blob | null>}
 */
export async function renderPalettePolaroidBlob(
  palette,
  {
    darkFrameShell = false,
    maxWidth = POLAROID_RENDER_MAX_WIDTH,
    minWidth = 320,
    scale = POLAROID_RENDER_SCALE,
    quality = POLAROID_RENDER_QUALITY,
  } = {},
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !(palette?.photoBlob instanceof Blob)) {
    return null;
  }

  const { image, release } = await loadImageFromBlob(palette.photoBlob);

  try {
    await waitForBrandFont();
    const colorNames = shouldShowColorNamesOnPolaroid(palette)
      ? Array.isArray(palette?.polaroidColorNames)
        ? palette.polaroidColorNames
        : await getColorNames(Array.isArray(palette?.colors) ? palette.colors : [])
      : [];

    renderPolaroidCanvas({
      canvas,
      context,
      image,
      palette,
      colors: palette.colors,
      colorNames,
      brandLabel: getBrandLabel(palette),
      photoAspectRatio: getPalettePhotoAspectRatioValue(palette),
      photoSourceRect: resolvePalettePhotoSourceRect(image, palette),
      expandCardForLegacyRawAspect: !palette?.captureAspectRatio && !palette?.captureCropRect,
      darkFrameShell,
      maxWidth,
      minWidth,
      scale,
    });

    return canvasToBlob(canvas, {
      type: getPalettePreviewImageMimeType(),
      quality,
    });
  } finally {
    release();
  }
}
