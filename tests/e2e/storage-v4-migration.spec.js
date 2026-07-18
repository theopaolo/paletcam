import { expect, test } from "@playwright/test";
import { installDeniedCamera } from "./support/browser-fixtures.js";

const DATABASE_NAME = "PaletcamDB";
const DEXIE_V3_NATIVE_VERSION = 30;
const CURRENT_DEXIE_NATIVE_VERSION = 70;
const MAINTENANCE_MARKER_KEY = "legacy-polaroid-render-settings:v1";
const MIGRATION_FAULT_STATE_KEY = "paletcam:test:migration-fault";

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

async function seedVersionThreeDatabase(page, paletteId) {
  await page.goto("/offline.html");
  await page.evaluate(
    async ({ databaseName, nativeVersion, paletteId }) => {
      const requestAsPromise = (request) =>
        new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("IndexedDB request was blocked"));
        });

      await requestAsPromise(indexedDB.deleteDatabase(databaseName));

      const openRequest = indexedDB.open(databaseName, nativeVersion);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        const palettes = database.createObjectStore("palettes", {
          autoIncrement: true,
          keyPath: "id",
        });
        palettes.createIndex("timestamp", "timestamp");
        palettes.createIndex("remoteCatchId", "remoteCatchId");
        palettes.createIndex("moderationStatus", "moderationStatus");
        database.createObjectStore("paletteAssets", { keyPath: "paletteId" });
      };

      const database = await requestAsPromise(openRequest);
      const transaction = database.transaction(["palettes", "paletteAssets"], "readwrite");
      transaction.objectStore("palettes").put({
        id: paletteId,
        timestamp: "2026-07-13T09:00:00.000Z",
        colors: [{ r: 18, g: 52, b: 86 }],
        captureAspectRatio: "4:3",
        captureCropRect: null,
        hasPhotoAsset: true,
        remoteCatchId: "remote-v3-migration",
        moderationStatus: "PUBLIC",
        previewBlob: new Blob(["stale-generic-viewer"], { type: "image/webp" }),
        previewFooterLabel: "stale-generic-label",
        previewGalleryBlob: new Blob(["v3-gallery-preview"], { type: "image/webp" }),
        previewGalleryFooterLabel: "gallery-label-v3",
        previewViewerBlob: new Blob(["v3-viewer-preview"], { type: "image/webp" }),
        previewViewerFooterLabel: "viewer-label-v3",
      });
      transaction.objectStore("paletteAssets").put({
        paletteId,
        photoBlob: new Blob(["v3-master-photo"], { type: "image/webp" }),
      });

      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    {
      databaseName: DATABASE_NAME,
      nativeVersion: DEXIE_V3_NATIVE_VERSION,
      paletteId,
    },
  );
}

