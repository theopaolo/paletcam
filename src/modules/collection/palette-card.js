import { deletePalette } from "../../palette-storage.js";
import { toRgbCss } from "../color-format.js";
import { showToast, showUndoToast } from "../toast-ui.js";

const EXPORT_BRAND_LABEL_FALLBACK = "Colors Catchers";
const POLAROID_EXPORT_ASPECT_RATIO = 1.22;
const POLAROID_PREVIEW_MAX_WIDTH = 1080;
const POLAROID_PREVIEW_SCALE = 0.78;
const POLAROID_PREVIEW_QUALITY = 0.9;
const POLAROID_EXPORT_MAX_WIDTH = 1600;
const POLAROID_EXPORT_SCALE = 1;
const POLAROID_EXPORT_QUALITY = 0.95;
const POLAROID_FRAME_SHELL_LIGHT = "#ffffff";
const POLAROID_FRAME_SHELL_DARK = "#101214";
const POLAROID_FRAME_FOOTER_LIGHT = "#f7f7f7";
const POLAROID_FRAME_FOOTER_DARK = "#101214";
const POLAROID_FOOTER_TEXT_LIGHT = "rgba(34, 34, 34, 0.9)";
const POLAROID_FOOTER_TEXT_DARK = "rgba(255, 255, 255, 0.94)";
const PREVIEW_OBSERVER_ROOT_MARGIN = "220px 0px";

const previewAssetCache = new Map();
let previewRenderQueue = Promise.resolve();
let paletteViewerOverlayController;

function getBrandLabel() {
  return document.querySelector(".colorscatcher")?.textContent?.trim()
    || EXPORT_BRAND_LABEL_FALLBACK;
}

function getPolaroidCardWidth(
  sourceImageWidth,
  { maxWidth = POLAROID_EXPORT_MAX_WIDTH, scale = POLAROID_EXPORT_SCALE } = {},
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
  darkFrameShell = false,
  maxWidth = POLAROID_EXPORT_MAX_WIDTH,
  scale = POLAROID_EXPORT_SCALE,
}) {
  const cardWidth = getPolaroidCardWidth(image.width, { maxWidth, scale });
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

function canvasToBlob(canvas, { type = "image/webp", quality = 0.92 } = {}) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || null),
      type,
      quality,
    );
  });
}

async function renderPaletteImageBlob(
  palette,
  {
    darkFrameShell = false,
    maxWidth = POLAROID_EXPORT_MAX_WIDTH,
    scale = POLAROID_EXPORT_SCALE,
    quality = POLAROID_EXPORT_QUALITY,
  } = {},
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !palette.photoBlob) {
    return null;
  }

  const image = await loadImageFromBlob(palette.photoBlob);

  renderPolaroidCanvas({
    canvas,
    context,
    image,
    colors: palette.colors,
    brandLabel: getBrandLabel(),
    darkFrameShell,
    maxWidth,
    scale,
  });

  const blob = await canvasToBlob(canvas, {
    type: "image/webp",
    quality,
  });

  return blob;
}

function downloadBlob(blob, filename) {
  if (!blob) {
    return false;
  }

  const link = document.createElement("a");
  const downloadUrl = URL.createObjectURL(blob);

  link.download = filename;
  link.href = downloadUrl;
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 0);

  return true;
}

function enqueuePreviewRender(task) {
  const runTask = previewRenderQueue.catch(() => undefined).then(task);
  previewRenderQueue = runTask.catch(() => undefined);
  return runTask;
}

async function getPalettePreviewAsset(palette) {
  if (!palette?.photoBlob) {
    throw new Error("Missing palette photo");
  }

  const cacheKey = String(palette.id);
  const cached = previewAssetCache.get(cacheKey);

  if (cached?.blob && cached?.objectUrl) {
    return cached;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = enqueuePreviewRender(async () => {
    const blob = await renderPaletteImageBlob(palette, {
      maxWidth: POLAROID_PREVIEW_MAX_WIDTH,
      scale: POLAROID_PREVIEW_SCALE,
      quality: POLAROID_PREVIEW_QUALITY,
    });

    if (!blob) {
      throw new Error("Unable to generate palette preview");
    }

    const asset = {
      blob,
      objectUrl: URL.createObjectURL(blob),
    };

    previewAssetCache.set(cacheKey, asset);
    return asset;
  }).catch((error) => {
    if (previewAssetCache.get(cacheKey)?.promise === promise) {
      previewAssetCache.delete(cacheKey);
    }
    throw error;
  });

  previewAssetCache.set(cacheKey, { promise });
  return promise;
}

function disposePalettePreviewAsset(paletteId) {
  const cacheKey = String(paletteId);
  const cached = previewAssetCache.get(cacheKey);

  if (cached?.objectUrl) {
    URL.revokeObjectURL(cached.objectUrl);
  }

  previewAssetCache.delete(cacheKey);
}

async function exportPaletteAsImage(palette) {
  try {
    const blob = await renderPaletteImageBlob(palette, {
      maxWidth: POLAROID_EXPORT_MAX_WIDTH,
      scale: POLAROID_EXPORT_SCALE,
      quality: POLAROID_EXPORT_QUALITY,
    });

    if (!blob) {
      return false;
    }

    return downloadBlob(blob, `palette-${palette.id}.webp`);
  } catch (error) {
    console.error("Failed to render export image:", error);
    return false;
  }
}

async function sharePaletteImage(palette) {
  if (!navigator.share || typeof File !== "function") {
    return { status: "unsupported" };
  }

  try {
    const asset = await getPalettePreviewAsset(palette);
    const file = new File([asset.blob], `palette-${palette.id}.webp`, {
      type: asset.blob.type || "image/webp",
      lastModified: Date.now(),
    });

    const shareData = {
      files: [file],
      title: "Palette",
    };

    if (navigator.canShare) {
      try {
        if (!navigator.canShare({ files: [file] })) {
          return { status: "unsupported" };
        }
      } catch (_error) {
        return { status: "unsupported" };
      }
    }

    await navigator.share(shareData);
    return { status: "shared" };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: "cancelled" };
    }

    console.error("Failed to share palette image:", error);
    return { status: "error" };
  }
}

