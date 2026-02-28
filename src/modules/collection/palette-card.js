import { deletePalette } from "../../palette-storage.js";
import { showToast, showUndoToast } from "../toast-ui.js";
import {
  disposePalettePreviewPolaroidAsset,
  exportPalettePolaroidImage,
  getPalettePreviewPolaroidAsset,
  hasPaletteMasterPhoto,
  sharePalettePolaroidImage,
} from "./palette-preview-assets.js";
import {
  closePaletteViewerOverlay,
  openPaletteViewerOverlay,
  subscribePaletteViewerOverlayClose,
} from "./palette-viewer-overlay.js";

const PREVIEW_OBSERVER_ROOT_MARGIN = "220px 0px";
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

  const schedule = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 0);

  schedule(() => {
    flushPendingPreviewStarts();
  });
}

export { closePaletteViewerOverlay, subscribePaletteViewerOverlayClose };

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
  const previewLoadOrder = nextPreviewLoadOrder++;
  const hasMasterPhoto = hasPaletteMasterPhoto(palette);

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

  const previewLoader = document.createElement("div");
  previewLoader.className = "palette-card-loader";
  previewLoader.setAttribute("aria-hidden", "true");

  const previewStatus = document.createElement("p");
  previewStatus.className = "palette-card-status";
  previewStatus.textContent = hasMasterPhoto
    ? ""
    : "Aperçu indisponible";

  previewLoader.hidden = !hasMasterPhoto;
  trigger.append(previewImage, previewLoader, previewStatus);
  card.append(trigger);

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

  const loadPreviewImageElement = (src) =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        previewImage.removeEventListener("load", handleLoad);
        previewImage.removeEventListener("error", handleError);
      };

      const handleLoad = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Unable to load preview image element"));
      };

      previewImage.addEventListener("load", handleLoad);
      previewImage.addEventListener("error", handleError);
      previewImage.src = src;

      if (previewImage.complete) {
        if (previewImage.naturalWidth > 0) {
          cleanup();
          resolve();
          return;
        }

        cleanup();
        reject(new Error("Unable to load preview image element"));
      }
    });

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
      await loadPreviewImageElement(asset.objectUrl);
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

  const handleExportAction = async () => {
    const exported = await exportPalettePolaroidImage(palette);
    showToast(exported ? "Palette exportee" : "Export echoue", {
      variant: exported ? "default" : "error",
      duration: exported ? 1400 : 1800,
    });
  };

  const handleShareAction = async () => {
    const result = await sharePalettePolaroidImage(palette);

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
      const exported = await exportPalettePolaroidImage(palette);
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
          disposePalettePreviewPolaroidAsset(palette);
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

    await openPaletteViewerOverlay({
      getPreviewAsset: hasMasterPhoto ? ensurePreviewImageAsset : undefined,
      canShare: hasMasterPhoto,
      canExport: hasMasterPhoto,
      canDelete: true,
      onShare: handleShareAction,
      onExport: handleExportAction,
      onDelete: handleDeleteAction,
    });
  };

  trigger.addEventListener("click", () => {
    void openViewer();
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
        { rootMargin: PREVIEW_OBSERVER_ROOT_MARGIN },
      );

      observer.observe(card);
    } else {
      queuePreviewLoad();
    }
  }

  return card;
}
