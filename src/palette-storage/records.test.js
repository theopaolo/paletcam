import { expect, test } from "bun:test";
import {
  createPaletteMetadataRecord,
  normalizeStoredPaletteRecord,
  parseStoredPaletteMetadataRecord,
} from "./records.js";

test("stored palette normalization allowlists persisted fields", () => {
  const photoBlob = new Blob(["photo"], { type: "image/webp" });
  const normalized = normalizeStoredPaletteRecord(
    {
      id: 7,
      timestamp: "2026-07-13T10:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      captureAspectRatio: "4:3",
      remoteCatchId: "remote-7",
      remoteOwnerAccountKey: "account:0123456789abcdef",
      moderationStatus: "PUBLIC",
      photoBlob,
      injectedField: "must-not-survive",
      prototypeLikePayload: { admin: true },
    },
    { includePhotoBlob: true },
  );

  expect(normalized).toMatchObject({
    id: 7,
    timestamp: "2026-07-13T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
    captureAspectRatio: "4:3",
    remoteCatchId: "remote-7",
    remoteOwnerAccountKey: "account:0123456789abcdef",
    moderationStatus: "PUBLIC",
    photoBlob,
  });
  expect(Object.hasOwn(normalized, "injectedField")).toBe(false);
  expect(Object.hasOwn(normalized, "prototypeLikePayload")).toBe(false);
});

test("stored palette parser validates and normalizes the authoritative metadata contract", () => {
  const parsed = parseStoredPaletteMetadataRecord({
    id: 9,
    timestamp: "2026-07-13T12:00:00+02:00",
    colors: [{ r: 12, g: 34, b: 56, population: 42, deltaE: 1.5, injected: true }],
    captureAspectRatio: 1.25,
    captureCropRect: { x: 0.1, y: 0.2, width: 0.7, height: 0.6, injected: true },
    captureMode: "ral",
    ralMatch: {
      code: " RAL 1000 ",
      name: " Green beige ",
      r: 205,
      g: 186,
      b: 136,
      deltaE: 1.5,
      injected: true,
    },
    polaroidRenderSettings: {
      footerLabel: " Studio ",
      showColorNames: true,
      injected: true,
    },
    remoteCatchId: " remote-9 ",
    remoteOwnerAccountKey: " account:0123456789abcdef ",
    moderationStatus: " public ",
    postedAt: "2026-07-13T12:01:00+02:00",
    hasPhotoAsset: true,
    previewViewerBlob: new Blob(["legacy-preview"]),
    injectedField: "must-not-survive",
  });

  expect(parsed).toMatchObject({
    id: 9,
    timestamp: "2026-07-13T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56, population: 42, deltaE: 1.5 }],
    captureAspectRatio: 1.25,
    captureCropRect: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    captureMode: "ral",
    ralMatch: {
      code: "RAL 1000",
      name: "Green beige",
      r: 205,
      g: 186,
      b: 136,
      deltaE: 1.5,
    },
    polaroidRenderSettings: { footerLabel: "Studio", showColorNames: true },
    remoteCatchId: "remote-9",
    remoteOwnerAccountKey: "account:0123456789abcdef",
    moderationStatus: "PUBLIC",
    postedAt: "2026-07-13T10:01:00.000Z",
    hasPhotoAsset: true,
  });
  expect(parsed.previewViewerBlob).toBeUndefined();
  expect(Object.hasOwn(parsed, "injectedField")).toBe(false);
  expect(Object.hasOwn(parsed.colors[0], "injected")).toBe(false);
});

test("stored palette parser rejects malformed authoritative metadata", () => {
  const validRecord = {
    id: 10,
    timestamp: "2026-07-13T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
  };
  const invalidRecords = [
    { ...validRecord, id: "10" },
    { ...validRecord, timestamp: "not-a-date" },
    { ...validRecord, colors: [] },
    { ...validRecord, colors: Array.from({ length: 17 }, () => ({ r: 1, g: 2, b: 3 })) },
    { ...validRecord, colors: [{ r: 256, g: 2, b: 3 }] },
    { ...validRecord, captureAspectRatio: "16:9" },
    {
      ...validRecord,
      captureCropRect: { x: 0.8, y: 0, width: 0.3, height: 1 },
    },
    {
      ...validRecord,
      captureMode: "ral",
      ralMatch: { code: "", name: "Invalid", r: 1, g: 2, b: 3, deltaE: 1 },
    },
    {
      ...validRecord,
      polaroidRenderSettings: { footerLabel: "valid", showColorNames: "yes" },
    },
    { ...validRecord, remoteCatchId: "remote-10", remoteOwnerAccountKey: "account:invalid" },
    { ...validRecord, remoteOwnerAccountKey: "account:0123456789abcdef" },
  ];

  for (const invalidRecord of invalidRecords) {
    expect(parseStoredPaletteMetadataRecord(invalidRecord)).toBeNull();
  }
});

test("stored palette parser preserves bounded legacy color collections", () => {
  const legacyColors = Array.from({ length: 14 }, (_, index) => ({
    r: index,
    g: index + 1,
    b: index + 2,
  }));

  expect(
    parseStoredPaletteMetadataRecord({
      id: 12,
      timestamp: "2026-02-01T12:51:25.787Z",
      colors: legacyColors,
    }),
  ).toMatchObject({ colors: legacyColors });
});

test("stored palette parser keeps legacy blank remote state as normalized null values", () => {
  expect(
    parseStoredPaletteMetadataRecord({
      id: 11,
      timestamp: "2026-07-13T10:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      remoteCatchId: "   ",
      moderationStatus: " ",
    }),
  ).toMatchObject({ remoteCatchId: null, moderationStatus: null });
});

test("new metadata records receive backup identity and start dirty", () => {
  const record = createPaletteMetadataRecord({
    timestamp: "2026-08-15T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
  });

  expect(typeof record.backupUid).toBe("string");
  expect(record.backupUid.length).toBeGreaterThan(0);
  expect(typeof record.backupDirtyAt).toBe("string");
  expect(record.backupUploadedAt).toBeNull();
});

test("metadata records preserve an explicit backup identity for restore", () => {
  const record = createPaletteMetadataRecord({
    timestamp: "2026-08-15T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
    backupUid: "restored-uid",
    backupDirtyAt: "2026-08-01T00:00:00.000Z",
    backupUploadedAt: "2026-07-01T00:00:00.000Z",
  });

  expect(record.backupUid).toBe("restored-uid");
  expect(record.backupDirtyAt).toBe("2026-08-01T00:00:00.000Z");
  expect(record.backupUploadedAt).toBe("2026-07-01T00:00:00.000Z");
});

test("stored palette parser carries the backup ledger fields through", () => {
  expect(
    parseStoredPaletteMetadataRecord({
      id: 13,
      timestamp: "2026-07-13T10:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      backupUid: "ledger-uid",
      backupDirtyAt: "2026-08-01T00:00:00.000Z",
      backupUploadedAt: null,
    }),
  ).toMatchObject({
    backupUid: "ledger-uid",
    backupDirtyAt: "2026-08-01T00:00:00.000Z",
    backupUploadedAt: null,
  });
});

test("stored palette parser rejects rows with corrupt backup ledger fields", () => {
  const base = {
    id: 14,
    timestamp: "2026-07-13T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
  };

  expect(parseStoredPaletteMetadataRecord({ ...base, backupUid: 42 })).toBeNull();
  expect(parseStoredPaletteMetadataRecord({ ...base, backupDirtyAt: "not-a-date" })).toBeNull();
  expect(parseStoredPaletteMetadataRecord({ ...base, backupUploadedAt: false })).toBeNull();
});
