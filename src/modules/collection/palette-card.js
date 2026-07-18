import { getPalettePublicationMeta } from "../../community-service.js";
import { t } from "../../i18n.js";
import { reportAppError } from "../error-reporting.js";
import { loadImageElementBlobSource } from "../image-element-loader.js";
import {
  getPaletteGalleryPreviewAsset,
  getPalettePreviewDebugInfo,
  getStoredPaletteGalleryPreviewAssetSync,
  refreshPaletteGalleryAsset,
} from "./palette-preview-assets.js";

const PREVIEW_OBSERVER_ROOT_MARGIN = "500px 0px";
const SWATCH_PREVIEW_OBSERVER_ROOT_MARGIN = "40px 0px";
const MAX_CONCURRENT_PREVIEW_LOADS = 6;
const LAZY_PREVIEW_SETTLE_MS = 120;
const LOADER_REVEAL_DELAY_MS = 140;
const LOADER_FADE_OUT_MS = 220;
const paletteCardDisposers = new WeakMap();
const previewObserverPools = new WeakMap();

function observePreviewTarget(target, { root, rootMargin }, callback) {
  const IntersectionObserverCtor = window.IntersectionObserver;
  if (!IntersectionObserverCtor) return () => {};

  const owner = root ?? window;
  let rootPools = previewObserverPools.get(owner);
  if (!rootPools) {
    rootPools = new Map();
    previewObserverPools.set(owner, rootPools);
  }

  let pool = rootPools.get(rootMargin);
  if (!pool || pool.ctor !== IntersectionObserverCtor) {
    pool?.observer.disconnect();
    const callbacks = new Map();
    const observer = new IntersectionObserverCtor(
      (entries) => {
        entries.forEach((entry) => {
          callbacks.get(entry.target)?.(entry);
        });
      },
      { root, rootMargin },
    );
    pool = { callbacks, ctor: IntersectionObserverCtor, observer };
    rootPools.set(rootMargin, pool);
  }

  pool.callbacks.set(target, callback);
  pool.observer.observe(target);
  let isObserving = true;
  return () => {
    if (!isObserving) return;
    isObserving = false;
    pool.observer.unobserve?.(target);
    pool.callbacks.delete(target);
    if (pool.callbacks.size === 0) {
      pool.observer.disconnect();
      rootPools.delete(rootMargin);
    }
  };
}

export function disposePaletteCard(card) {
  const dispose = paletteCardDisposers.get(card);
  if (!dispose) return false;
  paletteCardDisposers.delete(card);
  dispose();
  return true;
}

function buildPaletteBloomBackground(palette) {
  const colors = Array.isArray(palette?.colors) ? palette.colors : [];
  if (colors.length === 0) {
    return null;
  }

  const blooms = colors.map((color, index) => {
    const positionX = ((index + 0.5) / colors.length) * 100;
    const positionY = index % 2 === 0 ? 32 : 68;
    return `radial-gradient(circle at ${positionX}% ${positionY}%, rgba(${color.r}, ${color.g}, ${color.b}, 0.55) 0%, rgba(${color.r}, ${color.g}, ${color.b}, 0) 55%)`;
  });

  return blooms.join(", ");
}

function applyPaletteBloomToCard(card, palette) {
  const bloom = buildPaletteBloomBackground(palette);
  if (bloom) {
    card.style.setProperty("--palette-card-bloom", bloom);
  }
}

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
let cancelScheduledPreviewFlush = () => {};

function isCardConnected(card) {
  return card.isConnected !== false;
}

function schedulePreviewFlush() {
  if (hasScheduledPreviewFlush) {
    return;
  }

  hasScheduledPreviewFlush = true;
  const runFlush = () => {
    cancelScheduledPreviewFlush = () => {};
    flushPendingPreviewStarts();
  };

  if (typeof window.requestAnimationFrame === "function") {
    const requestId = window.requestAnimationFrame(runFlush);
    cancelScheduledPreviewFlush = () => window.cancelAnimationFrame?.(requestId);
    return;
  }

  const timeoutId = window.setTimeout(runFlush, 0);
  cancelScheduledPreviewFlush = () => window.clearTimeout(timeoutId);
}

