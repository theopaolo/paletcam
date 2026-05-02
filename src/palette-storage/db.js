import Dexie from '../vendor/dexie.mjs';
import {
  createPaletteAssetRecord,
  normalizeStoredPaletteRecord,
} from './records.js';

/** @type {PaletcamDb} */
export const db = /** @type {PaletcamDb} */ (new Dexie('PaletcamDB'));

function applyPaletteRemoteStateDefaults(palette) {
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
}

db.version(1).stores({
  palettes: '++id, timestamp',
});

db.version(2).stores({
  palettes: '++id, timestamp, remoteCatchId, moderationStatus',
}).upgrade((transaction) =>
  transaction.table('palettes').toCollection().modify(applyPaletteRemoteStateDefaults));

db.version(3).stores({
  palettes: '++id, timestamp, remoteCatchId, moderationStatus',
  paletteAssets: '&paletteId',
}).upgrade(async (transaction) => {
  const paletteTable = transaction.table('palettes');
  const paletteAssetTable = transaction.table('paletteAssets');
  const palettes = await paletteTable.toArray();

  if (palettes.length === 0) {
    return;
  }

  const nextPalettes = [];
  const nextPaletteAssets = [];

  palettes.forEach((palette) => {
    const nextPalette = normalizeStoredPaletteRecord(palette, { includePhotoBlob: false });

    if (palette?.photoBlob instanceof Blob) {
      nextPaletteAssets.push(createPaletteAssetRecord(palette.id, palette.photoBlob));
      nextPalette.hasPhotoAsset = true;
    }

    nextPalettes.push(nextPalette);
  });

  if (nextPaletteAssets.length > 0) {
    await paletteAssetTable.bulkPut(nextPaletteAssets);
  }

  await paletteTable.bulkPut(nextPalettes);
});
