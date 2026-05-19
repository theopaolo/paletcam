import { getPalettePublicationMeta } from "../../community-service.js";
import { t } from "../../i18n.js";
import { blobToDataUrl, loadImageElementSource } from "../image-element-loader.js";
import { reportAppError } from "../error-reporting.js";
import {
  getPaletteGalleryPreviewAsset,
  getPalettePreviewDebugInfo,
  refreshPaletteGalleryAsset,
} from "./palette-preview-assets.js";

const PREVIEW_OBSERVER_ROOT_MARGIN = "500px 0px";
const SWATCH_PREVIEW_OBSERVER_ROOT_MARGIN = "40px 0px";
const MAX_CONCURRENT_PREVIEW_LOADS = 3;
const LAZY_PREVIEW_SETTLE_MS = 120;

function createSelectionIndicator() {
  const el = document.createElement("span");
  el.className = "palette-card-select-indicator";
  el.setAttribute("aria-hidden", "true");
  return el;
}

function createPublicationBadge(palette) {
  const badge = document.createElement("span");
  badge.className = "palette-card-publication-badge panel-status-chip";
  const meta = getPalettePublicationMeta(palette);
  if (meta) {
    badge.hidden = false;
    badge.dataset.tone = meta.tone;
    badge.textContent = meta.label;
  } else {
    badge.hidden = true;
  }
  return badge;
}
let nextPreviewLoadOrder = 0;
const pendingPreviewStarts = [];
let hasScheduledPreviewFlush = false;
let activePreviewLoadCount = 0;

function isCardConnected(card) {
  return card.isConnected !== false;
}

function schedulePreviewFlush() {
  if (hasScheduledPreviewFlush) {
    return;
  }

  hasScheduledPreviewFlush = true;

  const schedule =
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 0);

  schedule(() => {
    flushPendingPreviewStarts();
  });
}

function flushPendingPreviewStarts() {
  hasScheduledPreviewFlush = false;

  pendingPreviewStarts.sort((first, second) => first.order - second.order);

  while (
    activePreviewLoadCount < MAX_CONCURRENT_PREVIEW_LOADS &&
    pendingPreviewStarts.length > 0
  ) {
    const queuedStart = pendingPreviewStarts.shift();
    activePreviewLoadCount += 1;

    Promise.resolve(queuedStart.start()).finally(() => {
      activePreviewLoadCount = Math.max(0, activePreviewLoadCount - 1);

      if (pendingPreviewStarts.length > 0) {
        schedulePreviewFlush();
      }
    });
  }

  if (
    pendingPreviewStarts.length > 0 &&
    activePreviewLoadCount < MAX_CONCURRENT_PREVIEW_LOADS
  ) {
    schedulePreviewFlush();
  }
}

function schedulePreviewStart(start, order) {
  pendingPreviewStarts.push({ start, order });

  schedulePreviewFlush();
}

function bindLazyPreviewLoad({
  card,
  observeTarget = card,
  palette = null,
  trigger,
  previewImage,
  previewLoader,
  scrollRoot,
  getAsset,
  onOpenViewer,
  paletteId,
  rootMargin = PREVIEW_OBSERVER_ROOT_MARGIN,
}) {
  let previewAssetPromise;
  let hasStartedPreviewLoad = false;
  let hasQueuedPreviewLoad = false;
  let isPreviewIntersecting = false;
  let previewSettleTimeout = 0;
  let observer = null;
  let hasRetriedBlobLoad = false;

  const ensurePreviewImageAsset = () => {
    previewAssetPromise ??= getAsset();
    return previewAssetPromise;
  };

  const loadPreviewIntoCard = async () => {
    let previewAsset = null;

    try {
      if (!isCardConnected(card)) {
        return;
      }

      const asset = await ensurePreviewImageAsset();
      previewAsset = asset;
      if (!isCardConnected(card)) {
        return;
      }

      previewLoader.hidden = false;

      let imageSrc;
      try {
        imageSrc = asset.blob instanceof Blob
          ? await blobToDataUrl(asset.blob)
          : asset.objectUrl;
      } catch (_blobErr) {
        if (!isCardConnected(card) || hasRetriedBlobLoad) {
          return;
        }
        hasRetriedBlobLoad = true;
        previewAssetPromise = undefined;
        refreshPaletteGalleryAsset(palette, paletteId);
        hasStartedPreviewLoad = false;
        if (isPreviewIntersecting) {
          queuePreviewLoad();
        }
        return;
      }

      if (!isCardConnected(card)) {
        return;
      }
      await loadImageElementSource(previewImage, imageSrc);
      if (!isCardConnected(card)) {
        return;
      }

      previewImage.hidden = false;
      previewLoader.hidden = true;
    } catch (error) {
      if (!isCardConnected(card)) {
        return;
      }

      previewAssetPromise = undefined;
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      previewLoader.hidden = true;
      reportAppError(error, {
        logMessage: "Failed to render palette gallery preview.",
        consoleMessage: `Failed to render preview for palette ${paletteId}:`,
        clientLogKey: "preview-gallery-failure",
        clientLogThrottleMs: 15000,
        context: getPalettePreviewDebugInfo({ ...palette, id: paletteId }, previewAsset, "gallery"),
      });
    }
  };

  const clearPreviewSettleTimeout = () => {
    if (!previewSettleTimeout) {
      return;
    }

    window.clearTimeout(previewSettleTimeout);
    previewSettleTimeout = 0;
  };

  const startPreviewLoad = ({ force = false } = {}) => {
    if (hasStartedPreviewLoad) {
      return Promise.resolve();
    }

    if (!force && !isPreviewIntersecting) {
      hasQueuedPreviewLoad = false;
      return Promise.resolve();
    }

    observer?.disconnect();
    clearPreviewSettleTimeout();
    hasQueuedPreviewLoad = false;
    hasStartedPreviewLoad = true;
    return loadPreviewIntoCard();
  };

  const queuePreviewLoad = () => {
    if (hasStartedPreviewLoad || hasQueuedPreviewLoad) {
      return;
    }

    hasQueuedPreviewLoad = true;
    schedulePreviewStart(startPreviewLoad, nextPreviewLoadOrder++);
  };

  trigger.addEventListener("click", () => {
    startPreviewLoad({ force: true });
    void onOpenViewer?.(paletteId);
  });

  const IntersectionObserverCtor = window.IntersectionObserver;
  if (IntersectionObserverCtor) {
    observer = new IntersectionObserverCtor(
      (entries) => {
        isPreviewIntersecting = entries.some((entry) => entry.isIntersecting);
        clearPreviewSettleTimeout();

        if (!isPreviewIntersecting) {
          return;
        }

        previewSettleTimeout = window.setTimeout(() => {
          previewSettleTimeout = 0;
          if (isPreviewIntersecting) {
            queuePreviewLoad();
          }
        }, LAZY_PREVIEW_SETTLE_MS);
      },
      { root: scrollRoot, rootMargin },
    );

    observer.observe(observeTarget);
    return;
  }

  isPreviewIntersecting = true;
  queuePreviewLoad();
}

