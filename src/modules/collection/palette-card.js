import { getPalettePublicationMeta } from "../../community-service.js";
import { t } from "../../i18n.js";
import { loadImageElementSource } from "../image-element-loader.js";
import { getPaletteGalleryPreviewAsset } from "./palette-preview-assets.js";

const PREVIEW_OBSERVER_ROOT_MARGIN = "500px 0px";

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

function flushPendingPreviewStarts() {
  hasScheduledPreviewFlush = false;

  pendingPreviewStarts
    .sort((first, second) => first.order - second.order)
    .splice(0)
    .forEach(({ start }) => {
      start();
    });
}

function schedulePreviewStart(start, order) {
  pendingPreviewStarts.push({ start, order });

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

function bindLazyPreviewLoad({
  card,
  trigger,
  previewImage,
  previewLoader,
  scrollRoot,
  getAsset,
  onOpenViewer,
  paletteId,
}) {
  let previewAssetPromise;
  let hasStartedPreviewLoad = false;
  let hasQueuedPreviewLoad = false;

  const ensurePreviewImageAsset = () => {
    previewAssetPromise ??= getAsset();
    return previewAssetPromise;
  };

  const loadPreviewIntoCard = async () => {
    try {
      const asset = await ensurePreviewImageAsset();
      if (!card.isConnected) {
        return;
      }

      previewLoader.hidden = false;
      await loadImageElementSource(previewImage, asset.objectUrl);
      if (!card.isConnected) {
        return;
      }

      previewImage.hidden = false;
      previewLoader.hidden = true;
    } catch (error) {
      if (!card.isConnected) {
        return;
      }

      previewAssetPromise = undefined;
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      previewLoader.hidden = true;
      console.error(`Failed to render preview for palette ${paletteId}:`, error);
    }
  };

  const startPreviewLoad = () => {
    if (hasStartedPreviewLoad) {
      return;
    }

    hasQueuedPreviewLoad = false;
    hasStartedPreviewLoad = true;
    void loadPreviewIntoCard();
  };

  const queuePreviewLoad = () => {
    if (hasStartedPreviewLoad || hasQueuedPreviewLoad) {
      return;
    }

    hasQueuedPreviewLoad = true;
    schedulePreviewStart(startPreviewLoad, nextPreviewLoadOrder++);
  };

  trigger.addEventListener("click", () => {
    startPreviewLoad();
    void onOpenViewer?.(paletteId);
  });

  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        observer.disconnect();
        queuePreviewLoad();
      },
      { root: scrollRoot, rootMargin: PREVIEW_OBSERVER_ROOT_MARGIN },
    );

    observer.observe(card);
    return;
  }

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
  previewImage.decoding = "async";
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
  previewImage.decoding = "async";
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
