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

export async function savePalette(
  colors,
  {
    photoDataUrl,
    captureAspectRatio = '4:3',
    captureCropRect = null,
  } = {},
) {
  const timestamp = new Date().toISOString();
  if (typeof photoDataUrl !== 'string' || photoDataUrl.length === 0) {
    throw new Error('Missing photo data.');
  }

  const photoBlob = dataUrlToBlob(photoDataUrl);
  const safeCaptureCropRect = captureCropRect
    ? {
        x: Number(captureCropRect.x) || 0,
        y: Number(captureCropRect.y) || 0,
        width: Number(captureCropRect.width) || 0,
        height: Number(captureCropRect.height) || 0,
      }
    : null;

  try {
    const id = await db.palettes.add({
      timestamp,
      colors: [...colors],
      photoBlob,
      captureAspectRatio,
      captureCropRect: safeCaptureCropRect,
    });

    return {
      id,
      timestamp,
      colors: [...colors],
      photoBlob,
      captureAspectRatio,
      captureCropRect: safeCaptureCropRect,
    };
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
