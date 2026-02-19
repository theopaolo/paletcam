import Dexie from './vendor/dexie.mjs';

const db = new Dexie('PaletcamDB');

db.version(1).stores({
  palettes: '++id, timestamp',
});

function dataUrlToBlob(dataUrl) {
  const [header, content] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);

  if (!mimeMatch) {
    throw new Error('Invalid data URL format.');
  }

  const mimeType = mimeMatch[1];
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);

  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export async function getSavedPalettes() {
  try {
    return await db.palettes.reverse().toArray();
  } catch (error) {
    console.error('Failed to read saved palettes:', error);
    return [];
  }
}

export async function savePalette(colors, photoDataUrl) {
  const timestamp = new Date().toISOString();
  const photoBlob = dataUrlToBlob(photoDataUrl);

  try {
    const id = await db.palettes.add({
      timestamp,
      colors: [...colors],
      photoBlob,
    });

    return { id, timestamp, colors: [...colors], photoBlob };
  } catch (error) {
    console.error('Failed to save palette:', error);
    throw new Error('Unable to save palette.');
  }
}

export async function deletePalette(id) {
  try {
    await db.palettes.delete(id);
  } catch (error) {
    console.error(`Failed to delete palette ${id}:`, error);
    throw new Error('Unable to delete palette.');
  }
}
