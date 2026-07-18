import { describe, expect, test } from "bun:test";

import {
  PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
  PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
  PALETTE_IMPORT_MAX_COUNT,
  PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES,
  PALETTE_IMPORT_MAX_JSON_BYTES,
  PALETTE_IMPORT_MAX_PHOTO_BYTES,
  PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
  PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES,
  deserializePalettesFromImport,
  deserializePalettesFromImportBlob,
  serializePalettesForExport,
  serializePalettesForExportBlob,
} from "./json-transfer.js";

const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/wAARCAABAAEDAREAAhEAAxEA/9k=";
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG_BLOB = new Blob([Buffer.from(JPEG_DATA_URL.split(",")[1], "base64")], {
  type: "image/jpeg",
});

describe("palette-storage/json-transfer", () => {
  test("keeps mobile import memory bounds aligned with base64 photo overhead", () => {
    const maximumEncodedPhotoBytes = Math.ceil((PALETTE_IMPORT_MAX_PHOTO_BYTES * 4) / 3);

    expect(PALETTE_IMPORT_MAX_JSON_BYTES).toBe(32 * 1024 * 1024);
    expect(PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES).toBe(32 * 1024 * 1024);
    expect(PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES).toBe(192 * 1024 * 1024);
    expect(PALETTE_IMPORT_MAX_PHOTO_BYTES).toBe(16 * 1024 * 1024);
    expect(PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES).toBe(128 * 1024 * 1024);
    expect(maximumEncodedPhotoBytes + 10 * 1024 * 1024).toBeLessThan(PALETTE_IMPORT_MAX_JSON_BYTES);
  });

  test("serializes palettes without persisted ids or preview-only fields", async () => {
    const json = await serializePalettesForExport([
      {
        id: 42,
        timestamp: "2026-04-30T10:00:00.000Z",
        colors: [{ r: 12, g: 34, b: 56 }],
        photoBlob: JPEG_BLOB,
        previewGalleryBlob: new Blob(["gallery-preview"], { type: "text/plain" }),
        previewGalleryFooterLabel: "gallery-footer",
        previewViewerBlob: new Blob(["viewer-preview"], { type: "text/plain" }),
        previewViewerFooterLabel: "viewer-footer",
        previewBlob: new Blob(["preview"], { type: "text/plain" }),
        previewFooterLabel: "footer",
        hasPhotoAsset: true,
        remoteCatchId: "remote-secret",
        remoteOwnerAccountKey: "account:0123456789abcdef",
        moderationStatus: "PUBLIC",
        postedAt: "2026-04-30T10:00:00.000Z",
        moderationUpdatedAt: "2026-04-30T10:00:00.000Z",
        lastModerationCheckAt: "2026-04-30T10:00:00.000Z",
      },
    ]);

    const payload = JSON.parse(json);

    expect(payload.version).toBe(2);
    expect(payload.palettes).toHaveLength(1);
    expect("id" in payload.palettes[0]).toBe(false);
    expect("previewGalleryBlob" in payload.palettes[0]).toBe(false);
    expect("previewGalleryFooterLabel" in payload.palettes[0]).toBe(false);
    expect("previewViewerBlob" in payload.palettes[0]).toBe(false);
    expect("previewViewerFooterLabel" in payload.palettes[0]).toBe(false);
    expect("previewBlob" in payload.palettes[0]).toBe(false);
    expect("previewFooterLabel" in payload.palettes[0]).toBe(false);
    expect("hasPhotoAsset" in payload.palettes[0]).toBe(false);
    for (const field of [
      "remoteCatchId",
      "remoteOwnerAccountKey",
      "moderationStatus",
      "postedAt",
      "moderationUpdatedAt",
      "lastModerationCheckAt",
    ]) {
      expect(field in payload.palettes[0]).toBe(false);
      expect(json).not.toContain(`"${field}"`);
    }
    expect(payload.palettes[0].photoBlob.startsWith("data:image/jpeg")).toBe(true);
  });

  test("serializes export blobs without building the final file in the caller", async () => {
    const progressEvents = [];
    const blob = await serializePalettesForExportBlob(
      [
        {
          id: 42,
          timestamp: "2026-04-30T10:00:00.000Z",
          colors: [{ r: 12, g: 34, b: 56 }],
          photoBlob: JPEG_BLOB,
          hasPhotoAsset: true,
          remoteCatchId: "remote-secret",
          remoteOwnerAccountKey: "account:0123456789abcdef",
          moderationStatus: "PUBLIC",
        },
      ],
      {
        onProgress: (progress) => progressEvents.push(progress),
      },
    );
    const payload = JSON.parse(await blob.text());

    expect(blob.type.startsWith("application/json")).toBe(true);
    expect(payload.version).toBe(2);
    expect(payload.palettes).toHaveLength(1);
    expect("id" in payload.palettes[0]).toBe(false);
    expect(await blob.text()).not.toContain("remoteOwnerAccountKey");
    expect("remoteOwnerAccountKey" in payload.palettes[0]).toBe(false);
    expect(payload.palettes[0].photoBlob.startsWith("data:image/jpeg")).toBe(true);
    expect(progressEvents).toEqual([
      {
        completed: 1,
        phase: "serializing",
        total: 1,
      },
    ]);
  });

  test("enforces the import ceiling symmetrically for string and Blob exports", async () => {
    const palettes = [
      {
        timestamp: "2026-04-30T10:00:00.000Z",
        colors: [{ r: 12, g: 34, b: 56 }],
        note: "multibyte 🎨 contract",
      },
    ];
    const baseline = await serializePalettesForExport(palettes);
    const exactBytes = new TextEncoder().encode(baseline).byteLength;

    await expect(serializePalettesForExport(palettes, { maxJsonBytes: exactBytes })).resolves.toBe(
      baseline,
    );
    const exactBlob = await serializePalettesForExportBlob(palettes, {
      maxJsonBytes: exactBytes,
    });
    expect(exactBlob.size).toBe(exactBytes);

    for (const createExportAttempt of [
      () => serializePalettesForExport(palettes, { maxJsonBytes: exactBytes - 1 }),
      () => serializePalettesForExportBlob(palettes, { maxJsonBytes: exactBytes - 1 }),
    ]) {
      await expect(createExportAttempt()).rejects.toMatchObject({
        code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
        name: "PaletteBackupSizeLimitError",
      });
    }
  });

  test("allows incremental Blob exports beyond the in-memory string ceiling", async () => {
    const sharedNote = "x".repeat(2 * 1024 * 1024);
    const palettes = Array.from({ length: 17 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 3, 30, 10, index)).toISOString(),
      colors: [{ r: 12, g: 34, b: 56 }],
      note: sharedNote,
    }));

    await expect(serializePalettesForExport(palettes, { yieldInterval: 0 })).rejects.toMatchObject({
      code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
    });
    const blob = await serializePalettesForExportBlob(palettes, { yieldInterval: 0 });

    expect(blob.size).toBeGreaterThan(PALETTE_IMPORT_MAX_JSON_BYTES);
    expect(blob.size).toBeLessThan(PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES);
  });

  test("applies per-entry and cumulative decoded-photo limits to both export forms", async () => {
    const palettes = [
      {
        timestamp: "2026-04-30T10:00:00.000Z",
        colors: [{ r: 12, g: 34, b: 56 }],
        photoBlob: JPEG_BLOB,
      },
      {
        timestamp: "2026-04-30T11:00:00.000Z",
        colors: [{ r: 12, g: 34, b: 56 }],
        photoBlob: JPEG_BLOB,
      },
    ];

    for (const serialize of [serializePalettesForExport, serializePalettesForExportBlob]) {
      await expect(serialize(palettes, { maxTotalPhotoBytes: JPEG_BLOB.size })).rejects.toThrow(
        "cumulative import size limit",
      );
      await expect(serialize([palettes[0]], { maxEntryJsonBytes: 16 })).rejects.toThrow(
        "palette entry",
      );
    }
  });

  test("refuses to emit a backup that its importer cannot restore", async () => {
    const basePalette = {
      timestamp: "2026-04-30T10:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
    };

    for (const photoBlob of [
      new Blob(["not an image"], { type: "text/plain" }),
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
    ]) {
      await expect(
        serializePalettesForExport([{ ...basePalette, photoBlob }]),
      ).rejects.toMatchObject({
        code: PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
        name: "PaletteBackupIntegrityError",
      });
    }

    await expect(
      serializePalettesForExport([{ ...basePalette, photoBlob: JPEG_BLOB }]),
    ).resolves.toContain("data:image/jpeg;base64");
  });

  test("never exports more palettes than the importer accepts", async () => {
    const maximumPalettes = Array.from({ length: PALETTE_IMPORT_MAX_COUNT }, () => ({}));
    const excessivePalettes = [...maximumPalettes, {}];

    await expect(
      serializePalettesForExport(maximumPalettes, { yieldInterval: 0 }),
    ).resolves.toContain(`"palettes":[`);
    await expect(
      serializePalettesForExportBlob(maximumPalettes, { yieldInterval: 0 }),
    ).resolves.toBeInstanceOf(Blob);

    for (const createExportAttempt of [
      () => serializePalettesForExport(excessivePalettes),
      () => serializePalettesForExportBlob(excessivePalettes),
    ]) {
      await expect(createExportAttempt()).rejects.toMatchObject({
        code: PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
        message: `A restorable backup can contain at most ${PALETTE_IMPORT_MAX_COUNT} palettes.`,
      });
    }
  });

  test("deserializes palettes and restores blob payloads", async () => {
    const palettes = await deserializePalettesFromImport(
      JSON.stringify({
        version: 2,
        palettes: [
          {
            id: 7,
            timestamp: "2026-04-30T10:00:00.000Z",
            colors: [{ r: 1, g: 2, b: 3 }],
            photoBlob: JPEG_DATA_URL,
            previewGalleryBlob: "drop",
            previewGalleryFooterLabel: "drop",
            previewViewerBlob: "drop",
            previewViewerFooterLabel: "drop",
            previewBlob: "drop",
            previewFooterLabel: "drop",
            hasPhotoAsset: true,
          },
        ],
      }),
    );

    expect(palettes).toHaveLength(1);
    expect("id" in palettes[0]).toBe(false);
    expect("previewGalleryBlob" in palettes[0]).toBe(false);
    expect("previewGalleryFooterLabel" in palettes[0]).toBe(false);
    expect("previewViewerBlob" in palettes[0]).toBe(false);
    expect("previewViewerFooterLabel" in palettes[0]).toBe(false);
    expect("previewBlob" in palettes[0]).toBe(false);
    expect("previewFooterLabel" in palettes[0]).toBe(false);
    expect("hasPhotoAsset" in palettes[0]).toBe(false);
    expect(palettes[0].photoBlob).toBeInstanceOf(Blob);
    expect(palettes[0].photoBlob.type).toBe("image/jpeg");
    expect(palettes[0].photoBlob.size).toBe(23);
  });

  test("constructs an allowlisted normalized palette without persisting unexpected fields", async () => {
    const [palette] = await deserializePalettesFromImport(
      JSON.stringify({
        version: 2,
        palettes: [
          {
            id: 99,
            timestamp: "2026-04-30T12:00:00+02:00",
            colors: [{ r: 1, g: 2, b: 3, population: 12, injected: true }],
            photoBlob: JPEG_DATA_URL,
            captureAspectRatio: "4:3",
            captureCropRect: { x: 0.1, y: 0.2, width: 0.6, height: 0.5, injected: true },
            captureMode: "ral",
            ralMatch: {
              code: "RAL 1000",
              name: "Green beige",
              r: 205,
              g: 186,
              b: 136,
              deltaE: 1.5,
            },
            polaroidRenderSettings: { footerLabel: "  Studio  ", showColorNames: true },
            remoteCatchId: "  catch-1  ",
            remoteOwnerAccountKey: "account:0123456789abcdef",
            moderationStatus: "PUBLIC",
            postedAt: "2026-04-30T10:01:00.000Z",
            unexpected: { persisted: false },
          },
        ],
      }),
    );

    expect(palette).toEqual({
      timestamp: "2026-04-30T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3, population: 12 }],
      photoBlob: expect.any(Blob),
      captureAspectRatio: "4:3",
      captureCropRect: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
      captureMode: "ral",
      ralMatch: { code: "RAL 1000", name: "Green beige", r: 205, g: 186, b: 136, deltaE: 1.5 },
      polaroidRenderSettings: { footerLabel: "Studio", showColorNames: true },
      remoteCatchId: null,
      remoteOwnerAccountKey: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    });
  });

  test("strips portable remote publication authority from imported backups", async () => {
    const [palette] = await deserializePalettesFromImport(
      JSON.stringify({
        version: 2,
        palettes: [
          {
            timestamp: "2026-04-30T10:00:00.000Z",
            colors: [{ r: 1, g: 2, b: 3 }],
            photoBlob: JPEG_DATA_URL,
            remoteCatchId: "remote-owned-by-another-account",
            remoteOwnerAccountKey: "account:0123456789abcdef",
            moderationStatus: "PUBLIC",
            postedAt: "2026-04-30T10:01:00.000Z",
            moderationUpdatedAt: "2026-04-30T10:02:00.000Z",
            lastModerationCheckAt: "2026-04-30T10:03:00.000Z",
          },
        ],
      }),
    );

    expect(palette).toMatchObject({
      remoteCatchId: null,
      remoteOwnerAccountKey: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    });
  });

  test("preserves valid historical exports with omitted optional capture metadata", async () => {
    const [palette] = await deserializePalettesFromImport(
      JSON.stringify({
        version: 2,
        palettes: [
          {
            timestamp: "2024-01-02T03:04:05.000Z",
            colors: [{ r: 0, g: 127, b: 255 }],
            photoBlob: PNG_DATA_URL,
          },
        ],
      }),
    );

    expect(palette.captureMode).toBe("palette");
    expect(palette.captureAspectRatio).toBe("4:3");
    expect(palette.captureCropRect).toBeNull();
  });

  test("rejects malformed palette fields at the import boundary", async () => {
    const validPalette = {
      timestamp: "2026-04-30T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      photoBlob: JPEG_DATA_URL,
    };
    const importPalette = (overrides) =>
      deserializePalettesFromImport(
        JSON.stringify({ version: 2, palettes: [{ ...validPalette, ...overrides }] }),
      );

    await expect(importPalette({ timestamp: "not-a-date" })).rejects.toThrow(
      "Invalid palette timestamp",
    );
    await expect(importPalette({ colors: [] })).rejects.toThrow("Invalid palette colors");
    await expect(
      importPalette({
        colors: Array.from({ length: 8 }, (_, index) => ({ r: index, g: 2, b: 3 })),
      }),
    ).rejects.toThrow("Invalid palette colors");
    await expect(importPalette({ colors: [{ r: 256, g: 2, b: 3 }] })).rejects.toThrow(
      "Invalid palette color",
    );
    await expect(
      importPalette({ captureCropRect: { x: 0.8, y: 0, width: 0.3, height: 1 } }),
    ).rejects.toThrow("Invalid palette crop rectangle");
    await expect(importPalette({ captureMode: "video" })).rejects.toThrow(
      "Invalid palette capture mode",
    );
    await expect(importPalette({ captureAspectRatio: "1000:1" })).rejects.toThrow(
      "Invalid palette aspect ratio",
    );
    await expect(importPalette({ remoteCatchId: "x".repeat(257) })).rejects.toThrow(
      "Invalid remote catch id",
    );
    await expect(importPalette({ remoteOwnerAccountKey: "account:invalid" })).rejects.toThrow(
      "Invalid remote owner account key",
    );
    await expect(
      importPalette({ polaroidRenderSettings: { footerLabel: "x".repeat(161) } }),
    ).rejects.toThrow("Invalid polaroid settings");
    await expect(
      importPalette({
        captureMode: "ral",
        ralMatch: {
          code: "RAL 1000",
          name: "x".repeat(161),
          r: 1,
          g: 2,
          b: 3,
          deltaE: 1,
        },
      }),
    ).rejects.toThrow("Invalid RAL match");
    await expect(importPalette({ photoBlob: "data:text/plain;base64,YQ==" })).rejects.toThrow(
      "Invalid photo data",
    );
    await expect(
      importPalette({ photoBlob: "data:image/svg+xml;base64,PHN2Zy8+" }),
    ).rejects.toThrow("Invalid photo data");
    await expect(importPalette({ photoBlob: "data:image/jpeg;base64,YQ==" })).rejects.toThrow(
      "Photo dimensions",
    );
    await expect(importPalette({ photoBlob: { type: "image/jpeg" } })).rejects.toThrow(
      "Invalid photo data",
    );
  });

  test("rejects invalid import payloads", async () => {
    await expect(deserializePalettesFromImport(JSON.stringify({ version: 2 }))).rejects.toThrow(
      "Format de fichier invalide.",
    );
  });

  test("rejects unsupported, oversized, and excessive imports before decoding photos", async () => {
    await expect(
      deserializePalettesFromImport(JSON.stringify({ version: 1, palettes: [] })),
    ).rejects.toThrow("Unsupported palette backup version.");

    await expect(
      deserializePalettesFromImport(JSON.stringify({ version: 2, palettes: [] }), {
        maxJsonBytes: 8,
      }),
    ).rejects.toThrow("Palette backup exceeds the import size limit.");

    await expect(
      deserializePalettesFromImport(
        JSON.stringify({
          version: 2,
          palettes: [
            {
              timestamp: "2026-04-30T10:00:00.000Z",
              colors: [{ r: 1, g: 2, b: 3 }],
              photoBlob: JPEG_DATA_URL,
            },
          ],
        }),
        { maxPaletteCount: 0 },
      ),
    ).rejects.toThrow("Palette backup contains too many palettes.");

    await expect(
      deserializePalettesFromImport(
        JSON.stringify({
          version: 2,
          palettes: [
            {
              timestamp: "2026-04-30T10:00:00.000Z",
              colors: [{ r: 1, g: 2, b: 3 }],
              photoBlob: JPEG_DATA_URL,
            },
          ],
        }),
        { maxPhotoBytes: 0 },
      ),
    ).rejects.toThrow("A photo in the palette backup exceeds the import size limit.");

    await expect(
      deserializePalettesFromImport(
        JSON.stringify({
          version: 2,
          palettes: [
            {
              timestamp: "2026-04-30T10:00:00.000Z",
              colors: [{ r: 1, g: 2, b: 3 }],
              photoBlob: PNG_DATA_URL,
            },
          ],
        }),
        { maxPhotoPixels: 0 },
      ),
    ).rejects.toThrow("Photo dimensions");
  });

  test("enforces the JSON byte limit for multibyte text without changing boundary semantics", async () => {
    const json = JSON.stringify({
      version: 2,
      palettes: [
        {
          timestamp: "2026-04-30T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          photoBlob: JPEG_DATA_URL,
          polaroidRenderSettings: { footerLabel: "🎨 couleur" },
        },
      ],
    });
    const byteLength = new TextEncoder().encode(json).byteLength;

    await expect(
      deserializePalettesFromImport(json, { maxJsonBytes: byteLength }),
    ).resolves.toHaveLength(1);
    await expect(
      deserializePalettesFromImport(json, { maxJsonBytes: byteLength - 1 }),
    ).rejects.toThrow("Palette backup exceeds the import size limit.");
  });

  test("streams Blob backups as normalized provisional batches with bounded progress", async () => {
    const json = JSON.stringify({
      version: 2,
      metadata: { note: "braces inside strings do not close entries: {[]}" },
      palettes: [
        {
          timestamp: "2026-04-30T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          photoBlob: JPEG_DATA_URL,
          polaroidRenderSettings: { footerLabel: 'Studio \\"quoted\\" {one}' },
        },
        {
          timestamp: "2026-04-30T11:00:00.000Z",
          colors: [{ r: 4, g: 5, b: 6 }],
          photoBlob: PNG_DATA_URL,
        },
      ],
    });
    const blob = new Blob([json], { type: "application/json" });
    const batches = [];
    const progressEvents = [];

    const collected = await deserializePalettesFromImportBlob(blob, {
      batchSize: 1,
      collect: false,
      onBatch: async (batch, progress) => {
        await Promise.resolve();
        batches.push({ batch, progress });
      },
      onProgress: (progress) => progressEvents.push(progress),
    });

    expect(collected).toEqual([]);
    expect(batches).toHaveLength(2);
    expect(batches.flatMap(({ batch }) => batch)).toEqual([
      expect.objectContaining({ timestamp: "2026-04-30T10:00:00.000Z" }),
      expect.objectContaining({ timestamp: "2026-04-30T11:00:00.000Z" }),
    ]);
    expect(batches[0].batch[0].photoBlob).toBeInstanceOf(Blob);
    expect(progressEvents.map(({ completed }) => completed)).toEqual([1, 2]);
    expect(progressEvents.at(-1)).toMatchObject({
      loadedBytes: blob.size,
      phase: "parsing",
      totalBytes: blob.size,
    });
  });

  test("validates the complete streaming root envelope and trailing syntax", async () => {
    const validPalette = JSON.stringify({
      timestamp: "2026-04-30T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      photoBlob: JPEG_DATA_URL,
    });

    for (const [source, message] of [
      [`{"palettes":[${validPalette}],"version":2}`, "version must precede"],
      [`{"version":2,"palettes":[${validPalette},]}`, "trailing comma"],
      [`{"version":2,"version":2,"palettes":[]}`, "Duplicate root"],
      [`{"version":2,"palettes":[${validPalette}]} true`, "trailing data"],
      [`{"version":2,"palettes":[${validPalette}}`, "array syntax"],
    ]) {
      await expect(deserializePalettesFromImportBlob(new Blob([source]))).rejects.toThrow(message);
    }
  });

  test("enforces total, entry, count, and cumulative photo bounds while streaming", async () => {
    const entry = {
      timestamp: "2026-04-30T10:00:00.000Z",
      colors: [{ r: 1, g: 2, b: 3 }],
      photoBlob: JPEG_DATA_URL,
    };
    const blob = new Blob([JSON.stringify({ version: 2, palettes: [entry, entry] })]);

    await expect(
      deserializePalettesFromImportBlob(blob, { maxJsonBytes: blob.size - 1 }),
    ).rejects.toThrow("Palette backup exceeds the import size limit");
    await expect(
      deserializePalettesFromImportBlob(blob, { maxEntryJsonBytes: 16 }),
    ).rejects.toThrow("palette entry");
    await expect(deserializePalettesFromImportBlob(blob, { maxPaletteCount: 1 })).rejects.toThrow(
      "too many palettes",
    );
    await expect(
      deserializePalettesFromImportBlob(blob, { maxTotalPhotoBytes: JPEG_BLOB.size }),
    ).rejects.toThrow("cumulative import size limit");
    await expect(
      deserializePalettesFromImport(await blob.text(), {
        maxJsonBytes: blob.size,
        maxTotalPhotoBytes: JPEG_BLOB.size,
      }),
    ).rejects.toThrow("cumulative import size limit");
  });
});
