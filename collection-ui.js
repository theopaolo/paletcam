import { deletePalette, getSavedPalettes } from './palette-storage.js';
import { showToast, showUndoToast } from './modules/toast-ui.js';

const collectionPanel = document.querySelector('.collection-panel');
const collectionGrid = document.getElementById('collectionGrid');
const viewCollectionButton = document.querySelector('.btn-view-collection');
const closeCollectionButton = document.querySelector('.btn-close-collection');
const QUICK_ACTION_WIDTH = 72;
const LEFT_ACTION_WIDTH = QUICK_ACTION_WIDTH;
const RIGHT_ACTION_WIDTH = QUICK_ACTION_WIDTH * 2;
const SWIPE_START_THRESHOLD = 8;
const SWIPE_OPEN_RATIO = 0.38;
const EMPTY_MESSAGE_TEXT = 'No palettes saved yet';
const DELETE_UNDO_DURATION_MS = 5000;
const pendingDeletionIds = new Set();
let activeSwipeController;

function toRgbCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function setActiveSwipeController(controller) {
  if (activeSwipeController && activeSwipeController !== controller) {
    activeSwipeController.close();
  }

  activeSwipeController = controller;
}

function clearActiveSwipeController(controller) {
  if (activeSwipeController === controller) {
    activeSwipeController = undefined;
  }
}

function closeActiveSwipeController() {
  if (!activeSwipeController) {
    return;
  }

  activeSwipeController.close();
}

function removeEmptyMessage() {
  const message = collectionGrid?.querySelector('.empty-message');
  message?.remove();
}

function ensureEmptyMessage() {
  if (!collectionGrid) {
    return;
  }

  const hasCard = Boolean(collectionGrid.querySelector('.palette-card'));
  if (hasCard) {
    removeEmptyMessage();
    return;
  }

  if (collectionGrid.querySelector('.empty-message')) {
    return;
  }

  const message = document.createElement('p');
  message.className = 'empty-message';
  message.textContent = EMPTY_MESSAGE_TEXT;
  collectionGrid.appendChild(message);
}

function takeCardPositionSnapshot(card) {
  return {
    parent: card.parentElement,
    nextSibling: card.nextSibling,
  };
}

function restoreCardFromSnapshot(card, snapshot) {
  if (!collectionGrid || card.parentElement === collectionGrid) {
    return;
  }

  removeEmptyMessage();

  const { nextSibling } = snapshot;
  if (nextSibling && nextSibling.parentElement === collectionGrid) {
    collectionGrid.insertBefore(card, nextSibling);
    return;
  }

  collectionGrid.appendChild(card);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Clipboard write failed:', error);
    return false;
  }
}

async function exportPaletteAsImage(palette) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

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
        context.fillRect(index * swatchWidth, photoHeight, swatchWidth, swatchHeight);
      });

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(photoUrl);

        if (!blob) {
          resolve(false);
          return;
        }

        const link = document.createElement('a');
        link.download = `palette-${palette.id}.webp`;
        link.href = URL.createObjectURL(blob);
        link.click();

        URL.revokeObjectURL(link.href);
        resolve(true);
      }, 'image/webp', 0.95);
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

  const photoSwatch = document.createElement('div');
  const photoUrl = URL.createObjectURL(palette.photoBlob);

  photoSwatch.className = 'color-swatch photo-swatch';
  photoSwatch.style.backgroundImage = `url(${photoUrl})`;
  photoSwatch.style.backgroundSize = 'cover';
  photoSwatch.style.backgroundPosition = 'center';
  photoSwatch.title = 'Click to copy photo';

  photoSwatch.addEventListener('click', async () => {
    try {
      const image = new Image();
      const imageUrl = URL.createObjectURL(palette.photoBlob);

      image.onload = async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(imageUrl);
          return;
        }

        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0);

        canvas.toBlob(async (pngBlob) => {
          try {
            if (!pngBlob) {
              return;
            }

            await navigator.clipboard.write([
              new ClipboardItem({
                'image/png': pngBlob,
              }),
            ]);
            showToast('Photo copied');
          } catch (error) {
            console.error('Failed to copy photo, downloading fallback:', error);
            if (!pngBlob) {
              showToast('Copy failed', { variant: 'error', duration: 1800 });
              return;
            }

            const link = document.createElement('a');
            link.download = `photo-${palette.id}.png`;
            link.href = URL.createObjectURL(pngBlob);
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('Photo downloaded', { duration: 1500 });
          } finally {
            URL.revokeObjectURL(imageUrl);
          }
        }, 'image/png');
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
      };

      image.src = imageUrl;
    } catch (error) {
      console.error('Failed to process photo:', error);
      showToast('Copy failed', { variant: 'error', duration: 1800 });
    }
  });

  return photoSwatch;
}

