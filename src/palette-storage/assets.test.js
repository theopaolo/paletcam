import { afterEach, describe, expect, mock, test } from "bun:test";

const assetsModuleUrl = new URL("./assets.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../modules/error-reporting.js", import.meta.url).href;
const operationalMetricsModuleUrl = new URL("../modules/operational-metrics.js", import.meta.url)
  .href;

function serializeKey(key) {
  return Array.isArray(key) ? JSON.stringify(key) : String(key);
}

function createFakeTable(initialRecords = [], getKey = (record) => record.id) {
  const records = new Map(
    initialRecords.map((record) => [serializeKey(getKey(record)), { ...record }]),
  );
  const get = mock(async (key) => records.get(serializeKey(key)));
  const put = mock(async (record) => {
    records.set(serializeKey(getKey(record)), { ...record });
    return getKey(record);
  });
  const deleteRecord = mock(async (key) => records.delete(serializeKey(key)));
  const bulkGet = mock(async (keys) => keys.map((key) => records.get(serializeKey(key))));

  return { bulkGet, delete: deleteRecord, get, put, records };
}

async function loadAssetsModule({ assets = [], palettes = [], previews = [] } = {}) {
  const paletteTable = createFakeTable(palettes, (record) => record.id);
  const paletteAssetTable = createFakeTable(assets, (record) => record.paletteId);
  const palettePreviewTable = createFakeTable(previews, (record) => [
    record.paletteId,
    record.variant,
  ]);
  const transaction = mock(async (...args) => args.at(-1)());
  const reportAppError = mock(() => ({}));
  const recordIndexedDbFailure = mock(() => {});

  mock.module(dbModuleUrl, () => ({
    db: {
      paletteAssets: paletteAssetTable,
      palettePreviews: palettePreviewTable,
      palettes: paletteTable,
      transaction,
    },
  }));
  mock.module(errorReportingModuleUrl, () => ({ reportAppError }));
  mock.module(operationalMetricsModuleUrl, () => ({ recordIndexedDbFailure }));

  const module = await import(`${assetsModuleUrl}?test=${Math.random()}`);
  return {
    module,
    paletteAssetTable,
    palettePreviewTable,
    paletteTable,
    transaction,
  };
}

afterEach(() => {
  mock.restore();
});

