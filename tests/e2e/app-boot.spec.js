import { expect, test } from "@playwright/test";
import { installDeniedCamera } from "./support/browser-fixtures.js";

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("boots into a usable shell when camera permission is denied", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Color Catchers/);
  await expect(page.locator(".btn-capture")).toBeVisible();
  await expect(page.locator(".btn-view-collection")).toBeVisible();

  await page.locator(".btn-view-collection").click();
  await expect(page.locator("shared-panel.collection-panel")).toHaveClass(/visible/);
  await expect(page.locator("#collectionGrid .collection-empty")).toBeVisible();
});
