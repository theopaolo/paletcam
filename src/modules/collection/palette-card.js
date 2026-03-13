import { getPalettePublicationMeta } from "../../community-service.js";
import { getPalettePreviewPolaroidAsset, hasPaletteMasterPhoto } from "./palette-preview-assets.js";

const PREVIEW_OBSERVER_ROOT_MARGIN = "500px 0px";
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

function loadPreviewImageElement(image, src) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };

    const handleLoad = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Unable to load preview image element"));
    };

    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    image.src = src;

    if (image.complete) {
      if (image.naturalWidth > 0) {
        cleanup();
        resolve();
        return;
      }

      cleanup();
      reject(new Error("Unable to load preview image element"));
    }
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
  trigger.setAttribute("aria-label", "Ouvrir la capture");

  const previewImage = document.createElement("img");
  previewImage.className = "palette-card-image";
  previewImage.alt = "Aperçu polaroid";
  previewImage.decoding = "async";
  previewImage.hidden = true;

  const previewLoader = document.createElement("div");
  previewLoader.className = "palette-card-loader";
  previewLoader.setAttribute("aria-hidden", "true");

  const previewStatus = document.createElement("p");
  previewStatus.className = "palette-card-status";
  previewStatus.textContent = hasMasterPhoto ? "" : "Aperçu indisponible";

  const publicationBadge = document.createElement("span");
  publicationBadge.className = "palette-card-publication-badge";
  const publicationMeta = getPalettePublicationMeta(palette);
  if (publicationMeta) {
    publicationBadge.hidden = false;
    publicationBadge.dataset.tone = publicationMeta.tone;
    publicationBadge.textContent = publicationMeta.label;
  } else {
    publicationBadge.hidden = true;
  }

  previewLoader.hidden = !hasMasterPhoto;
  trigger.append(previewImage, previewLoader, previewStatus);
  card.append(trigger, publicationBadge);

  if (palette.captureMode === "ral") {
    const ralIndicator = document.createElement("span");
    ralIndicator.className = "palette-card-ral-indicator";
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
      await loadPreviewImageElement(previewImage, asset.objectUrl);
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
      previewStatus.textContent = "Aperçu indisponible";
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
