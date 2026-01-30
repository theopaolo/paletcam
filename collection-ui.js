// Collection UI functionality
const collectionPanel = document.querySelector('.collection-panel');
const collectionGrid = document.getElementById('collectionGrid');
const btnViewCollection = document.querySelector('.btn-view-collection');
const btnCloseCollection = document.querySelector('.btn-close-collection');

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
function loadCollectionUI() {
  const palettes = getSavedPalettes();
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

  // Export PNG button
  const btnExportPNG = document.createElement('button');
  btnExportPNG.className = 'btn-action';
  btnExportPNG.textContent = 'PNG';
  btnExportPNG.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `palette-${palette.id}.png`;
    link.href = palette.imageDataUrl;
    link.click();
  });

  // Export JSON button
  const btnExportJSON = document.createElement('button');
  btnExportJSON.className = 'btn-action';
  btnExportJSON.textContent = 'JSON';
  btnExportJSON.addEventListener('click', () => {
    exportPaletteAsJSON(palette);
  });

  // Export CSS button
  const btnExportCSS = document.createElement('button');
  btnExportCSS.className = 'btn-action';
  btnExportCSS.textContent = 'CSS';
  btnExportCSS.addEventListener('click', () => {
    exportPaletteAsCSS(palette);
  });

  // Delete button
  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn-action btn-delete';
  btnDelete.textContent = '×';
  btnDelete.addEventListener('click', () => {
    deletePalette(palette.id);
    loadCollectionUI();
  });

  actionsDiv.appendChild(btnExportPNG);
  actionsDiv.appendChild(btnExportJSON);
  actionsDiv.appendChild(btnExportCSS);
  actionsDiv.appendChild(btnDelete);

  card.appendChild(swatchesDiv);
  card.appendChild(actionsDiv);

  return card;
}
