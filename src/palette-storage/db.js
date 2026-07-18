import Dexie from "../vendor/dexie.mjs";
import {
  createLeanPaletteMetadataRecord,
  createPaletteAssetRecord,
  createPalettePreviewRecord,
  normalizeStoredPaletteRecord,
} from "./records.js";
import { createDatabaseLifecycleCoordinator } from "./database-lifecycle.js";

export const VERSION_3_MIGRATION_BATCH_SIZE = 25;
export const VERSION_4_MIGRATION_BATCH_SIZE = 25;

/** @type {PaletcamDb} */
export const db = /** @type {PaletcamDb} */ (/** @type {unknown} */ (new Dexie("PaletcamDB")));
const databaseLifecycle = createDatabaseLifecycleCoordinator(db);

export const subscribePaletteDatabaseLifecycle = databaseLifecycle.subscribe;

export function applyPaletteRemoteStateDefaults(palette) {
  if (!Object.hasOwn(palette, "remoteCatchId")) {
    palette.remoteCatchId = null;
  }

  if (!Object.hasOwn(palette, "moderationStatus")) {
    palette.moderationStatus = null;
  }

  if (!Object.hasOwn(palette, "postedAt")) {
    palette.postedAt = null;
  }

  if (!Object.hasOwn(palette, "moderationUpdatedAt")) {
    palette.moderationUpdatedAt = null;
  }

  if (!Object.hasOwn(palette, "lastModerationCheckAt")) {
    palette.lastModerationCheckAt = null;
  }
}

export function createVersion3MigrationRecords(palettes) {
  const nextPalettes = [];
  const nextPaletteAssets = [];

  for (const palette of Array.isArray(palettes) ? palettes : []) {
    if (!palette || typeof palette !== "object") {
      continue;
    }

    const nextPalette = normalizeStoredPaletteRecord(palette, { includePhotoBlob: false });
    if (palette.photoBlob instanceof Blob && palette.id !== undefined && palette.id !== null) {
      nextPaletteAssets.push(createPaletteAssetRecord(palette.id, palette.photoBlob));
      nextPalette.hasPhotoAsset = true;
    } else if (palette.photoBlob instanceof Blob) {
      nextPalette.hasPhotoAsset = false;
    }
    nextPalettes.push(nextPalette);
  }

  return { nextPalettes, nextPaletteAssets };
}

export function createVersion4MigrationRecords(palettes) {
  const nextPalettes = [];
  const nextPalettePreviews = [];

  for (const palette of Array.isArray(palettes) ? palettes : []) {
    if (!palette || typeof palette !== "object") {
      continue;
    }

    const paletteId = palette.id;
    if (typeof paletteId !== "number" || !Number.isFinite(paletteId)) {
      continue;
    }

    const galleryPreview = createPalettePreviewRecord(
      paletteId,
      "gallery",
      palette.previewGalleryBlob,
      palette.previewGalleryFooterLabel,
    );
    const hasViewerSpecificPreview = palette.previewViewerBlob instanceof Blob;
    const viewerPreview = createPalettePreviewRecord(
      paletteId,
      "viewer",
      hasViewerSpecificPreview ? palette.previewViewerBlob : palette.previewBlob,
      hasViewerSpecificPreview ? palette.previewViewerFooterLabel : palette.previewFooterLabel,
    );

    if (galleryPreview) {
      nextPalettePreviews.push(galleryPreview);
    }
    if (viewerPreview) {
      nextPalettePreviews.push(viewerPreview);
    }

    nextPalettes.push(createLeanPaletteMetadataRecord(palette));
  }

  return { nextPalettes, nextPalettePreviews };
}

export async function migratePaletteStorageToVersion3(
  transaction,
  { batchSize = VERSION_3_MIGRATION_BATCH_SIZE } = {},
) {
  const paletteTable = transaction.table("palettes");
  const paletteAssetTable = transaction.table("paletteAssets");
  const paletteKeys = await paletteTable.toCollection().primaryKeys();
  const normalizedBatchSize = Math.max(
    1,
    Math.min(VERSION_3_MIGRATION_BATCH_SIZE, Math.floor(Number(batchSize)) || 1),
  );

  for (let index = 0; index < paletteKeys.length; index += normalizedBatchSize) {
    const batchKeys = paletteKeys.slice(index, index + normalizedBatchSize);
    const palettes = await paletteTable.bulkGet(batchKeys);
    const { nextPalettes, nextPaletteAssets } = createVersion3MigrationRecords(palettes);

    if (nextPaletteAssets.length > 0) {
      await paletteAssetTable.bulkPut(nextPaletteAssets);
    }
    if (nextPalettes.length > 0) {
      await paletteTable.bulkPut(nextPalettes);
    }
  }
}

