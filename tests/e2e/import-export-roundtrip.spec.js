import { expect, test } from "@playwright/test";
import { clearPalettes, installDeniedCamera, seedPalette } from "./support/browser-fixtures.js";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("exports and restores a collection backup with its photo", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Desktop Chromium exposes the downloaded backup path.");

  await page.goto("/");
  await seedPalette(
    page,
    {
      id: 9201,
      timestamp: "2026-07-11T12:00:00.000Z",
      colors: [
        { r: 12, g: 34, b: 56 },
        { r: 210, g: 180, b: 90 },
      ],
      captureAspectRatio: "4:3",
      captureCropRect: null,
      polaroidRenderSettings: { footerLabel: "Round trip" },
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
      hasPhotoAsset: true,
    },
    { photoBase64: ONE_PIXEL_PNG_BASE64 },
  );
  await page.reload();

  await page.locator(".btn-open-settings").click();
  await page.locator("#settingsTabData").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#settingsExportButton").click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  await clearPalettes(page);
  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(".palette-card")).toHaveCount(0);
  const collectionDialog = page.getByRole("dialog", { name: /^Captures/ });
  await collectionDialog.getByRole("button", { name: /fermer|close/i }).click();
  await expect(collectionDialog).toBeHidden();

  await page.locator(".btn-open-settings").click();
  await page.locator("#settingsTabData").click();
  await page.locator("#settingsImportInput").setInputFiles(backupPath);
  await expect(page.locator("#settingsDataStatus")).not.toHaveText("");
  await expect(page.locator("#settingsDataStatus")).not.toHaveClass(/is-error/);

  await page.keyboard.press("Escape");
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(".palette-card")).toHaveCount(1);

  const restored = await page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const transaction = database.transaction(["palettes", "paletteAssets"], "readonly");
      const palettesRequest = transaction.objectStore("palettes").getAll();
      const assetsRequest = transaction.objectStore("paletteAssets").getAll();
      transaction.oncomplete = () =>
        resolve({ palettes: palettesRequest.result, assets: assetsRequest.result });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return {
      colors: result.palettes[0]?.colors,
      photoSize: result.assets[0]?.photoBlob?.size ?? 0,
      photoType: result.assets[0]?.photoBlob?.type ?? "",
    };
  });

  expect(restored.colors).toEqual([
    { r: 12, g: 34, b: 56 },
    { r: 210, g: 180, b: 90 },
  ]);
  expect(restored.photoSize).toBeGreaterThan(0);
  expect(restored.photoType).toBe("image/png");
});
