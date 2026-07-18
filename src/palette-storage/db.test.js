import { describe, expect, test } from "bun:test";

import {
  applyPaletteRemoteStateDefaults,
  createVersion3MigrationRecords,
  createVersion4MigrationRecords,
  db,
  migratePaletteStorageToVersion3,
  migratePaletteStorageToVersion4,
  VERSION_3_MIGRATION_BATCH_SIZE,
  VERSION_4_MIGRATION_BATCH_SIZE,
} from "./db.js";
import { createPaletteMetadataRecord, createPalettePreviewRecord } from "./records.js";

function createMigrationTransaction({ palettes, assetKeys = [], previewKeys = [] }) {
  const palettesById = new Map(palettes.map((palette) => [palette.id, palette]));
  const storedPreviewKeys = [...previewKeys];
  const calls = {
    paletteBulkGets: [],
    paletteBulkPuts: [],
    assetBulkPuts: [],
    previewBulkPuts: [],
    assetBulkDeletes: [],
    previewBulkDeletes: [],
  };
  const tables = {
    palettes: {
      toCollection: () => ({ primaryKeys: async () => [...palettesById.keys()] }),
      bulkGet: async (keys) => {
        calls.paletteBulkGets.push([...keys]);
        return keys.map((key) => palettesById.get(key));
      },
      bulkPut: async (records) => {
        calls.paletteBulkPuts.push([...records]);
        for (const record of records) {
          palettesById.set(record.id, record);
        }
      },
    },
    paletteAssets: {
      toCollection: () => ({ primaryKeys: async () => [...assetKeys] }),
      bulkPut: async (records) => {
        calls.assetBulkPuts.push([...records]);
      },
      bulkDelete: async (keys) => {
        calls.assetBulkDeletes.push([...keys]);
      },
    },
    palettePreviews: {
      toCollection: () => ({ primaryKeys: async () => [...storedPreviewKeys] }),
      bulkPut: async (records) => {
        calls.previewBulkPuts.push([...records]);
        for (const record of records) {
          const key = [record.paletteId, record.variant];
          if (
            !storedPreviewKeys.some(
              (candidate) => candidate[0] === key[0] && candidate[1] === key[1],
            )
          ) {
            storedPreviewKeys.push(key);
          }
        }
      },
      bulkDelete: async (keys) => {
        calls.previewBulkDeletes.push([...keys]);
      },
    },
  };

  return {
    calls,
    palettesById,
    transaction: {
      table: (name) => tables[name],
    },
  };
}