function createColorSwatch(color) {
  const swatch = document.createElement('div');
  const rgbText = toRgbCss(color);

  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = rgbText;
  swatch.title = rgbText;

  swatch.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(rgbText);
    showToast(copied ? 'RGB copied' : 'Copy failed', {
      variant: copied ? 'default' : 'error',
      duration: copied ? 1000 : 1800,
    });
  });

  return swatch;
}

function getIconMarkup(iconName) {
  if (iconName === 'copy') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M184,64H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H184a8,8,0,0,0,8-8V72A8,8,0,0,0,184,64Zm-8,144H48V80H176ZM224,40V184a8,8,0,0,1-16,0V48H72a8,8,0,0,1,0-16H216A8,8,0,0,1,224,40Z"></path>
      </svg>
    `;
  }

  if (iconName === 'export') {
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
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `palette-quick-action ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `
    ${getIconMarkup(iconName)}
    ${visibleLabel ? `<span class="palette-quick-action-label">${visibleLabel}</span>` : ''}
  `;
  return button;
}

function createSwipeController({ card, track }) {
  let currentOffset = 0;
  let pointerId;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let gestureAxis;
  let movedHorizontally = false;
  let controller;

  function applyOffset(nextOffset, shouldAnimate) {
    const clampedOffset = Math.min(LEFT_ACTION_WIDTH, Math.max(-RIGHT_ACTION_WIDTH, nextOffset));
    currentOffset = clampedOffset;

    track.style.transform = `translateX(${clampedOffset}px)`;
    card.classList.toggle('is-open-left', clampedOffset > 0);
    card.classList.toggle('is-open-right', clampedOffset < 0);
    card.classList.toggle('is-dragging', !shouldAnimate);
  }

  function snapTo(nextOffset) {
    applyOffset(nextOffset, true);

    if (nextOffset === 0) {
      clearActiveSwipeController(controller);
      return;
    }

    setActiveSwipeController(controller);
  }

  controller = {
    card,
    close() {
      snapTo(0);
    },
    isOpen() {
      return currentOffset !== 0;
    },
  };

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (activeSwipeController && activeSwipeController !== controller) {
      closeActiveSwipeController();
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = currentOffset;
    gestureAxis = undefined;
    movedHorizontally = false;
    track.setPointerCapture(pointerId);
  });

  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!gestureAxis) {
      const totalX = Math.abs(deltaX);
      const totalY = Math.abs(deltaY);

      if (totalX < SWIPE_START_THRESHOLD && totalY < SWIPE_START_THRESHOLD) {
        return;
      }

      gestureAxis = totalX > totalY ? 'x' : 'y';
    }

    if (gestureAxis !== 'x') {
      return;
    }

    movedHorizontally = true;
    event.preventDefault();
    applyOffset(startOffset + deltaX, false);
  });

  function releasePointer(event) {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (track.hasPointerCapture(pointerId)) {
      track.releasePointerCapture(pointerId);
    }

    pointerId = undefined;

    if (gestureAxis !== 'x' || !movedHorizontally) {
      card.classList.remove('is-dragging');
      return;
    }

    const openLeftThreshold = LEFT_ACTION_WIDTH * SWIPE_OPEN_RATIO;
    const openRightThreshold = -RIGHT_ACTION_WIDTH * SWIPE_OPEN_RATIO;

    if (currentOffset >= openLeftThreshold) {
      snapTo(LEFT_ACTION_WIDTH);
      return;
    }

    if (currentOffset <= openRightThreshold) {
      snapTo(-RIGHT_ACTION_WIDTH);
      return;
    }

    snapTo(0);
  }

  track.addEventListener('pointerup', releasePointer);
  track.addEventListener('pointercancel', releasePointer);
  track.addEventListener(
    'click',
    (event) => {
      if (!controller.isOpen()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      controller.close();
    },
    true
  );

  return controller;
}