function getPaletteIdFromPreviewKey(key) {
  return Array.isArray(key) ? key[0] : undefined;
}

export async function migratePaletteStorageToVersion4(
  transaction,
  { batchSize = VERSION_4_MIGRATION_BATCH_SIZE } = {},
) {
  const paletteTable = transaction.table("palettes");
  const paletteAssetTable = transaction.table("paletteAssets");
  const palettePreviewTable = transaction.table("palettePreviews");
  const paletteKeys = await paletteTable.toCollection().primaryKeys();
  const normalizedBatchSize = Math.max(
    1,
    Math.min(VERSION_4_MIGRATION_BATCH_SIZE, Math.floor(Number(batchSize)) || 1),
  );

  for (let index = 0; index < paletteKeys.length; index += normalizedBatchSize) {
    const batchKeys = paletteKeys.slice(index, index + normalizedBatchSize);
    const palettes = await paletteTable.bulkGet(batchKeys);
    const { nextPalettes, nextPalettePreviews } = createVersion4MigrationRecords(palettes);

    if (nextPalettePreviews.length > 0) {
      await palettePreviewTable.bulkPut(nextPalettePreviews);
    }
    if (nextPalettes.length > 0) {
      await paletteTable.bulkPut(nextPalettes);
    }
  }

  const paletteKeySet = new Set(paletteKeys);
  const assetKeys = await paletteAssetTable.toCollection().primaryKeys();
  const orphanAssetKeys = assetKeys.filter((paletteId) => !paletteKeySet.has(paletteId));
  if (orphanAssetKeys.length > 0) {
    await paletteAssetTable.bulkDelete(orphanAssetKeys);
  }

  const previewKeys = await palettePreviewTable.toCollection().primaryKeys();
  const orphanPreviewKeys = previewKeys.filter(
    (previewKey) => !paletteKeySet.has(getPaletteIdFromPreviewKey(previewKey)),
  );
  if (orphanPreviewKeys.length > 0) {
    await palettePreviewTable.bulkDelete(orphanPreviewKeys);
  }
}

db.version(1).stores({
  palettes: "++id, timestamp",
});

db.version(2)
  .stores({
    palettes: "++id, timestamp, remoteCatchId, moderationStatus",
  })
  .upgrade(async (transaction) => {
    await transaction.table("palettes").toCollection().modify(applyPaletteRemoteStateDefaults);
  });

db.version(3)
  .stores({
    palettes: "++id, timestamp, remoteCatchId, moderationStatus",
    paletteAssets: "&paletteId",
  })
  .upgrade(migratePaletteStorageToVersion3);

db.version(4)
  .stores({
    palettes: "++id, timestamp, remoteCatchId, moderationStatus",
    paletteAssets: "&paletteId",
    palettePreviews: "[paletteId+variant], paletteId",
    paletteStorageMetadata: "&key",
  })
  .upgrade(migratePaletteStorageToVersion4);

db.version(5).stores({
  palettes: "++id, timestamp, remoteCatchId, moderationStatus",
  paletteAssets: "&paletteId",
  palettePreviews: "[paletteId+variant], paletteId",
  paletteStorageMetadata: "&key",
  communityDeleteOutbox: "&key, accountKey, [accountKey+nextAttemptAt], leaseExpiresAt",
});

db.version(6).stores({
  palettes: "++id, timestamp, remoteCatchId, moderationStatus",
  paletteAssets: "&paletteId",
  palettePreviews: "[paletteId+variant], paletteId",
  paletteStorageMetadata: "&key",
  communityDeleteOutbox: "&key, accountKey, [accountKey+nextAttemptAt], leaseExpiresAt",
  paletteImportStaging: "[sessionId+ordinal], sessionId",
});

db.version(7)
  .stores({
    palettes: "++id, timestamp, remoteCatchId, remoteOwnerAccountKey, moderationStatus",
    paletteAssets: "&paletteId",
    palettePreviews: "[paletteId+variant], paletteId",
    paletteStorageMetadata: "&key",
    communityDeleteOutbox: "&key, accountKey, [accountKey+nextAttemptAt], leaseExpiresAt",
    paletteImportStaging: "[sessionId+ordinal], sessionId",
  })
  .upgrade(async (transaction) => {
    await transaction
      .table("palettes")
      .toCollection()
      .modify((palette) => {
        if (!Object.hasOwn(palette, "remoteOwnerAccountKey")) {
          palette.remoteOwnerAccountKey = null;
        }
      });
  });
