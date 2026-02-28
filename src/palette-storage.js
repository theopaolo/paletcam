import Dexie from './vendor/dexie.mjs';

const db = new Dexie('PaletcamDB');
const KNOWN_MODERATION_STATUSES = new Set([
  'TO_MODERATE',
  'VALID',
  'REJECTED',
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
