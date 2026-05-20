import { describe, expect, test } from "bun:test";

import {
  deserializePalettesFromImport,
  serializePalettesForExport,
  serializePalettesForExportBlob,
} from "./json-transfer.js";

describe("palette-storage/json-transfer", () => {
  test("serializes palettes without persisted ids or preview-only fields", async () => {
    const json = await serializePalettesForExport([
      {
        id: 42,
        timestamp: "2026-04-30T10:00:00.000Z",
        colors: [{ r: 12, g: 34, b: 56 }],
        photoBlob: new Blob(["photo"], { type: "text/plain" }),
        previewGalleryBlob: new Blob(["gallery-preview"], { type: "text/plain" }),
        previewGalleryFooterLabel: "gallery-footer",
        previewViewerBlob: new Blob(["viewer-preview"], { type: "text/plain" }),
        previewViewerFooterLabel: "viewer-footer",
        previewBlob: new Blob(["preview"], { type: "text/plain" }),
        previewFooterLabel: "footer",
        hasPhotoAsset: true,
        remoteCatchId: null,
        moderationStatus: null,
        postedAt: null,
        moderationUpdatedAt: null,
        lastModerationCheckAt: null,
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
    expect(payload.palettes[0].photoBlob.startsWith("data:text/plain")).toBe(true);
  });

  test("serializes export blobs without building the final file in the caller", async () => {
    const progressEvents = [];
    const blob = await serializePalettesForExportBlob(
      [
        {
          id: 42,
          timestamp: "2026-04-30T10:00:00.000Z",
          colors: [{ r: 12, g: 34, b: 56 }],
          photoBlob: new Blob(["photo"], { type: "text/plain" }),
          hasPhotoAsset: true,
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
    expect(payload.palettes[0].photoBlob.startsWith("data:text/plain")).toBe(true);
    expect(progressEvents).toEqual([
      {
        completed: 1,
        phase: "serializing",
        total: 1,
      },
    ]);
  });

  test("serializes export blobs in batches without changing the payload", async () => {
    const progressEvents = [];
    const blob = await serializePalettesForExportBlob(
      [
        {
          id: 42,
          timestamp: "2026-04-30T10:00:00.000Z",
          colors: [{ r: 12, g: 34, b: 56 }],
          photoBlob: new Blob(["first-photo"], { type: "text/plain" }),
          hasPhotoAsset: true,
        },
        {
          id: 43,
          timestamp: "2026-04-30T10:01:00.000Z",
          colors: [{ r: 65, g: 43, b: 21 }],
          photoBlob: new Blob(["second-photo"], { type: "text/plain" }),
          hasPhotoAsset: true,
        },
      ],
      {
        blobBatchSizeBytes: 120,
        onProgress: (progress) => progressEvents.push(progress),
      },
    );
    const payload = JSON.parse(await blob.text());

    expect(payload.version).toBe(2);
    expect(payload.palettes).toHaveLength(2);
    expect(payload.palettes[0].photoBlob).toBe("data:text/plain;base64,Zmlyc3QtcGhvdG8=");
    expect(payload.palettes[1].photoBlob).toBe("data:text/plain;base64,c2Vjb25kLXBob3Rv");
    expect(progressEvents).toEqual([
      {
        completed: 1,
        phase: "serializing",
        total: 2,
      },
      {
        completed: 2,
        phase: "serializing",
        total: 2,
      },
    ]);
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
            photoBlob: "data:text/plain;base64,cGhvdG8=",
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
    expect(await palettes[0].photoBlob.text()).toBe("photo");
  });

  test("rejects invalid import payloads", async () => {
    await expect(deserializePalettesFromImport(JSON.stringify({ version: 2 }))).rejects.toThrow(
      "Format de fichier invalide.",
    );
  });
});
