import { deletePalette } from "../../palette-storage.js";
import { toRgbCss } from "../color-format.js";
import { showToast, showUndoToast } from "../toast-ui.js";

const EXPORT_BRAND_LABEL_FALLBACK = "Colors Catchers";
const POLAROID_EXPORT_ASPECT_RATIO = 1.22;
const POLAROID_EXPORT_MAX_WIDTH = 920;
const POLAROID_EXPORT_SCALE = 0.72;
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

function getPolaroidCardWidth(sourceImageWidth) {
  return Math.max(
    320,
    Math.round(
      Math.min(
        sourceImageWidth,
        POLAROID_EXPORT_MAX_WIDTH,
        sourceImageWidth * POLAROID_EXPORT_SCALE,
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

function _strokeRoundedRect(context, x, y, width, height, radius) {
  traceRoundedRectPath(context, x, y, width, height, radius);
  context.stroke();
}

function drawImageCover({ context, image, x, y, width, height, radius }) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const sourceAspectRatio = image.width / image.height;
  const targetAspectRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;

  if (sourceAspectRatio > targetAspectRatio) {
    sourceHeight = image.height;
    sourceWidth = sourceHeight * targetAspectRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceWidth = image.width;
    sourceHeight = sourceWidth / targetAspectRatio;
    sourceY = (image.height - sourceHeight) * 0.45;
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

function drawPaletteGrid({
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

  // Render swatches as a single row that fills the entire palette panel.
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

function renderPolaroidExportCanvas({
  canvas,
  context,
  image,
  colors,
  brandLabel,
  darkFrameShell = false,
}) {
  const cardWidth = getPolaroidCardWidth(image.width);
  const cardHeight = Math.round(cardWidth * POLAROID_EXPORT_ASPECT_RATIO);

  canvas.width = cardWidth;
  canvas.height = cardHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const outerRadius = 0;
  const frameSide = Math.max(16, Math.round(cardWidth * 0.055));
  const frameTop = Math.max(16, Math.round(cardWidth * 0.055));
  const frameBottom = Math.max(46, Math.round(cardWidth * 0.16));
  const innerX = frameSide;
  const innerY = frameTop;
  const innerWidth = cardWidth - (frameSide * 2);
  const innerHeight = cardHeight - frameTop - frameBottom;

  const panelGap = 0;
  const photoPanelHeight = Math.floor((innerHeight - panelGap) * 0.5);
  const palettePanelHeight = Math.max(1, innerHeight - panelGap - photoPanelHeight);
  const photoPanelX = innerX;
  const photoPanelY = innerY;
  const palettePanelX = innerX;
  const palettePanelY = innerY + photoPanelHeight + panelGap;
  const panelRadius = 0;

  context.fillStyle = darkFrameShell
    ? POLAROID_FRAME_SHELL_DARK
    : POLAROID_FRAME_SHELL_LIGHT;
  fillRoundedRect(context, 0, 0, cardWidth, cardHeight, outerRadius);

  // Footer strip (caption area) uses a super-light gray, while the rest stays white.
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
  });

  drawPaletteGrid({
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

  return { width: cardWidth, height: cardHeight };
}

function getIconMarkup(iconName) {
  if (iconName === "export") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"></path>
    </svg>
  `;
}

function createQuickActionButton({ className, label, iconName, visibleLabel }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `palette-quick-action ${className}`;
  button.setAttribute("aria-label", label);
  button.innerHTML = `
    ${getIconMarkup(iconName)}
    ${
    visibleLabel
      ? `<span class="palette-quick-action-label">${visibleLabel}</span>`
      : ""
  }
  `;
  return button;
}

function createSwipeHandle() {
  const handle = document.createElement("span");
  handle.className = "palette-swipe-handle";
  handle.setAttribute("aria-hidden", "true");
  handle.innerHTML = `
    <svg viewBox="0 0 14 18" focusable="false">
      <circle cx="4" cy="4" r="1.1"></circle>
      <circle cx="10" cy="4" r="1.1"></circle>
      <circle cx="4" cy="9" r="1.1"></circle>
      <circle cx="10" cy="9" r="1.1"></circle>
      <circle cx="4" cy="14" r="1.1"></circle>
      <circle cx="10" cy="14" r="1.1"></circle>
    </svg>
  `;
  return handle;
}

async function exportPaletteAsImage(palette, { darkFrameShell = false } = {}) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !palette.photoBlob) {
    return false;
  }

  try {
    const image = await loadImageFromBlob(palette.photoBlob);

    renderPolaroidExportCanvas({
      canvas,
      context,
      image,
      colors: palette.colors,
      brandLabel: getBrandLabel(),
      darkFrameShell,
    });
  } catch (error) {
    console.error("Failed to render export image:", error);
    return false;
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(false);
          return;
        }

        const link = document.createElement("a");
        const downloadUrl = URL.createObjectURL(blob);
        link.download = `palette-${palette.id}.webp`;
        link.href = downloadUrl;
        link.click();

        window.setTimeout(() => {
          URL.revokeObjectURL(downloadUrl);
        }, 0);
        resolve(true);
      },
      "image/webp",
      0.95,
    );
  });
}

function createPhotoSwatch(palette) {
  if (!palette.photoBlob) {
    return null;
  }

  const photoSwatch = document.createElement("div");
  const photoUrl = URL.createObjectURL(palette.photoBlob);

  photoSwatch.className = "color-swatch photo-swatch";
  photoSwatch.style.backgroundImage = `url(${photoUrl})`;
  photoSwatch.style.backgroundSize = "cover";
  photoSwatch.style.backgroundPosition = "center";
  photoSwatch.setAttribute("role", "button");
  photoSwatch.setAttribute("tabindex", "0");
  photoSwatch.setAttribute("aria-label", "Ouvrir l'apercu de l'export");
  photoSwatch.classList.add("is-preview-trigger");

  return photoSwatch;
}

function createColorSwatch(color) {
  const swatch = document.createElement("div");

  swatch.className = "color-swatch";
  swatch.style.backgroundColor = toRgbCss(color);

  return swatch;
}

export function createPaletteCard({
  palette,
  createSwipeController,
  pendingDeletionIds,
  deleteUndoDurationMs,
  takeCardPositionSnapshot,
  restoreCardFromSnapshot,
  syncSessionStateFromCardContainer,
  clearActiveSwipeController,
  ensureEmptyMessage,
}) {
  const card = document.createElement("div");
  card.className = "palette-card";
  card.dataset.paletteId = String(palette.id);

  const swatchesContainer = document.createElement("div");
  swatchesContainer.className = "palette-swatches";

  const photoSwatch = createPhotoSwatch(palette);
  if (photoSwatch) {
    swatchesContainer.appendChild(photoSwatch);
  }

  palette.colors.forEach((color) => {
    swatchesContainer.appendChild(createColorSwatch(color));
  });

  const rightActions = document.createElement("div");
  rightActions.className = "palette-action-lane palette-action-lane-right";

  const track = document.createElement("div");
  track.className = "palette-track";
  const inlinePreview = document.createElement("div");
  inlinePreview.className = "palette-inline-preview";
  inlinePreview.hidden = true;

  const inlinePreviewCanvas = document.createElement("canvas");
  inlinePreviewCanvas.className = "palette-inline-preview-canvas";
  inlinePreviewCanvas.hidden = true;
  inlinePreviewCanvas.setAttribute("role", "button");
  inlinePreviewCanvas.setAttribute("tabindex", "0");
  inlinePreviewCanvas.setAttribute("aria-label", "Basculer le cadre du polaroid");

  const inlinePreviewStatus = document.createElement("p");
  inlinePreviewStatus.className = "palette-inline-preview-status";

  const inlinePreviewActions = document.createElement("div");
  inlinePreviewActions.className = "palette-inline-preview-actions";

  const swipeHandle = createSwipeHandle();
  const exportButton = createQuickActionButton({
    className: "palette-action-export",
    label: "Exporter la palette",
    iconName: "export",
    visibleLabel: "exporter",
  });
  const deleteButton = createQuickActionButton({
    className: "palette-action-delete",
    label: "Supprimer la palette",
    iconName: "delete",
    visibleLabel: "supprimer",
  });
  const inlineExportButton = createQuickActionButton({
    className: "palette-action-export palette-inline-preview-action",
    label: "Exporter la palette",
    iconName: "export",
    visibleLabel: "exporter",
  });
  const inlineDeleteButton = createQuickActionButton({
    className: "palette-action-delete palette-inline-preview-action",
    label: "Supprimer la palette",
    iconName: "delete",
    visibleLabel: "supprimer",
  });

  inlinePreviewActions.append(inlineExportButton, inlineDeleteButton);
  inlinePreview.append(inlinePreviewCanvas, inlinePreviewStatus, inlinePreviewActions);
  track.append(swatchesContainer, inlinePreview, swipeHandle);

  const swipeController = createSwipeController({ card, track });
  let darkFrameShell = false;

  const handleExportAction = async (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    const exported = await exportPaletteAsImage(palette, { darkFrameShell });
    showToast(exported ? "Palette exportee" : "Export echoue", {
      variant: exported ? "default" : "error",
      duration: exported ? 1400 : 1800,
    });
    swipeController.close();
  };

  const handleDeleteAction = (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (pendingDeletionIds.has(palette.id)) {
      return;
    }

    pendingDeletionIds.add(palette.id);
    const snapshot = takeCardPositionSnapshot(card);

    clearActiveSwipeController(swipeController);
    card.remove();
    syncSessionStateFromCardContainer(snapshot.parent);

    showUndoToast("Palette supprimee", {
      duration: deleteUndoDurationMs,
      onUndo: () => {
        pendingDeletionIds.delete(palette.id);
        restoreCardFromSnapshot(card, snapshot);
      },
      onExpire: async () => {
        try {
          await deletePalette(palette.id);
          pendingDeletionIds.delete(palette.id);
          ensureEmptyMessage();
        } catch (error) {
          console.error(`Failed to delete palette ${palette.id}:`, error);
          pendingDeletionIds.delete(palette.id);
          restoreCardFromSnapshot(card, snapshot);
          showToast("Suppression echouee", {
            variant: "error",
            duration: 1800,
          });
        }
      },
    });
  };

  [inlineExportButton, inlineDeleteButton].forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
  });

  if (photoSwatch) {
    let inlinePreviewRequestId = 0;
    let previewImagePromise;
    let previewImage;

    const renderInlinePreviewPolaroid = (image) => {
      const previewContext = inlinePreviewCanvas.getContext("2d");
      if (!previewContext) {
        throw new Error("Canvas context unavailable");
      }

      renderPolaroidExportCanvas({
        canvas: inlinePreviewCanvas,
        context: previewContext,
        image,
        colors: palette.colors,
        brandLabel: getBrandLabel(),
        darkFrameShell,
      });
    };

    const toggleInlinePreview = async (event) => {
      if (swipeController.isOpen()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!inlinePreview.hidden) {
        inlinePreviewRequestId += 1;
        inlinePreview.hidden = true;
        inlinePreview.classList.remove("is-loading");
        photoSwatch.classList.remove("is-preview-open");
        return;
      }

      inlinePreview.hidden = false;
      inlinePreview.classList.add("is-loading");
      inlinePreviewCanvas.hidden = true;
      inlinePreviewStatus.textContent = "Apercu...";
      photoSwatch.classList.add("is-preview-open");

      const requestId = ++inlinePreviewRequestId;

      try {
        previewImagePromise ??= loadImageFromBlob(palette.photoBlob);
        const image = await previewImagePromise;
        previewImage = image;

        if (requestId !== inlinePreviewRequestId) {
          return;
        }

        renderInlinePreviewPolaroid(image);

        if (document.fonts?.ready) {
          void document.fonts.ready.then(() => {
            if (requestId !== inlinePreviewRequestId || inlinePreview.hidden) {
              return;
            }

            renderInlinePreviewPolaroid(image);
          });
        }

        inlinePreviewCanvas.hidden = false;
        inlinePreviewStatus.textContent = "";
        inlinePreview.classList.remove("is-loading");
      } catch (error) {
        if (requestId !== inlinePreviewRequestId) {
          return;
        }

        inlinePreviewStatus.textContent = "Apercu indisponible";
        inlinePreview.classList.remove("is-loading");
        console.error("Failed to render inline palette preview:", error);
      }
    };

    photoSwatch.addEventListener("click", (event) => {
      void toggleInlinePreview(event);
    });
    photoSwatch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      void toggleInlinePreview(event);
    });

    inlinePreviewCanvas.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    const toggleFrameTone = (event) => {
      if (inlinePreview.hidden || inlinePreviewCanvas.hidden || !previewImage) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      darkFrameShell = !darkFrameShell;
      renderInlinePreviewPolaroid(previewImage);
    };

    inlinePreviewCanvas.addEventListener("click", toggleFrameTone);
    inlinePreviewCanvas.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      toggleFrameTone(event);
    });
  }

  exportButton.addEventListener("click", (event) => {
    void handleExportAction(event);
  });
  inlineExportButton.addEventListener("click", (event) => {
    void handleExportAction(event);
  });

  deleteButton.addEventListener("click", (event) => {
    handleDeleteAction(event);
  });
  inlineDeleteButton.addEventListener("click", (event) => {
    handleDeleteAction(event);
  });

  rightActions.append(exportButton, deleteButton);
  card.append(rightActions, track);

  return card;
}