function createPaletteCard(palette) {
  const card = document.createElement('div');
  card.className = 'palette-card';
  card.dataset.paletteId = String(palette.id);

  const swatchesContainer = document.createElement('div');
  swatchesContainer.className = 'palette-swatches';

  const photoSwatch = createPhotoSwatch(palette);
  if (photoSwatch) {
    swatchesContainer.appendChild(photoSwatch);
  }

  palette.colors.forEach((color) => {
    swatchesContainer.appendChild(createColorSwatch(color));
  });

  const leftActions = document.createElement('div');
  leftActions.className = 'palette-action-lane palette-action-lane-left';

  const rightActions = document.createElement('div');
  rightActions.className = 'palette-action-lane palette-action-lane-right';

  const track = document.createElement('div');
  track.className = 'palette-track';
  track.appendChild(swatchesContainer);

  const copyAllButton = createQuickActionButton({
    className: 'palette-action-copy',
    label: 'Copy palette',
    iconName: 'copy',
    visibleLabel: 'copy',
  });
  const exportButton = createQuickActionButton({
    className: 'palette-action-export',
    label: 'Export palette',
    iconName: 'export',
    visibleLabel: 'export',
  });
  const deleteButton = createQuickActionButton({
    className: 'palette-action-delete',
    label: 'Delete palette',
    iconName: 'delete',
    visibleLabel: 'delete',
  });

  const swipeController = createSwipeController({ card, track });

  copyAllButton.addEventListener('click', async () => {
    const colorsText = palette.colors.map((color) => toRgbCss(color)).join('\n');
    const copied = await copyTextToClipboard(colorsText);
    showToast(copied ? 'Palette copied' : 'Copy failed', {
      variant: copied ? 'default' : 'error',
      duration: copied ? 1300 : 1800,
    });
    swipeController.close();
  });

  exportButton.addEventListener('click', async () => {
    const exported = await exportPaletteAsImage(palette);
    showToast(exported ? 'Palette exported' : 'Export failed', {
      variant: exported ? 'default' : 'error',
      duration: exported ? 1400 : 1800,
    });
    swipeController.close();
  });

  deleteButton.addEventListener('click', () => {
    if (pendingDeletionIds.has(palette.id)) {
      return;
    }

    pendingDeletionIds.add(palette.id);
    const snapshot = takeCardPositionSnapshot(card);

    clearActiveSwipeController(swipeController);
    card.remove();
    ensureEmptyMessage();

    showUndoToast('Palette deleted', {
      duration: DELETE_UNDO_DURATION_MS,
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
          showToast('Delete failed', { variant: 'error', duration: 1800 });
        }
      },
    });
  });

  leftActions.appendChild(copyAllButton);
  rightActions.append(exportButton, deleteButton);
  card.append(leftActions, rightActions, track);

  return card;
}

async function loadCollectionUi() {
  closeActiveSwipeController();
  const palettes = (await getSavedPalettes()).filter((palette) => !pendingDeletionIds.has(palette.id));
  collectionGrid.innerHTML = '';

  if (palettes.length === 0) {
    collectionGrid.innerHTML = `<p class="empty-message">${EMPTY_MESSAGE_TEXT}</p>`;
    return;
  }

  palettes.forEach((palette) => {
    collectionGrid.appendChild(createPaletteCard(palette));
  });
}

function bindCollectionUiEvents() {
  if (!collectionPanel || !collectionGrid || !viewCollectionButton || !closeCollectionButton) {
    return;
  }

  viewCollectionButton.addEventListener('click', async () => {
    collectionPanel.classList.add('visible');
    await loadCollectionUi();
  });

  closeCollectionButton.addEventListener('click', () => {
    closeActiveSwipeController();
    collectionPanel.classList.remove('visible');
  });

  collectionPanel.addEventListener('scroll', () => {
    closeActiveSwipeController();
  }, { passive: true });

  document.addEventListener('pointerdown', (event) => {
    if (!activeSwipeController || !collectionPanel.classList.contains('visible')) {
      return;
    }

    if (activeSwipeController.card.contains(event.target)) {
      return;
    }

    closeActiveSwipeController();
  });
}

bindCollectionUiEvents();