function getIconMarkup(iconName) {
  if (iconName === "export") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"></path>
      </svg>
    `;
  }

  if (iconName === "share") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#000000" viewBox="0 0 256 256"><path d="M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z"></path></svg>
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

function createPaletteViewerOverlayController() {
  const overlay = document.createElement("div");
  overlay.className = "palette-viewer-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const topbar = document.createElement("div");
  topbar.className = "palette-viewer-topbar";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "palette-viewer-close";
  closeButton.setAttribute("aria-label", "Fermer l'aperçu");
  closeButton.textContent = "×";

  const imageFrame = document.createElement("div");
  imageFrame.className = "palette-viewer-frame";

  const image = document.createElement("img");
  image.className = "palette-viewer-image";
  image.alt = "Aperçu de palette";
  image.hidden = true;
  image.decoding = "async";

  const status = document.createElement("p");
  status.className = "palette-viewer-status";

  const actions = document.createElement("div");
  actions.className = "palette-viewer-actions";

  const shareButton = createQuickActionButton({
    className: "palette-action-share",
    label: "Partager la palette",
    iconName: "share",
    visibleLabel: "partager",
  });
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

  topbar.append(closeButton);
  imageFrame.append(image, status);
  actions.append(shareButton, exportButton, deleteButton);
  overlay.append(topbar, imageFrame, actions);
  document.body.append(overlay);

  let activeRequestId = 0;
  let activeSession;
  let isBusy = false;

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    shareButton.disabled = nextBusy || !activeSession?.canShare;
    exportButton.disabled = nextBusy || !activeSession?.canExport;
    deleteButton.disabled = nextBusy || !activeSession?.canDelete;
    overlay.classList.toggle("is-busy", nextBusy);
  }

  function close() {
    activeRequestId += 1;
    activeSession = undefined;
    image.hidden = true;
    image.removeAttribute("src");
    status.textContent = "";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    setBusy(false);
  }

  async function runAction(actionName) {
    if (isBusy || !activeSession) {
      return;
    }

    const action = activeSession[actionName];
    if (typeof action !== "function") {
      return;
    }

    setBusy(true);
    try {
      await action();
    } finally {
      if (activeSession) {
        setBusy(false);
      }
    }
  }

  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    close();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  imageFrame.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  [topbar, actions].forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || overlay.hidden) {
      return;
    }

    event.preventDefault();
    close();
  });

  shareButton.addEventListener("click", () => {
    void runAction("onShare");
  });
  exportButton.addEventListener("click", () => {
    void runAction("onExport");
  });
  deleteButton.addEventListener("click", () => {
    void runAction("onDelete");
  });

  return {
    close,
    isOpen() {
      return !overlay.hidden;
    },
    async open({
      getPreviewAsset,
      onShare,
      onExport,
      onDelete,
      canShare = true,
      canExport = true,
      canDelete = true,
    }) {
      activeRequestId += 1;
      const requestId = activeRequestId;

      activeSession = {
        onShare,
        onExport,
        onDelete,
        canShare,
        canExport,
        canDelete,
      };

      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      image.hidden = true;
      image.removeAttribute("src");
      status.textContent = canExport ? "Chargement..." : "Aperçu indisponible";
      setBusy(false);

      if (!canExport || typeof getPreviewAsset !== "function") {
        return;
      }

      try {
        const asset = await getPreviewAsset();
        if (requestId !== activeRequestId || !activeSession) {
          return;
        }

        image.src = asset.objectUrl;
        image.hidden = false;
        status.textContent = "";
      } catch (error) {
        if (requestId !== activeRequestId || !activeSession) {
          return;
        }

        status.textContent = "Aperçu indisponible";
        console.error("Failed to load palette viewer preview:", error);
      }
    },
  };
}

function getPaletteViewerOverlayController() {
  paletteViewerOverlayController ??= createPaletteViewerOverlayController();
  return paletteViewerOverlayController;
}

export function closePaletteViewerOverlay() {
  paletteViewerOverlayController?.close();
}

export function createPaletteCard({
  palette,
  pendingDeletionIds,
  deleteUndoDurationMs,
  takeCardPositionSnapshot,
  restoreCardFromSnapshot,
  syncSessionStateFromCardContainer,
  ensureEmptyMessage,
}) {
  const card = document.createElement("div");
  card.className = "palette-card";
  card.dataset.paletteId = String(palette.id);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "palette-card-trigger";
  trigger.setAttribute("aria-label", "Ouvrir la capture");

  const previewImage = document.createElement("img");
  previewImage.className = "palette-card-image";
  previewImage.alt = "Aperçu polaroid";
  previewImage.loading = "lazy";
  previewImage.decoding = "async";
  previewImage.hidden = true;

  const previewStatus = document.createElement("p");
  previewStatus.className = "palette-card-status";
  previewStatus.textContent = palette.photoBlob ? "Chargement..." : "Aperçu indisponible";

  trigger.append(previewImage, previewStatus);
  card.append(trigger);

  let previewLoadPromise;
  let hasStartedPreviewLoad = false;
  let hasPreviewLoadFailed = false;

  const ensurePreviewAsset = () => {
    if (!palette.photoBlob) {
      return Promise.reject(new Error("Missing palette photo"));
    }

    previewLoadPromise ??= getPalettePreviewAsset(palette);
    return previewLoadPromise;
  };

  const loadPreviewIntoCard = async () => {
    if (hasPreviewLoadFailed || !palette.photoBlob) {
      return;
    }

    try {
      const asset = await ensurePreviewAsset();
      if (!card.isConnected) {
        return;
      }

      previewImage.src = asset.objectUrl;
      previewImage.hidden = false;
      previewStatus.textContent = "";
    } catch (error) {
      if (!card.isConnected) {
        return;
      }

      previewLoadPromise = undefined;
      hasPreviewLoadFailed = true;
      previewStatus.textContent = "Aperçu indisponible";
      console.error(`Failed to render preview for palette ${palette.id}:`, error);
    }
  };

  const startPreviewLoad = () => {
    if (hasStartedPreviewLoad) {
      return;
    }

    hasStartedPreviewLoad = true;
    void loadPreviewIntoCard();
  };

  const handleExportAction = async () => {
    const exported = await exportPaletteAsImage(palette);
    showToast(exported ? "Palette exportee" : "Export echoue", {
      variant: exported ? "default" : "error",
      duration: exported ? 1400 : 1800,
    });
  };

  const handleShareAction = async () => {
    const result = await sharePaletteImage(palette);

    if (result.status === "shared") {
      showToast("Palette partagee", {
        duration: 1400,
      });
      return;
    }

    if (result.status === "cancelled") {
      return;
    }

    if (result.status === "unsupported") {
      const exported = await exportPaletteAsImage(palette);
      showToast(exported ? "Partage indisponible, export lance" : "Partage indisponible", {
        variant: exported ? "default" : "error",
        duration: exported ? 1800 : 2000,
      });
      return;
    }

    showToast("Partage echoue", {
      variant: "error",
      duration: 1800,
    });
  };

  const handleDeleteAction = () => {
    if (pendingDeletionIds.has(palette.id)) {
      return;
    }

    closePaletteViewerOverlay();
    pendingDeletionIds.add(palette.id);
    const snapshot = takeCardPositionSnapshot(card);

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
          disposePalettePreviewAsset(palette.id);
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

  const openViewer = async () => {
    if (pendingDeletionIds.has(palette.id)) {
      return;
    }

    startPreviewLoad();
    const viewer = getPaletteViewerOverlayController();

    await viewer.open({
      getPreviewAsset: palette.photoBlob ? ensurePreviewAsset : undefined,
      canShare: Boolean(palette.photoBlob),
      canExport: Boolean(palette.photoBlob),
      canDelete: true,
      onShare: handleShareAction,
      onExport: handleExportAction,
      onDelete: async () => {
        handleDeleteAction();
      },
    });
  };

  trigger.addEventListener("click", () => {
    void openViewer();
  });

  if (palette.photoBlob) {
    if (window.IntersectionObserver) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }

          observer.disconnect();
          startPreviewLoad();
        },
        { rootMargin: PREVIEW_OBSERVER_ROOT_MARGIN },
      );

      observer.observe(card);
    } else {
      startPreviewLoad();
    }
  }

  return card;
}