describe("palette database migrations", () => {
  test("version 2 preserves remote state and fills only missing fields", () => {
    const palette = { remoteCatchId: "remote-1", moderationStatus: "PUBLIC" };
    applyPaletteRemoteStateDefaults(palette);

    expect(palette.remoteCatchId).toBe("remote-1");
    expect(palette.moderationStatus).toBe("PUBLIC");
    expect(palette.postedAt).toBeNull();
    expect(palette.moderationUpdatedAt).toBeNull();
    expect(palette.lastModerationCheckAt).toBeNull();
  });

  test("version 3 moves legacy photos into the asset store", () => {
    const photoBlob = new Blob(["photo"], { type: "image/webp" });
    const { nextPalettes, nextPaletteAssets } = createVersion3MigrationRecords([
      { id: 4, timestamp: "2025-01-01T00:00:00.000Z", colors: [], photoBlob },
    ]);

    expect(nextPalettes).toHaveLength(1);
    expect(nextPalettes[0].photoBlob).toBeUndefined();
    expect(nextPalettes[0].hasPhotoAsset).toBe(true);
    expect(nextPaletteAssets).toEqual([{ paletteId: 4, photoBlob }]);
  });

  test("version 3 tolerates malformed entries and does not orphan an unkeyed photo", () => {
    const photoBlob = new Blob(["photo"]);
    const result = createVersion3MigrationRecords([null, "bad", { colors: [], photoBlob }]);

    expect(result.nextPalettes).toHaveLength(1);
    expect(result.nextPalettes[0].hasPhotoAsset).toBe(false);
    expect(result.nextPaletteAssets).toEqual([]);
  });

  test("version 3 migrates historical photo blobs in batches no larger than 25", async () => {
    const palettes = Array.from({ length: 61 }, (_, index) => ({
      id: index + 1,
      timestamp: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      colors: [],
      photoBlob: new Blob([`photo-${index + 1}`], { type: "image/webp" }),
    }));
    const { calls, palettesById, transaction } = createMigrationTransaction({ palettes });

    await migratePaletteStorageToVersion3(transaction, { batchSize: 100 });

    expect(VERSION_3_MIGRATION_BATCH_SIZE).toBe(25);
    expect(calls.paletteBulkGets.map((keys) => keys.length)).toEqual([25, 25, 11]);
    expect(calls.assetBulkPuts.flat()).toHaveLength(61);
    expect(calls.assetBulkPuts.flat()[0].photoBlob).toBe(palettes[0].photoBlob);
    expect(Object.hasOwn(palettesById.get(1), "photoBlob")).toBe(false);
    expect(palettesById.get(1).hasPhotoAsset).toBe(true);
  });

  test("version 7 declares owner binding, preview, maintenance, outbox, and staging stores", () => {
    expect(db.verno).toBe(7);
    expect(db.table("palettes").schema.indexes.map((index) => index.src)).toContain(
      "remoteOwnerAccountKey",
    );
    expect(db.table("palettePreviews").schema.primKey.src).toBe("[paletteId+variant]");
    expect(db.table("palettePreviews").schema.indexes.map((index) => index.src)).toContain(
      "paletteId",
    );
    expect(db.table("paletteStorageMetadata").schema.primKey.src).toBe("key");
    expect(db.table("communityDeleteOutbox").schema.primKey.src).toBe("key");
    expect(db.table("communityDeleteOutbox").schema.indexes.map((index) => index.src)).toContain(
      "[accountKey+nextAttemptAt]",
    );
    expect(db.table("paletteImportStaging").schema.primKey.src).toBe("[sessionId+ordinal]");
    expect(db.table("paletteImportStaging").schema.indexes.map((index) => index.src)).toContain(
      "sessionId",
    );
  });

  test("version 4 preserves gallery and viewer previews while scrubbing palette metadata", () => {
    const galleryBlob = new Blob(["gallery"], { type: "image/webp" });
    const viewerBlob = new Blob(["viewer"], { type: "image/webp" });
    const { nextPalettes, nextPalettePreviews } = createVersion4MigrationRecords([
      {
        id: 7,
        timestamp: "2025-01-01T00:00:00.000Z",
        colors: ["#112233"],
        previewGalleryBlob: galleryBlob,
        previewGalleryFooterLabel: "gallery-v1",
        previewViewerBlob: viewerBlob,
        previewViewerFooterLabel: "viewer-v1",
        previewBlob: new Blob(["legacy"]),
        previewFooterLabel: "legacy-v1",
      },
    ]);

    expect(nextPalettePreviews).toEqual([
      {
        paletteId: 7,
        variant: "gallery",
        blob: galleryBlob,
        footerLabel: "gallery-v1",
      },
      {
        paletteId: 7,
        variant: "viewer",
        blob: viewerBlob,
        footerLabel: "viewer-v1",
      },
    ]);
    expect(nextPalettes).toHaveLength(1);
    for (const previewField of [
      "previewBlob",
      "previewFooterLabel",
      "previewGalleryBlob",
      "previewGalleryFooterLabel",
      "previewViewerBlob",
      "previewViewerFooterLabel",
    ]) {
      expect(Object.hasOwn(nextPalettes[0], previewField)).toBe(false);
    }
  });

  test("version 4 prefers viewer-specific data and falls back to the legacy preview pair", () => {
    const specificBlob = new Blob(["specific"]);
    const legacyBlob = new Blob(["legacy"]);
    const current = createVersion4MigrationRecords([
      {
        id: 1,
        colors: [],
        previewViewerBlob: specificBlob,
        previewViewerFooterLabel: "specific-label",
        previewBlob: legacyBlob,
        previewFooterLabel: "legacy-label",
      },
    ]);
    const legacy = createVersion4MigrationRecords([
      {
        id: 2,
        colors: [],
        previewBlob: legacyBlob,
        previewFooterLabel: "legacy-label",
      },
    ]);

    expect(current.nextPalettePreviews).toEqual([
      {
        paletteId: 1,
        variant: "viewer",
        blob: specificBlob,
        footerLabel: "specific-label",
      },
    ]);
    expect(legacy.nextPalettePreviews).toEqual([
      {
        paletteId: 2,
        variant: "viewer",
        blob: legacyBlob,
        footerLabel: "legacy-label",
      },
    ]);

    const mismatchedSpecificLabel = createVersion4MigrationRecords([
      {
        id: 3,
        colors: [],
        previewViewerFooterLabel: "orphan-specific-label",
        previewBlob: legacyBlob,
        previewFooterLabel: "legacy-label",
      },
    ]);
    expect(mismatchedSpecificLabel.nextPalettePreviews[0].footerLabel).toBe("legacy-label");
  });

  test("version 4 ignores malformed records and invalid preview payloads", () => {
    const result = createVersion4MigrationRecords([
      null,
      "bad",
      { id: null, colors: [], previewBlob: new Blob(["unkeyed"]) },
      { id: "3", colors: [], previewBlob: new Blob(["wrong-key-type"]) },
      {
        id: 4,
        colors: ["#abcdef"],
        previewGalleryBlob: "not-a-blob",
        previewViewerBlob: {},
      },
    ]);

    expect(result.nextPalettes).toHaveLength(1);
    expect(result.nextPalettes[0].id).toBe(4);
    expect(result.nextPalettePreviews).toEqual([]);
  });

  test("metadata and preview helpers keep persisted records lean", () => {
    const previewBlob = new Blob(["preview"]);
    const metadata = createPaletteMetadataRecord({
      id: 8,
      timestamp: "2025-01-01T00:00:00.000Z",
      colors: [],
      previewViewerBlob: previewBlob,
      previewViewerFooterLabel: "viewer-v1",
    });

    expect(Object.hasOwn(metadata, "previewViewerBlob")).toBe(false);
    expect(Object.hasOwn(metadata, "previewViewerFooterLabel")).toBe(false);
    expect(createPalettePreviewRecord(8, "gallery", previewBlob, "gallery-v1")).toEqual({
      paletteId: 8,
      variant: "gallery",
      blob: previewBlob,
      footerLabel: "gallery-v1",
    });
    expect(createPalettePreviewRecord(8, "viewer", "invalid", "viewer-v1")).toBeNull();
  });

  test("version 4 migration bulk-loads palettes in batches no larger than 25", async () => {
    const palettes = Array.from({ length: 61 }, (_, index) => ({
      id: index + 1,
      timestamp: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      colors: [],
    }));
    const { calls, transaction } = createMigrationTransaction({ palettes });

    await migratePaletteStorageToVersion4(transaction, { batchSize: 100 });

    expect(VERSION_4_MIGRATION_BATCH_SIZE).toBe(25);
    expect(calls.paletteBulkGets.map((keys) => keys.length)).toEqual([25, 25, 11]);
    expect(calls.paletteBulkGets.every((keys) => keys.length <= 25)).toBe(true);
  });

  test("version 4 migration deletes orphan photo and preview records", async () => {
    const galleryBlob = new Blob(["gallery"]);
    const { calls, palettesById, transaction } = createMigrationTransaction({
      palettes: [
        { id: 1, timestamp: "2025-01-01T00:00:00.000Z", colors: [] },
        {
          id: 2,
          timestamp: "2025-01-02T00:00:00.000Z",
          colors: [],
          previewGalleryBlob: galleryBlob,
          previewGalleryFooterLabel: "gallery-v1",
        },
      ],
      assetKeys: [1, 3],
      previewKeys: [
        [1, "viewer"],
        [4, "gallery"],
      ],
    });

    await migratePaletteStorageToVersion4(transaction);

    expect(calls.assetBulkDeletes).toEqual([[3]]);
    expect(calls.previewBulkDeletes).toEqual([[[4, "gallery"]]]);
    expect(calls.previewBulkPuts.flat()).toEqual([
      { paletteId: 2, variant: "gallery", blob: galleryBlob, footerLabel: "gallery-v1" },
    ]);
    expect(Object.hasOwn(palettesById.get(2), "previewGalleryBlob")).toBe(false);
  });
});
