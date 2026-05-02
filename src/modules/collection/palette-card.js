import { getPalettePublicationMeta } from "../../community-service.js";
import { t } from "../../i18n.js";
import { loadImageElementSource } from "../image-element-loader.js";
import { getPalettePreviewPolaroidAsset, hasPaletteMasterPhoto } from "./palette-preview-assets.js";

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
  const previewLoadOrder = nextPreviewLoadOrder++;
  const hasMasterPhoto = hasPaletteMasterPhoto(palette);

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

  const previewStatus = document.createElement("p");
  previewStatus.className = "palette-card-status";
  previewStatus.textContent = hasMasterPhoto ? "" : t("viewer.previewUnavailable");

  previewLoader.hidden = !hasMasterPhoto;
  trigger.append(previewImage, previewLoader, previewStatus);
  card.append(trigger, createPublicationBadge(palette), createSelectionIndicator());

  if (palette.captureMode === "ral") {
    const ralIndicator = document.createElement("span");
    ralIndicator.className = "palette-card-ral-indicator panel-status-chip";
    ralIndicator.textContent = "RAL";
    card.appendChild(ralIndicator);
  }

  let previewAssetPromise;
  let hasStartedPreviewLoad = false;
  let hasPreviewLoadFailed = false;
  let hasQueuedPreviewLoad = false;

  const ensurePreviewImageAsset = () => {
    if (!hasMasterPhoto) {
      return Promise.reject(new Error("Missing palette photo"));
    }

    previewAssetPromise ??= getPalettePreviewPolaroidAsset(palette);
    return previewAssetPromise;
  };

  const loadPreviewIntoCard = async () => {
    if (hasPreviewLoadFailed || !hasMasterPhoto) {
      return;
    }

    try {
      const asset = await ensurePreviewImageAsset();
      if (!card.isConnected) {
        return;
      }

      previewLoader.hidden = false;
      previewStatus.textContent = "";
      await loadImageElementSource(previewImage, asset.objectUrl);
      if (!card.isConnected) {
        return;
      }

      previewImage.hidden = false;
      previewLoader.hidden = true;
      previewStatus.textContent = "";
    } catch (error) {
      if (!card.isConnected) {
        return;
      }

      previewAssetPromise = undefined;
      hasPreviewLoadFailed = true;
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      previewLoader.hidden = true;
      previewStatus.textContent = t("viewer.previewUnavailable");
      console.error(`Failed to render preview for palette ${palette.id}:`, error);
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
    schedulePreviewStart(startPreviewLoad, previewLoadOrder);
  };

  trigger.addEventListener("click", () => {
    startPreviewLoad();
    void onOpenViewer?.(palette.id);
  });

  if (hasMasterPhoto) {
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
    } else {
      queuePreviewLoad();
    }
  }

  return card;
}

/**
 * @param {object} config
 * @param {Palette} config.palette
 * @param {(paletteId: number) => void | Promise<void>} [config.onOpenViewer]
 */
export function createSwatchCard({ palette, onOpenViewer }) {
  const card = document.createElement("div");
  card.className = "palette-card palette-card--swatch";
  card.dataset.paletteId = String(palette.id);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "palette-card-trigger";
  trigger.setAttribute("aria-label", t("viewer.openCapture"));

  const strip = document.createElement("div");
  strip.className = "palette-swatch-strip";
  strip.setAttribute("aria-hidden", "true");

  palette.colors.forEach((color) => {
    const segment = document.createElement("span");
    segment.className = "palette-swatch-segment";
    segment.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    strip.appendChild(segment);
  });

  trigger.appendChild(strip);
  card.append(trigger, createPublicationBadge(palette), createSelectionIndicator());

  if (palette.captureMode === "ral") {
    const ralIndicator = document.createElement("span");
    ralIndicator.className = "palette-card-ral-indicator panel-status-chip";
    ralIndicator.textContent = "RAL";
    card.appendChild(ralIndicator);
  }

  trigger.addEventListener("click", () => {
    void onOpenViewer?.(palette.id);
  });

  return card;
}
