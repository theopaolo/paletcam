import { expect, test } from "@playwright/test";
import { installDeniedCamera, seedPalette } from "./support/browser-fixtures.js";

const palette = {
  id: 9101,
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
};

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("collection dialog traps focus and Escape restores its opener", async ({ page }) => {
  await page.goto("/");

  const opener = page.locator(".btn-view-collection");
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /^Captures/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const finalControl = page.getByRole("button", { name: /nuancier|swatches/i });
  await finalControl.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /fermer|close/i })).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(finalControl).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("viewer exposes named actions, contains focus, and restores the capture trigger", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await seedPalette(page, palette);
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const captureTrigger = page.locator(
    '.palette-card[data-palette-id="9101"] .palette-card-trigger',
  );
  await expect(captureTrigger).toHaveAccessibleName(/capture/i);
  await captureTrigger.click();

  const viewer = page.getByRole("dialog", { name: "Capture", exact: true });
  const collectionPanel = page.locator('shared-panel[data-panel-name="collection"]');
  await expect(viewer).toBeVisible();
  await expect(collectionPanel).toHaveAttribute("aria-hidden", "true");
  expect(await collectionPanel.evaluate((panel) => panel.inert)).toBe(true);
  const cameraButton = page.locator("#catchDetailsCameraButton");
  const deleteButton = page.locator("#catchDetailsDeleteButton");
  const shareButton = page.locator("#catchDetailsShareButton");
  await expect(cameraButton).toHaveAccessibleName(/appareil photo|camera/i);
  await expect(cameraButton).toBeVisible();
  await expect(deleteButton).toHaveAccessibleName(/supprimer|delete/i);
  await expect(deleteButton).toBeVisible();
  await expect(shareButton).toHaveAccessibleName(/partager|share/i);
  await expect(shareButton).toBeVisible();

  const flipButton = page.locator(".palette-viewer-flip");
  await expect(flipButton).toHaveAccessibleName(/retourner|flip/i);
  await expect(flipButton).not.toHaveClass(/is-peeking/);

  const finalControl = deleteButton;
  await finalControl.focus();
  await page.keyboard.press("Tab");
  await expect(cameraButton).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(finalControl).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(captureTrigger).toBeFocused();
  await expect(collectionPanel).toHaveAttribute("aria-hidden", "false");
  expect(await collectionPanel.evaluate((panel) => panel.inert)).toBe(false);
  await expect(page.getByRole("dialog", { name: /^Captures/ })).toBeVisible();
});
