import { expect, test } from "@playwright/test";
import { installDeniedCamera, readPalette, seedPalette } from "./support/browser-fixtures.js";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const EXISTING_PALETTE_ID = 9202;

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("rejects a corrupt backup without changing the collection", async ({ page, browserName }) => {
  await page.goto("/");
  const expectsPhotoAsset = browserName !== "webkit";
  await seedPalette(
    page,
    {
      id: EXISTING_PALETTE_ID,
      timestamp: "2026-07-11T12:30:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      captureAspectRatio: "4:3",
      captureCropRect: null,
      polaroidRenderSettings: { footerLabel: "Rollback fixture" },
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
      hasPhotoAsset: expectsPhotoAsset,
    },
    expectsPhotoAsset ? { photoBase64: ONE_PIXEL_PNG_BASE64, photoType: "image/png" } : {},
  );
  const masterBeforeImport = await readMasterPhoto(page, EXISTING_PALETTE_ID);
  if (expectsPhotoAsset) {
    expect(masterBeforeImport).toMatchObject({ type: "image/png" });
    expect(masterBeforeImport.size).toBeGreaterThan(0);
  } else {
    expect(masterBeforeImport).toBeNull();
  }

  await page.reload();
  await page.locator(".btn-open-settings").click();
  await page.locator("#settingsTabData").click();

  await page.locator("#settingsImportInput").setInputFiles({
    name: "corrupt-palette-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":2,"palettes":[invalid]}'),
  });

  const status = page.locator("#settingsDataStatus");
  await expect(status).toBeVisible();
  await expect(status).toHaveClass(/is-error/);
  await expect(status).not.toHaveText("");

  await page.keyboard.press("Escape");
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(`[data-palette-id="${EXISTING_PALETTE_ID}"]`)).toBeVisible();
  await expect(page.locator(".palette-card")).toHaveCount(1);
  expect(await readPalette(page, EXISTING_PALETTE_ID)).toMatchObject({
    id: EXISTING_PALETTE_ID,
    hasPhotoAsset: expectsPhotoAsset,
  });
  expect(await readMasterPhoto(page, EXISTING_PALETTE_ID)).toEqual(masterBeforeImport);
});

async function readMasterPhoto(page, paletteId) {
  return page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("PaletcamDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const record = await new Promise((resolve, reject) => {
        const request = database
          .transaction("paletteAssets", "readonly")
          .objectStore("paletteAssets")
          .get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      return record?.photoBlob instanceof Blob
        ? { size: record.photoBlob.size, type: record.photoBlob.type }
        : null;
    } finally {
      database.close();
    }
  }, paletteId);
}