/**
 * @param {object} config
 * @param {Palette} config.palette
 * @param {(paletteId: number) => void | Promise<void>} [config.onOpenViewer]
 * @param {Element | null} [config.scrollRoot]
 */
export function createPaletteCard({ palette, onOpenViewer, scrollRoot = null }) {
  const card = document.createElement("div");
  card.className = "palette-card";
  card.dataset.paletteId = String(palette.id);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "palette-card-trigger";
  trigger.setAttribute("aria-label", t("viewer.openCapture"));

  const previewImage = document.createElement("img");
  previewImage.className = "palette-card-image";
  previewImage.alt = t("viewer.previewAlt");
  previewImage.hidden = true;

  const previewLoader = document.createElement("div");
  previewLoader.className = "palette-card-loader";
  previewLoader.setAttribute("aria-hidden", "true");

  trigger.append(previewImage, previewLoader);
  card.append(trigger, createPublicationBadge(palette), createSelectionIndicator());

  if (palette.captureMode === "ral") {
    const ralIndicator = document.createElement("span");
    ralIndicator.className = "palette-card-ral-indicator panel-status-chip";
    ralIndicator.textContent = "RAL";
    card.appendChild(ralIndicator);
  }

  bindLazyPreviewLoad({
    card,
    palette,
    trigger,
    previewImage,
    previewLoader,
    scrollRoot,
    getAsset: () => getPaletteGalleryPreviewAsset(palette),
    onOpenViewer,
    paletteId: palette.id,
  });

  return card;
}

/**
 * @param {object} config
 * @param {Palette} config.palette
 * @param {(paletteId: number) => void | Promise<void>} [config.onOpenViewer]
 * @param {Element | null} [config.scrollRoot]
 */
export function createSwatchCard({ palette, onOpenViewer, scrollRoot = null }) {
  const card = document.createElement("div");
  card.className = "palette-card palette-card--swatch";
  card.dataset.paletteId = String(palette.id);
  card.style.setProperty("--palette-card-span", String(Math.max(2, palette.colors.length + 1)));

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "palette-card-trigger";
  trigger.setAttribute("aria-label", t("viewer.openCapture"));

  const mediaTile = document.createElement("div");
  mediaTile.className = "palette-swatch-media";
  mediaTile.setAttribute("aria-hidden", "true");

  const previewImage = document.createElement("img");
  previewImage.className = "palette-card-image";
  previewImage.alt = t("viewer.previewAlt");
  previewImage.hidden = true;

  const previewLoader = document.createElement("div");
  previewLoader.className = "palette-card-loader";
  previewLoader.setAttribute("aria-hidden", "true");

  mediaTile.append(previewImage, previewLoader);
  trigger.appendChild(mediaTile);

  palette.colors.forEach((color) => {
    const segment = document.createElement("span");
    segment.className = "palette-swatch-segment";
    segment.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    segment.setAttribute("aria-hidden", "true");
    trigger.appendChild(segment);
  });

  card.append(trigger, createPublicationBadge(palette), createSelectionIndicator());

  if (palette.captureMode === "ral") {
    const ralIndicator = document.createElement("span");
    ralIndicator.className = "palette-card-ral-indicator panel-status-chip";
    ralIndicator.textContent = "RAL";
    card.appendChild(ralIndicator);
  }

  bindLazyPreviewLoad({
    card,
    palette,
    trigger,
    previewImage,
    previewLoader,
    scrollRoot,
    getAsset: () => getPaletteGalleryPreviewAsset(palette),
    onOpenViewer,
    paletteId: palette.id,
    observeTarget: mediaTile,
    rootMargin: SWATCH_PREVIEW_OBSERVER_ROOT_MARGIN,
  });

  return card;
}
