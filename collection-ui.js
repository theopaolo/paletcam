// Collection UI functionality
const collectionPanel = document.querySelector('.collection-panel');
const collectionGrid = document.getElementById('collectionGrid');
const btnViewCollection = document.querySelector('.btn-view-collection');
const btnCloseCollection = document.querySelector('.btn-close-collection');

// Export palette as image (photo + color swatches)
async function exportPaletteAsImage(palette) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Create image from blob
  const img = new Image();
  const photoURL = URL.createObjectURL(palette.photoBlob);

  img.onload = () => {
    const photoWidth = img.width;
    const photoHeight = img.height;
    const swatchHeight = 100;

    // Set canvas size: photo on top, swatches below
    canvas.width = photoWidth;
    canvas.height = photoHeight + swatchHeight;

    // Draw photo
    ctx.drawImage(img, 0, 0, photoWidth, photoHeight);

    // Draw color swatches
    const swatchWidth = photoWidth / palette.colors.length;
    palette.colors.forEach((color, index) => {
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(index * swatchWidth, photoHeight, swatchWidth, swatchHeight);
    });

    // Export as WebP
    canvas.toBlob((blob) => {
      const link = document.createElement('a');
      link.download = `palette-${palette.id}.webp`;
      link.href = URL.createObjectURL(blob);
      link.click();

      // Cleanup
      URL.revokeObjectURL(link.href);
      URL.revokeObjectURL(photoURL);
    }, 'image/webp', 0.95);
  };

  img.src = photoURL;
}

// Open collection panel
btnViewCollection.addEventListener('click', () => {
  collectionPanel.classList.add('visible');
  loadCollectionUI();
});

// Close collection panel
btnCloseCollection.addEventListener('click', () => {
  collectionPanel.classList.remove('visible');
});

// Load and display all saved palettes
async function loadCollectionUI() {
  const palettes = await getSavedPalettes();
  collectionGrid.innerHTML = '';

  if (palettes.length === 0) {
    collectionGrid.innerHTML = '<p class="empty-message">No palettes saved yet</p>';
    return;
  }

  palettes.forEach(palette => {
    const paletteCard = createPaletteCard(palette);
    collectionGrid.appendChild(paletteCard);
  });
}

// Create a palette card element
function createPaletteCard(palette) {
  const card = document.createElement('div');
  card.className = 'palette-card';

  // Create color swatches
  const swatchesDiv = document.createElement('div');
  swatchesDiv.className = 'palette-swatches';

  // Add photo as first item if available
  if (palette.photoBlob) {
    const photoSwatch = document.createElement('div');
    photoSwatch.className = 'color-swatch photo-swatch';
    const photoURL = URL.createObjectURL(palette.photoBlob);
    photoSwatch.style.backgroundImage = `url(${photoURL})`;
    photoSwatch.style.backgroundSize = 'cover';
    photoSwatch.style.backgroundPosition = 'center';
    photoSwatch.style.cursor = 'pointer';
    photoSwatch.title = 'Click to copy photo';

    // Copy photo to clipboard when clicking
    photoSwatch.addEventListener('click', async () => {
      try {
        // Load WebP image
        const img = new Image();
        const photoURL = URL.createObjectURL(palette.photoBlob);

        img.onload = async () => {
          // Create canvas with image dimensions
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // Convert to PNG blob
          canvas.toBlob(async (pngBlob) => {
            try {
              // Create ClipboardItem with PNG
              const item = new ClipboardItem({
                'image/png': pngBlob
              });

              await navigator.clipboard.write([item]);
              console.log('Photo copied to clipboard as PNG');
            } catch (err) {
              console.error('Failed to copy photo:', err);
              // Fallback: Download the image instead
              const link = document.createElement('a');
              link.download = `photo-${palette.id}.png`;
              link.href = URL.createObjectURL(pngBlob);
              link.click();
              URL.revokeObjectURL(link.href);
            }

            // Cleanup
            URL.revokeObjectURL(photoURL);
          }, 'image/png');
        };

        img.src = photoURL;
      } catch (err) {
        console.error('Failed to process photo:', err);
      }
    });

    swatchesDiv.appendChild(photoSwatch);
  }

  palette.colors.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.title = `rgb(${color.r}, ${color.g}, ${color.b})`;

    // Copy color on click
    swatch.addEventListener('click', () => {
      const colorText = `rgb(${color.r}, ${color.g}, ${color.b})`;
      navigator.clipboard.writeText(colorText).then(() => {
        console.log('Color copied:', colorText);
      });
    });

    swatchesDiv.appendChild(swatch);
  });

  // Create actions div
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'palette-actions';

  function copyToClipBoard(palette, button) {
     const colorsText = palette.colors
      .map(color => `rgb(${color.r}, ${color.g}, ${color.b})`)
      .join('\n');

    navigator.clipboard.writeText(colorsText).then(() => {
      // Visual feedback
      button.textContent = 'FAIT';
      setTimeout(() => {
        button.textContent = 'COPIER';
      }, 1500);
    });
  }

  // Export palette as image
  const btnExport = document.createElement('button');
  btnExport.className = 'btn-action';
  btnExport.textContent = 'EXPORT';
  btnExport.addEventListener('click', async () => {
    await exportPaletteAsImage(palette);
  });

  // Copy to clipboard
  const btnCopySwatches = document.createElement('button');
  btnCopySwatches.className = 'btn-action';
  btnCopySwatches.textContent = 'COPIER';
  btnCopySwatches.addEventListener('click', () => {
    copyToClipBoard(palette, btnCopySwatches);
  });

  // Delete button
  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn-action btn-delete';
  btnDelete.textContent = '×';
  btnDelete.addEventListener('click', async () => {
    await deletePalette(palette.id);
    loadCollectionUI();
  });

  // Three buttons: Export, Copy, and Delete
  actionsDiv.appendChild(btnExport);
  actionsDiv.appendChild(btnCopySwatches);
  actionsDiv.appendChild(btnDelete);

  card.appendChild(swatchesDiv);
  card.appendChild(actionsDiv);

  return card;
}
