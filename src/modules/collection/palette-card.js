import { toRgbCss } from "../color-format.js";
import { showToast, showUndoToast } from "../toast-ui.js";
import { deletePalette } from "../../palette-storage.js";

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

async function exportPaletteAsImage(palette) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !palette.photoBlob) {
    return false;
  }

  return new Promise((resolve) => {
    const image = new Image();
    const photoUrl = URL.createObjectURL(palette.photoBlob);

    image.onload = () => {
      const photoWidth = image.width;
      const photoHeight = image.height;
      const swatchHeight = 100;

      canvas.width = photoWidth;
      canvas.height = photoHeight + swatchHeight;

      context.drawImage(image, 0, 0, photoWidth, photoHeight);

      const swatchWidth = photoWidth / palette.colors.length;
      palette.colors.forEach((color, index) => {
        context.fillStyle = toRgbCss(color);
        context.fillRect(
          index * swatchWidth,
          photoHeight,
          swatchWidth,
          swatchHeight,
        );
      });

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(photoUrl);

          if (!blob) {
            resolve(false);
            return;
          }

          const link = document.createElement("a");
          link.download = `palette-${palette.id}.webp`;
          link.href = URL.createObjectURL(blob);
          link.click();

          URL.revokeObjectURL(link.href);
          resolve(true);
        },
        "image/webp",
        0.95,
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(photoUrl);
      resolve(false);
    };

    image.src = photoUrl;
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
  const swipeHandle = createSwipeHandle();
  track.append(swatchesContainer, swipeHandle);

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

  const swipeController = createSwipeController({ card, track });

  exportButton.addEventListener("click", async () => {
    const exported = await exportPaletteAsImage(palette);
    showToast(exported ? "Palette exportee" : "Export echoue", {
      variant: exported ? "default" : "error",
      duration: exported ? 1400 : 1800,
    });
    swipeController.close();
  });

  deleteButton.addEventListener("click", () => {
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
  });

  rightActions.append(exportButton, deleteButton);
  card.append(rightActions, track);

  return card;
}