async function readVersionFourState(page, paletteId) {
  return page.evaluate(
    async ({ databaseName, markerKey, paletteId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const transaction = database.transaction(
          ["palettes", "paletteAssets", "palettePreviews", "paletteStorageMetadata"],
          "readonly",
        );
        const read = (storeName, key) =>
          new Promise((resolve, reject) => {
            const request = transaction.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
          });
        const [palette, asset, gallery, viewer, marker] = await Promise.all([
          read("palettes", paletteId),
          read("paletteAssets", paletteId),
          read("palettePreviews", [paletteId, "gallery"]),
          read("palettePreviews", [paletteId, "viewer"]),
          read("paletteStorageMetadata", markerKey),
        ]);
        const previewMetadataFields = [
          "previewBlob",
          "previewFooterLabel",
          "previewGalleryBlob",
          "previewGalleryFooterLabel",
          "previewViewerBlob",
          "previewViewerFooterLabel",
        ];

        return {
          asset: asset
            ? {
                paletteId: asset.paletteId,
                text: await asset.photoBlob.text(),
                type: asset.photoBlob.type,
              }
            : null,
          databaseVersion: database.version,
          gallery: gallery
            ? {
                footerLabel: gallery.footerLabel,
                paletteId: gallery.paletteId,
                text: await gallery.blob.text(),
                type: gallery.blob.type,
                variant: gallery.variant,
              }
            : null,
          marker,
          palette: palette
            ? {
                hasPhotoAsset: palette.hasPhotoAsset,
                id: palette.id,
                previewMetadataFieldsPresent: previewMetadataFields.filter((field) =>
                  Object.hasOwn(palette, field),
                ),
                remoteCatchId: palette.remoteCatchId,
              }
            : null,
          viewer: viewer
            ? {
                footerLabel: viewer.footerLabel,
                paletteId: viewer.paletteId,
                text: await viewer.blob.text(),
                type: viewer.blob.type,
                variant: viewer.variant,
              }
            : null,
        };
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, markerKey: MAINTENANCE_MARKER_KEY, paletteId },
  );
}

async function readHistoricalDatabaseState(page, paletteId) {
  return page.evaluate(
    async ({ databaseName, paletteId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const storeNames = [...database.objectStoreNames];
        const transaction = database.transaction(["palettes", "paletteAssets"], "readonly");
        const read = (storeName, key) =>
          new Promise((resolve, reject) => {
            const request = transaction.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
          });
        const [palette, asset] = await Promise.all([
          read("palettes", paletteId),
          read("paletteAssets", paletteId),
        ]);

        return {
          asset: asset
            ? {
                paletteId: asset.paletteId,
                text: await asset.photoBlob.text(),
                type: asset.photoBlob.type,
              }
            : null,
          databaseVersion: database.version,
          palette: palette
            ? {
                id: palette.id,
                previewGalleryText: await palette.previewGalleryBlob.text(),
                previewViewerText: await palette.previewViewerBlob.text(),
                remoteCatchId: palette.remoteCatchId,
              }
            : null,
          storeNames,
        };
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, paletteId },
  );
}

test("upgrades a same-origin version 3 database through the current asset schema", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-webkit",
    "Playwright WebKit aborts Blob-backed historical IndexedDB fixtures; this skip is limited to the migration fixture.",
  );

  const paletteId = 9403;
  await page.addInitScript((faultStateKey) => {
    if (sessionStorage.getItem(faultStateKey) !== "armed") {
      return;
    }

    const originalPut = IDBObjectStore.prototype.put;
    const abortScheduledFor = new WeakSet();
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      const transaction = this.transaction;
      if (this.name === "palettePreviews" && !abortScheduledFor.has(transaction)) {
        abortScheduledFor.add(transaction);
        request.addEventListener(
          "success",
          () => {
            sessionStorage.setItem(faultStateKey, "triggered");
            transaction.abort();
          },
          { once: true },
        );
      }
      return request;
    };
  }, MIGRATION_FAULT_STATE_KEY);
  await seedVersionThreeDatabase(page, paletteId);
  await page.evaluate((faultStateKey) => {
    sessionStorage.setItem(faultStateKey, "armed");
  }, MIGRATION_FAULT_STATE_KEY);
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(
        (faultStateKey) => sessionStorage.getItem(faultStateKey),
        MIGRATION_FAULT_STATE_KEY,
      ),
    )
    .toBe("triggered");

  // Leaving the failed app document removes the injected prototype wrapper.
  // The persisted state prevents it from being installed on the retry page.
  await page.goto("/offline.html");
  await expect
    .poll(() => readHistoricalDatabaseState(page, paletteId))
    .toEqual({
      asset: {
        paletteId,
        text: "v3-master-photo",
        type: "image/webp",
      },
      databaseVersion: DEXIE_V3_NATIVE_VERSION,
      palette: {
        id: paletteId,
        previewGalleryText: "v3-gallery-preview",
        previewViewerText: "v3-viewer-preview",
        remoteCatchId: "remote-v3-migration",
      },
      storeNames: ["paletteAssets", "palettes"],
    });

  await page.goto("/");

  await expect
    .poll(async () => readVersionFourState(page, paletteId))
    .toMatchObject({
      asset: {
        paletteId,
        text: "v3-master-photo",
        type: "image/webp",
      },
      databaseVersion: CURRENT_DEXIE_NATIVE_VERSION,
      gallery: {
        footerLabel: "gallery-label-v3",
        paletteId,
        text: "v3-gallery-preview",
        type: "image/webp",
        variant: "gallery",
      },
      marker: {
        key: MAINTENANCE_MARKER_KEY,
        version: 1,
      },
      palette: {
        hasPhotoAsset: true,
        id: paletteId,
        previewMetadataFieldsPresent: [],
        remoteCatchId: "remote-v3-migration",
      },
      viewer: {
        footerLabel: "viewer-label-v3",
        paletteId,
        text: "v3-viewer-preview",
        type: "image/webp",
        variant: "viewer",
      },
    });

  const migrated = await readVersionFourState(page, paletteId);
  expect(migrated.marker.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
