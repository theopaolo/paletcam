// Palette Storage System
const STORAGE_KEY = 'paletcam_palettes';

// Get all saved palettes from localStorage
function getSavedPalettes() {
  const palettes = localStorage.getItem(STORAGE_KEY);
  return palettes ? JSON.parse(palettes) : [];
}

// Save a new palette to localStorage
function savePalette(colors, imageDataUrl, photoDataUrl) {
  const palettes = getSavedPalettes();
  const newPalette = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    colors: colors, // Array of {r, g, b} objects
    imageDataUrl: imageDataUrl, // Base64 image data for palette
    photoDataUrl: photoDataUrl // Base64 image data for photo
  };

  palettes.unshift(newPalette); // Add to beginning of array
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));

  return newPalette;
}

// Delete a palette by ID
function deletePalette(id) {
  const palettes = getSavedPalettes();
  const filtered = palettes.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

// Export palette as JSON
function exportPaletteAsJSON(palette) {
  const dataStr = JSON.stringify(palette, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

  const link = document.createElement('a');
  link.setAttribute('href', dataUri);
  link.setAttribute('download', `palette-${palette.id}.json`);
  link.click();
}

// Export palette as CSS variables
function exportPaletteAsCSS(palette) {
  let cssContent = ':root {\n';
  palette.colors.forEach((color, index) => {
    cssContent += `  --color-${index + 1}: rgb(${color.r}, ${color.g}, ${color.b});\n`;
  });
  cssContent += '}';

  const dataUri = 'data:text/css;charset=utf-8,' + encodeURIComponent(cssContent);
  const link = document.createElement('a');
  link.setAttribute('href', dataUri);
  link.setAttribute('download', `palette-${palette.id}.css`);
  link.click();
}

// Copy palette colors to clipboard
function copyPaletteToClipboard(palette) {
  const colorsText = palette.colors
    .map((c, i) => `Color ${i + 1}: rgb(${c.r}, ${c.g}, ${c.b})`)
    .join('\n');

  navigator.clipboard.writeText(colorsText).then(() => {
    console.log('Palette colors copied to clipboard');
  });
}
