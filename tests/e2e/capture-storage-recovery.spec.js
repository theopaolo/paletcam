import { expect, test } from "@playwright/test";
import {
  installOneShotPaletteQuotaFailure,
  installSyntheticCamera,
  readPaletteStoreCounts,
} from "./support/browser-fixtures.js";

test.beforeEach(async ({ page }) => {
  await installSyntheticCamera(page);
  await installOneShotPaletteQuotaFailure(page);
});

test("recovers from a quota failure without leaving a partial palette", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-webkit",
    "Playwright WebKit aborts Blob-backed IndexedDB writes; physical iOS remains a release check.",
  );
  await page.goto("/");

  const captureButton = page.locator(".btn-capture");
  await expect(captureButton).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.__syntheticCameraTestState.playCount))
    .toBeGreaterThan(0);

  await captureButton.click();

  const saveFailureToast = page.locator('toast-host .toast[data-toast-type="standard"]');
  await expect(saveFailureToast).toHaveClass(/toast--error/);
  await expect(saveFailureToast).toContainText(/Save failed\.|Sauvegarde échouée\./);
  await expect
    .poll(() => readPaletteStoreCounts(page))
    .toEqual({
      palettes: 0,
      paletteAssets: 0,
      palettePreviews: 0,
    });
  await expect(captureButton).toBeEnabled();

  await expect
    .poll(
      async () => {
        const attempts = await page.evaluate(() => window.__paletteQuotaFailureState.addAttempts);
        if (attempts < 2) {
          await captureButton.click();
        }
        return page.evaluate(() => window.__paletteQuotaFailureState.addAttempts);
      },
      { intervals: [100, 150, 250, 500] },
    )
    .toBe(2);

  await expect
    .poll(() => readPaletteStoreCounts(page))
    .toEqual({
      palettes: 1,
      paletteAssets: 1,
      palettePreviews: 1,
    });
  await expect(captureButton).toBeEnabled();
});
