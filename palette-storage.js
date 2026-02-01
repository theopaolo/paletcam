// Palette Storage System with IndexedDB and Dexie
const db = new Dexie('PaletcamDB');
db.version(1).stores({
  palettes: '++id, timestamp'
});

// Utility function to convert data URL to Blob
function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while(n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], {type: mime});
}

// Get all saved palettes from IndexedDB
async function getSavedPalettes() {
  return await db.palettes.reverse().toArray();
}

// Save a new palette to IndexedDB
async function savePalette(colors, photoDataURL) {
  const photoBlob = dataURLtoBlob(photoDataURL);

  const id = await db.palettes.add({
    timestamp: new Date().toISOString(),
    colors: colors,
    photoBlob: photoBlob
  });

  return { id, timestamp: new Date().toISOString(), colors, photoBlob };
}

// Delete a palette by ID
async function deletePalette(id) {
  await db.palettes.delete(id);
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