describe("palette preview storage", () => {
  test("reads the dedicated preview table first without materializing palette metadata", async () => {
    const blob = new Blob(["gallery"], { type: "image/webp" });
    const { module, palettePreviewTable, paletteTable, transaction } = await loadAssetsModule({
      palettes: [{ id: 7, previewGalleryBlob: new Blob(["legacy"]) }],
      previews: [{ paletteId: 7, variant: "gallery", blob, footerLabel: "current" }],
    });

    await expect(module.readPalettePreviewBlobById(7, "gallery")).resolves.toEqual({
      blob,
      footerLabel: "current",
    });

    expect(palettePreviewTable.get).toHaveBeenCalledWith([7, "gallery"]);
    expect(paletteTable.get).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  test("transactionally repairs a legacy viewer preview and scrubs only viewer legacy fields", async () => {
    const blob = new Blob(["legacy-viewer"], { type: "image/webp" });
    const galleryBlob = new Blob(["gallery"], { type: "image/webp" });
    const photoBlob = new Blob(["master"], { type: "image/webp" });
    const { module, paletteAssetTable, palettePreviewTable, paletteTable, transaction } =
      await loadAssetsModule({
        assets: [{ paletteId: 9, photoBlob }],
        palettes: [
          {
            id: 9,
            colors: [{ r: 1, g: 2, b: 3 }],
            previewBlob: blob,
            previewFooterLabel: "legacy-label",
            previewViewerFooterLabel: "viewer-label",
            previewGalleryBlob: galleryBlob,
            previewGalleryFooterLabel: "gallery-label",
            remoteCatchId: "remote-9",
          },
        ],
      });

    await expect(module.readPalettePreviewBlobById(9, "viewer")).resolves.toEqual({
      blob,
      footerLabel: "legacy-label",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(palettePreviewTable.records.get('[9,"viewer"]')).toEqual({
      paletteId: 9,
      variant: "viewer",
      blob,
      footerLabel: "legacy-label",
    });
    expect(paletteTable.records.get("9")).toEqual({
      id: 9,
      colors: [{ r: 1, g: 2, b: 3 }],
      previewGalleryBlob: galleryBlob,
      previewGalleryFooterLabel: "gallery-label",
      remoteCatchId: "remote-9",
    });
    expect(paletteAssetTable.records.get("9")?.photoBlob).toBe(photoBlob);
  });

  test("a gallery repair leaves viewer and generic preview metadata untouched", async () => {
    const galleryBlob = new Blob(["gallery"], { type: "image/webp" });
    const viewerBlob = new Blob(["viewer"], { type: "image/webp" });
    const legacyViewerBlob = new Blob(["generic-viewer"], { type: "image/webp" });
    const { module, paletteTable } = await loadAssetsModule({
      palettes: [
        {
          id: 10,
          previewBlob: legacyViewerBlob,
          previewFooterLabel: "generic-label",
          previewGalleryBlob: galleryBlob,
          previewGalleryFooterLabel: "gallery-label",
          previewViewerBlob: viewerBlob,
          previewViewerFooterLabel: "viewer-label",
          timestamp: "stable-metadata",
        },
      ],
    });

    await module.readPalettePreviewBlobById(10, "gallery");

    expect(paletteTable.records.get("10")).toEqual({
      id: 10,
      previewBlob: legacyViewerBlob,
      previewFooterLabel: "generic-label",
      previewViewerBlob: viewerBlob,
      previewViewerFooterLabel: "viewer-label",
      timestamp: "stable-metadata",
    });
  });

  test("updates and clears exactly one preview variant without touching master assets", async () => {
    const masterBlob = new Blob(["master"], { type: "image/webp" });
    const oldGalleryBlob = new Blob(["old-gallery"], { type: "image/webp" });
    const viewerBlob = new Blob(["viewer"], { type: "image/webp" });
    const newGalleryBlob = new Blob(["new-gallery"], { type: "image/webp" });
    const { module, paletteAssetTable, palettePreviewTable, paletteTable } = await loadAssetsModule(
      {
        assets: [{ paletteId: 11, photoBlob: masterBlob }],
        palettes: [{ id: 11, colors: [{ r: 4, g: 5, b: 6 }], remoteCatchId: "remote-11" }],
        previews: [
          { paletteId: 11, variant: "gallery", blob: oldGalleryBlob, footerLabel: "old" },
          { paletteId: 11, variant: "viewer", blob: viewerBlob, footerLabel: "viewer" },
        ],
      },
    );

    await module.updatePalettePreviewBlob(11, newGalleryBlob, "new", { variant: "gallery" });
    expect(palettePreviewTable.records.get('[11,"gallery"]')).toMatchObject({
      blob: newGalleryBlob,
      footerLabel: "new",
    });
    expect(palettePreviewTable.records.get('[11,"viewer"]')?.blob).toBe(viewerBlob);

    await module.updatePalettePreviewBlob(11, null, null, { variant: "gallery" });
    expect(palettePreviewTable.records.has('[11,"gallery"]')).toBe(false);
    expect(palettePreviewTable.records.get('[11,"viewer"]')?.blob).toBe(viewerBlob);
    expect(paletteAssetTable.records.get("11")?.photoBlob).toBe(masterBlob);
    expect(paletteAssetTable.put).not.toHaveBeenCalled();
    expect(paletteTable.records.get("11")).toEqual({
      id: 11,
      colors: [{ r: 4, g: 5, b: 6 }],
      remoteCatchId: "remote-11",
    });
    expect(paletteTable.put).not.toHaveBeenCalled();
  });

  test("does not create an orphan preview when palette metadata is missing", async () => {
    const { module, palettePreviewTable } = await loadAssetsModule();

    await expect(
      module.updatePalettePreviewBlob(404, new Blob(["orphan"]), "footer", {
        variant: "gallery",
      }),
    ).resolves.toBeNull();

    expect(palettePreviewTable.put).not.toHaveBeenCalled();
    expect(palettePreviewTable.records.size).toBe(0);
  });

  test("rejects unknown update and clear variants before opening a transaction", async () => {
    const viewerBlob = new Blob(["viewer"], { type: "image/webp" });
    const { module, palettePreviewTable, paletteTable, transaction } = await loadAssetsModule({
      palettes: [{ id: 12, colors: [] }],
      previews: [{ paletteId: 12, variant: "viewer", blob: viewerBlob, footerLabel: "viewer" }],
    });

    await expect(
      module.updatePalettePreviewBlob(12, new Blob(["typo"]), "typo", {
        variant: "galery",
      }),
    ).rejects.toThrow("Unsupported palette preview variant: galery.");
    await expect(
      module.updatePalettePreviewBlob(12, null, null, { variant: "galery" }),
    ).rejects.toThrow("Unsupported palette preview variant: galery.");

    expect(transaction).not.toHaveBeenCalled();
    expect(paletteTable.get).not.toHaveBeenCalled();
    expect(palettePreviewTable.put).not.toHaveBeenCalled();
    expect(palettePreviewTable.delete).not.toHaveBeenCalled();
    expect(palettePreviewTable.records.get('[12,"viewer"]')?.blob).toBe(viewerBlob);
  });
});

describe("bounded asset reads", () => {
  test("bulk-reads master photos and previews in bounded chunks", async () => {
    const ids = Array.from({ length: 53 }, (_, index) => index + 1);
    const assets = ids.map((paletteId) => ({
      paletteId,
      photoBlob: new Blob([`master-${paletteId}`]),
    }));
    const previews = ids.map((paletteId) => ({
      paletteId,
      variant: "gallery",
      blob: new Blob([`preview-${paletteId}`]),
      footerLabel: `footer-${paletteId}`,
    }));
    const { module, paletteAssetTable, palettePreviewTable } = await loadAssetsModule({
      assets,
      previews,
    });

    const photoBlobs = await module.readPalettePhotoBlobsByIds(ids);
    const previewBlobs = await module.readPalettePreviewBlobsByIds(ids, "gallery");

    expect(photoBlobs.size).toBe(53);
    expect(previewBlobs.size).toBe(53);
    expect(photoBlobs.get(53)).toBe(assets[52].photoBlob);
    expect(previewBlobs.get(53)).toEqual({
      blob: previews[52].blob,
      footerLabel: "footer-53",
    });
    expect(paletteAssetTable.bulkGet).toHaveBeenCalledTimes(3);
    expect(palettePreviewTable.bulkGet).toHaveBeenCalledTimes(3);
    expect(paletteAssetTable.bulkGet.mock.calls.map(([keys]) => keys.length)).toEqual([25, 25, 3]);
    expect(palettePreviewTable.bulkGet.mock.calls.map(([keys]) => keys.length)).toEqual([
      25, 25, 3,
    ]);
  });

  test("bulk-resolves absent assets without falling back to per-palette reads", async () => {
    const ids = Array.from({ length: 53 }, (_, index) => index + 1);
    const { module, paletteAssetTable, palettePreviewTable, paletteTable } =
      await loadAssetsModule();

    const photoBlobs = await module.readPalettePhotoBlobsByIds(ids);
    const previewBlobs = await module.readPalettePreviewBlobsByIds(ids, "viewer");

    expect(photoBlobs.size).toBe(53);
    expect(previewBlobs.size).toBe(53);
    expect([...photoBlobs.values()].every((value) => value === null)).toBe(true);
    expect([...previewBlobs.values()].every((value) => value === null)).toBe(true);
    expect(paletteAssetTable.get).not.toHaveBeenCalled();
    expect(palettePreviewTable.get).not.toHaveBeenCalled();
    expect(paletteTable.get).not.toHaveBeenCalled();
    expect(paletteTable.bulkGet).toHaveBeenCalledTimes(6);
  });
});
