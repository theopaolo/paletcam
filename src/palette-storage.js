import Dexie from './vendor/dexie.mjs';

/** @type {PaletcamDb} */
const db = /** @type {any} */ (new Dexie('PaletcamDB'));
const KNOWN_MODERATION_STATUSES = new Set([
  'TO_MODERATE',
  'PUBLIC',
  'REJECTED',
  'PRIVATE',
]);

db.version(1).stores({
  palettes: '++id, timestamp',
});

db.version(2).stores({
  palettes: '++id, timestamp, remoteCatchId, moderationStatus',
}).upgrade((transaction) =>
  transaction.table('palettes').toCollection().modify((palette) => {
    if (!Object.hasOwn(palette, 'remoteCatchId')) {
      palette.remoteCatchId = null;
    }

    if (!Object.hasOwn(palette, 'moderationStatus')) {
      palette.moderationStatus = null;
    }

    if (!Object.hasOwn(palette, 'postedAt')) {
      palette.postedAt = null;
    }

    if (!Object.hasOwn(palette, 'moderationUpdatedAt')) {
      palette.moderationUpdatedAt = null;
    }

    if (!Object.hasOwn(palette, 'lastModerationCheckAt')) {
      palette.lastModerationCheckAt = null;
    }
  }));

function normalizeRemoteCatchId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeModerationStatus(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return KNOWN_MODERATION_STATUSES.has(normalized) ? normalized : null;
}

function normalizeIsoString(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

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

/** @returns {Promise<Palette[]>} */
export async function getSavedPalettes() {
  try {
    return await db.palettes.reverse().toArray();
  } catch (error) {
    console.error('Failed to read saved palettes:', error);
    throw error;
  }
}

/**
 * @param {RgbColor[]} colors
 * @param {object} [options]
 * @param {string} [options.photoDataUrl]
 * @param {Blob | null} [options.photoBlob]
 * @param {string} [options.captureAspectRatio]
 * @param {CropRect | null} [options.captureCropRect]
 * @returns {Promise<Palette>}
 */
export async function savePalette(
  colors,
  {
    photoDataUrl,
    photoBlob: providedPhotoBlob = null,
    captureAspectRatio = '4:3',
    captureCropRect = null,
  } = {},
) {
  const timestamp = new Date().toISOString();
  const photoBlob = providedPhotoBlob instanceof Blob
    ? providedPhotoBlob
    : typeof photoDataUrl === 'string' && photoDataUrl.length > 0
      ? dataUrlToBlob(photoDataUrl)
      : null;

  if (!(photoBlob instanceof Blob)) {
    throw new Error('Missing photo data.');
  }
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
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    });

    return {
      id,
      timestamp,
      colors: [...colors],
      photoBlob,
      captureAspectRatio,
      captureCropRect: safeCaptureCropRect,
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    };
  } catch (error) {
    console.error('Failed to save palette:', error);
    throw new Error('Unable to save palette.');
  }
}

/**
 * @param {number} id
 * @param {Partial<Pick<Palette, 'remoteCatchId' | 'moderationStatus' | 'postedAt' | 'moderationUpdatedAt' | 'lastModerationCheckAt'>>} [patch]
 * @returns {Promise<Palette | undefined>}
 */
export async function updatePaletteRemoteState(id, patch = {}) {
  const paletteId = Number(id);
  if (!Number.isFinite(paletteId)) {
    throw new Error('Invalid palette id.');
  }

  const nextPatch = {};

  if (Object.hasOwn(patch, 'remoteCatchId')) {
    nextPatch.remoteCatchId = normalizeRemoteCatchId(patch.remoteCatchId);
  }

  if (Object.hasOwn(patch, 'moderationStatus')) {
    nextPatch.moderationStatus = normalizeModerationStatus(patch.moderationStatus);
  }

  if (Object.hasOwn(patch, 'postedAt')) {
    nextPatch.postedAt = normalizeIsoString(patch.postedAt);
  }

  if (Object.hasOwn(patch, 'moderationUpdatedAt')) {
    nextPatch.moderationUpdatedAt = normalizeIsoString(patch.moderationUpdatedAt);
  }

  if (Object.hasOwn(patch, 'lastModerationCheckAt')) {
    nextPatch.lastModerationCheckAt = normalizeIsoString(patch.lastModerationCheckAt);
  }

  if (Object.keys(nextPatch).length === 0) {
    return db.palettes.get(paletteId);
  }

  try {
    await db.palettes.update(paletteId, nextPatch);
    return await db.palettes.get(paletteId);
  } catch (error) {
    console.error(`Failed to update remote state for palette ${paletteId}:`, error);
    throw new Error('Unable to update palette remote state.');
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** @returns {Promise<string>} JSON string of all palettes */
export async function exportAllPalettes() {
  const palettes = await db.palettes.toArray();
  const serialized = [];

  for (const palette of palettes) {
    const entry = { ...palette };
    if (entry.photoBlob instanceof Blob) {
      entry.photoBlob = await blobToBase64(entry.photoBlob);
    }
    delete entry.id;
    serialized.push(entry);
  }

  return JSON.stringify({ version: 2, palettes: serialized });
}

/**
 * @param {string} jsonString
 * @returns {Promise<number>} number of palettes imported
 */
export async function importAllPalettes(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data || !Array.isArray(data.palettes)) {
    throw new Error('Format de fichier invalide.');
  }

  let importedCount = 0;

  for (const entry of data.palettes) {
    const palette = { ...entry };
    if (typeof palette.photoBlob === 'string' && palette.photoBlob.startsWith('data:')) {
      palette.photoBlob = dataUrlToBlob(palette.photoBlob);
    }
    delete palette.id;

    palette.remoteCatchId = palette.remoteCatchId ?? null;
    palette.moderationStatus = palette.moderationStatus ?? null;
    palette.postedAt = palette.postedAt ?? null;
    palette.moderationUpdatedAt = palette.moderationUpdatedAt ?? null;
    palette.lastModerationCheckAt = palette.lastModerationCheckAt ?? null;

    await db.palettes.add(palette);
    importedCount += 1;
  }

  return importedCount;
}
