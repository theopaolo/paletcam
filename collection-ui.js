import { deletePalette, getSavedPalettes } from './palette-storage.js';

const collectionPanel = document.querySelector('.collection-panel');
const collectionGrid = document.getElementById('collectionGrid');
const viewCollectionButton = document.querySelector('.btn-view-collection');
const closeCollectionButton = document.querySelector('.btn-close-collection');

function toRgbCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
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
    return;
  }

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
      if (!blob) {
        URL.revokeObjectURL(photoUrl);
        return;
      }

      const link = document.createElement('a');
      link.download = `palette-${palette.id}.webp`;
      link.href = URL.createObjectURL(blob);
      link.click();

      URL.revokeObjectURL(link.href);
      URL.revokeObjectURL(photoUrl);
    }, 'image/webp', 0.95);
  };

  image.onerror = () => {
    URL.revokeObjectURL(photoUrl);
  };

  image.src = photoUrl;
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
          } catch (error) {
            console.error('Failed to copy photo, downloading fallback:', error);
            if (!pngBlob) {
              return;
            }

            const link = document.createElement('a');
            link.download = `photo-${palette.id}.png`;
            link.href = URL.createObjectURL(pngBlob);
            link.click();
            URL.revokeObjectURL(link.href);
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
    await copyTextToClipboard(rgbText);
  });

  return swatch;
}

function createPaletteCard(palette) {
  const card = document.createElement('div');
  card.className = 'palette-card';

  const swatchesContainer = document.createElement('div');
  swatchesContainer.className = 'palette-swatches';

  const photoSwatch = createPhotoSwatch(palette);
  if (photoSwatch) {
    swatchesContainer.appendChild(photoSwatch);
  }

  palette.colors.forEach((color) => {
    swatchesContainer.appendChild(createColorSwatch(color));
  });

  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'palette-actions';

  const exportButton = document.createElement('button');
  exportButton.className = 'btn-action';
  exportButton.textContent = 'EXPORT';
  exportButton.addEventListener('click', async () => {
    await exportPaletteAsImage(palette);
  });

  const copyButton = document.createElement('button');
  copyButton.className = 'btn-action';
  copyButton.textContent = 'COPIER';
  copyButton.addEventListener('click', async () => {
    const colorsText = palette.colors.map((color) => toRgbCss(color)).join('\n');
    const copied = await copyTextToClipboard(colorsText);

    if (!copied) {
      return;
    }

    copyButton.textContent = 'FAIT';
    window.setTimeout(() => {
      copyButton.textContent = 'COPIER';
    }, 1500);
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn-action btn-delete';
  deleteButton.textContent = '×';
  deleteButton.addEventListener('click', async () => {
    await deletePalette(palette.id);
    await loadCollectionUi();
  });

  actionsContainer.append(exportButton, copyButton, deleteButton);
  card.append(swatchesContainer, actionsContainer);

  return card;
}

async function loadCollectionUi() {
  const palettes = await getSavedPalettes();
  collectionGrid.innerHTML = '';

  if (palettes.length === 0) {
    collectionGrid.innerHTML = '<p class="empty-message">No palettes saved yet</p>';
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
    collectionPanel.classList.remove('visible');
  });
}

bindCollectionUiEvents();
