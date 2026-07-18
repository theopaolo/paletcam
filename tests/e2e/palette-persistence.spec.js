import { expect, test } from "@playwright/test";
import { installDeniedCamera, readPalette, seedPalette } from "./support/browser-fixtures.js";

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

async function seedLegacyDatabase(page, version, palette) {
  await page.goto("/offline.html");
  await page.evaluate(
    async ({ palette, version }) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("PaletcamDB");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      await new Promise((resolve, reject) => {
        const request = indexedDB.open("PaletcamDB", version);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.createObjectStore("palettes", {
            autoIncrement: true,
            keyPath: "id",
          });
          store.createIndex("timestamp", "timestamp");
          if (version >= 2) {
            store.createIndex("remoteCatchId", "remoteCatchId");
            store.createIndex("moderationStatus", "moderationStatus");
          }
          store.put({
            ...palette,
            photoBlob: new Blob(["legacy-master-photo"], { type: "image/webp" }),
          });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    },
    { palette, version },
  );
}

async function readMigratedPaletteAndAsset(page, paletteId) {
  return page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("PaletcamDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["palettes", "paletteAssets"], "readonly");
      const read = (storeName) =>
        new Promise((resolve, reject) => {
          const request = transaction.objectStore(storeName).get(id);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
      const [palette, asset] = await Promise.all([read("palettes"), read("paletteAssets")]);
      return {
        asset: asset
          ? {
              paletteId: asset.paletteId,
              photoSize: asset.photoBlob?.size ?? 0,
              photoType: asset.photoBlob?.type ?? "",
            }
          : null,
        databaseVersion: database.version,
        objectStoreNames: Array.from(database.objectStoreNames),
        palette,
      };
    } finally {
      database.close();
    }
  }, paletteId);
}

test("renders an IndexedDB palette again after a full reload", async ({ page }) => {
  await page.goto("/");
  await seedPalette(page, {
    id: 9001,
    timestamp: "2026-07-11T10:00:00.000Z",
    colors: [
      { r: 222, g: 72, b: 83 },
      { r: 32, g: 108, b: 180 },
      { r: 247, g: 194, b: 67 },
    ],
    captureAspectRatio: "4:3",
    captureCropRect: null,
    polaroidRenderSettings: { footerLabel: "Color Catchers" },
    remoteCatchId: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
    hasPhotoAsset: false,
  });
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const persistedCard = page.locator('.palette-card[data-palette-id="9001"]');
  await expect(persistedCard).toBeVisible();

  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect(persistedCard).toBeVisible();
});

test("startup maintenance atomically freezes legacy render settings", async ({ page }) => {
  await page.goto("/offline.html");
  await seedPalette(page, {
    id: 9002,
    timestamp: "2026-07-11T11:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
    captureAspectRatio: "4:3",
    captureCropRect: null,
    remoteCatchId: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
    hasPhotoAsset: false,
  });

  await page.goto("/");
  await expect
    .poll(async () => (await readPalette(page, 9002))?.polaroidRenderSettings)
    .toEqual({ footerLabel: "colorcatchers.co" });
});

for (const version of [1, 2]) {
  test(`upgrades a real version ${version} database and separates its master photo`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-webkit",
      "Playwright WebKit aborts the Blob-backed historical IndexedDB fixture; physical iOS remains a release check.",
    );
    const id = 9100 + version;
    await seedLegacyDatabase(page, version, {
      id,
      timestamp: `2026-07-0${version}T10:00:00.000Z`,
      colors: [{ r: 20 * version, g: 40, b: 60 }],
      ...(version >= 2
        ? {
            remoteCatchId: `remote-${id}`,
            moderationStatus: "PUBLIC",
          }
        : {}),
    });

    await page.goto("/");
    await expect
      .poll(async () => readMigratedPaletteAndAsset(page, id))
      .toMatchObject({
        asset: {
          paletteId: id,
          photoSize: 19,
          photoType: "image/webp",
        },
        // Dexie maps its decimal schema version 7 to native IndexedDB version 70.
        databaseVersion: 70,
        palette: {
          hasPhotoAsset: true,
          id,
          moderationStatus: version >= 2 ? "PUBLIC" : null,
          remoteCatchId: version >= 2 ? `remote-${id}` : null,
          remoteOwnerAccountKey: null,
        },
      });

    const migrated = await readMigratedPaletteAndAsset(page, id);
    expect(Object.hasOwn(migrated.palette, "photoBlob")).toBe(false);
    expect(migrated.objectStoreNames).toEqual(
      expect.arrayContaining([
        "palettes",
        "paletteAssets",
        "palettePreviews",
        "paletteStorageMetadata",
        "communityDeleteOutbox",
      ]),
    );
  });
}