function flushPendingPreviewStarts() {
  hasScheduledPreviewFlush = false;

  pendingPreviewStarts.sort((first, second) => first.order - second.order);

  while (activePreviewLoadCount < MAX_CONCURRENT_PREVIEW_LOADS && pendingPreviewStarts.length > 0) {
    const queuedStart = pendingPreviewStarts.shift();
    activePreviewLoadCount += 1;

    Promise.resolve(queuedStart.start()).finally(() => {
      activePreviewLoadCount = Math.max(0, activePreviewLoadCount - 1);

      if (pendingPreviewStarts.length > 0) {
        schedulePreviewFlush();
      }
    });
  }

  if (pendingPreviewStarts.length > 0 && activePreviewLoadCount < MAX_CONCURRENT_PREVIEW_LOADS) {
    schedulePreviewFlush();
  }
}

function schedulePreviewStart(start, order) {
  const queuedStart = { start, order };
  pendingPreviewStarts.push(queuedStart);

  schedulePreviewFlush();
  return () => {
    const queuedIndex = pendingPreviewStarts.indexOf(queuedStart);
    if (queuedIndex < 0) {
      return false;
    }

    pendingPreviewStarts.splice(queuedIndex, 1);
    if (pendingPreviewStarts.length === 0 && hasScheduledPreviewFlush) {
      cancelScheduledPreviewFlush();
      cancelScheduledPreviewFlush = () => {};
      hasScheduledPreviewFlush = false;
    }
    return true;
  };
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
  let loaderRevealTimeout = 0;
  let loaderFadeOutTimeout = 0;
  let stopObservingPreview = () => {};
  let cancelQueuedPreviewStart = () => false;
  let hasRetriedBlobLoad = false;
  let isDisposed = false;

  previewLoader.hidden = true;

  const clearLoaderFadeOutTimeout = () => {
    if (!loaderFadeOutTimeout) {
      return;
    }
    window.clearTimeout(loaderFadeOutTimeout);
    loaderFadeOutTimeout = 0;
  };

  const hideLoaderImmediately = () => {
    clearLoaderFadeOutTimeout();
    previewLoader.classList.remove("is-fading-out");
    previewLoader.hidden = true;
  };

  const fadeOutLoader = () => {
    if (previewLoader.hidden) {
      return;
    }
    clearLoaderFadeOutTimeout();
    previewLoader.classList.add("is-fading-out");
    loaderFadeOutTimeout = window.setTimeout(() => {
      loaderFadeOutTimeout = 0;
      previewLoader.classList.remove("is-fading-out");
      previewLoader.hidden = true;
    }, LOADER_FADE_OUT_MS);
  };

  const ensurePreviewImageAsset = () => {
    previewAssetPromise ??= getAsset();
    return previewAssetPromise;
  };

  const clearLoaderRevealTimeout = () => {
    if (!loaderRevealTimeout) {
      return;
    }

    window.clearTimeout(loaderRevealTimeout);
    loaderRevealTimeout = 0;
  };

  const scheduleLoaderReveal = () => {
    clearLoaderRevealTimeout();
    loaderRevealTimeout = window.setTimeout(() => {
      loaderRevealTimeout = 0;
      if (!isCardConnected(card)) {
        return;
      }
      if (previewImage.hidden) {
        previewLoader.hidden = false;
      }
    }, LOADER_REVEAL_DELAY_MS);
  };

  const tryRenderCachedAsset = () => {
    if (!palette || typeof palette !== "object") {
      return false;
    }

    const cachedAsset = getStoredPaletteGalleryPreviewAssetSync(palette);
    if (!cachedAsset?.source) {
      return false;
    }

    hasStartedPreviewLoad = true;
    previewAssetPromise = Promise.resolve(cachedAsset);
    previewImage.src = cachedAsset.source;
    previewImage.hidden = false;
    hideLoaderImmediately();
    return true;
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

      scheduleLoaderReveal();
      try {
        const { source } = await loadImageElementBlobSource(previewImage, asset.blob);
        asset.source = source;
      } catch (loadError) {
        if (!isCardConnected(card) || hasRetriedBlobLoad) {
          throw loadError;
        }

        hasRetriedBlobLoad = true;
        previewAssetPromise = undefined;
        await refreshPaletteGalleryAsset(palette, paletteId);
        hasStartedPreviewLoad = false;
        previewImage.hidden = true;
        previewImage.removeAttribute("src");
        clearLoaderRevealTimeout();
        hideLoaderImmediately();
        if (isPreviewIntersecting) {
          queuePreviewLoad();
        }
        return;
      }

      if (!isCardConnected(card)) {
        return;
      }

      clearLoaderRevealTimeout();
      previewImage.hidden = false;
      fadeOutLoader();
    } catch (error) {
      if (!isCardConnected(card)) {
        return;
      }

      previewAssetPromise = undefined;
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      clearLoaderRevealTimeout();
      hideLoaderImmediately();
      const debugPalette =
        palette && typeof palette === "object" ? { ...palette, id: paletteId } : { id: paletteId };
      reportAppError(error, {
        logMessage: "Failed to render palette gallery preview.",
        consoleMessage: `Failed to render preview for palette ${paletteId}:`,
        clientLogKey: "preview-gallery-failure",
        clientLogThrottleMs: 15000,
        context: getPalettePreviewDebugInfo(debugPalette, previewAsset, "gallery"),
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
    if (isDisposed || hasStartedPreviewLoad) {
      return Promise.resolve();
    }

    if (!force && !isPreviewIntersecting) {
      hasQueuedPreviewLoad = false;
      return Promise.resolve();
    }

    stopObservingPreview();
    clearPreviewSettleTimeout();
    hasQueuedPreviewLoad = false;
    cancelQueuedPreviewStart = () => false;
    hasStartedPreviewLoad = true;
    return loadPreviewIntoCard();
  };

  const queuePreviewLoad = () => {
    if (isDisposed || hasStartedPreviewLoad || hasQueuedPreviewLoad) {
      return;
    }

    hasQueuedPreviewLoad = true;
    cancelQueuedPreviewStart = schedulePreviewStart(startPreviewLoad, nextPreviewLoadOrder++);
  };

  const handleTriggerClick = () => {
    startPreviewLoad({ force: true });
    void onOpenViewer?.(paletteId, trigger);
  };
  trigger.addEventListener("click", handleTriggerClick);

  const dispose = () => {
    if (isDisposed) return;
    isDisposed = true;
    cancelQueuedPreviewStart();
    cancelQueuedPreviewStart = () => false;
    hasQueuedPreviewLoad = false;
    stopObservingPreview();
    clearPreviewSettleTimeout();
    clearLoaderRevealTimeout();
    clearLoaderFadeOutTimeout();
    trigger.removeEventListener("click", handleTriggerClick);
  };

  if (tryRenderCachedAsset()) {
    return dispose;
  }

  const IntersectionObserverCtor = window.IntersectionObserver;
  if (IntersectionObserverCtor) {
    stopObservingPreview = observePreviewTarget(
      observeTarget,
      { root: scrollRoot, rootMargin },
      (entry) => {
        isPreviewIntersecting = entry.isIntersecting;
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
    );
    return dispose;
  }

  isPreviewIntersecting = true;
  queuePreviewLoad();
  return dispose;
}

/**
 * @param {object} config
 * @param {Palette} config.palette
 * @param {(paletteId: number, trigger: HTMLButtonElement) => void | Promise<void>} [config.onOpenViewer]
 * @param {Element | null} [config.scrollRoot]
 */
export function createPaletteCard({ palette, onOpenViewer, scrollRoot = null }) {
  const card = document.createElement("div");
  card.className = "palette-card";
  card.dataset.paletteId = String(palette.id);
  applyPaletteBloomToCard(card, palette);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = `palette-${palette.id}-trigger`;
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

  const dispose = bindLazyPreviewLoad({
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
  paletteCardDisposers.set(card, dispose);

  return card;
}

/**
 * @param {object} config
 * @param {Palette} config.palette
 * @param {(paletteId: number, trigger: HTMLButtonElement) => void | Promise<void>} [config.onOpenViewer]
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

  const dispose = bindLazyPreviewLoad({
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
  paletteCardDisposers.set(card, dispose);

  return card;
}
