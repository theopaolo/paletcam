import { expect, test } from "@playwright/test";
import { installSyntheticCamera } from "./support/browser-fixtures.js";

async function readCapturedPalette(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("PaletcamDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const transaction = database.transaction(["palettes", "paletteAssets"], "readonly");
      const palette = await new Promise((resolve, reject) => {
        const request = transaction.objectStore("palettes").getAll();
        request.onsuccess = () => resolve(request.result.at(-1) ?? null);
        request.onerror = () => reject(request.error);
      });

      if (!palette) return null;

      const asset = await new Promise((resolve, reject) => {
        const request = transaction.objectStore("paletteAssets").get(palette.id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });

      return {
        captureAspectRatio: palette.captureAspectRatio,
        colorCount: palette.colors?.length ?? 0,
        hasPhotoAsset: palette.hasPhotoAsset,
        id: palette.id,
        photoSize: asset?.photoBlob?.size ?? 0,
        photoType: asset?.photoBlob?.type ?? "",
      };
    } finally {
      database.close();
    }
  });
}

test.beforeEach(async ({ page }) => {
  await installSyntheticCamera(page);
});

test("captures a synthetic camera frame and persists its palette with photo", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-webkit",
    "Playwright WebKit aborts Blob-backed IndexedDB writes; physical iOS remains a release check.",
  );
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__syntheticCameraTestState.requests.some(
          (request) => request.facingMode === "environment",
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator(".btn-capture")).toBeEnabled();
  await page.locator(".btn-capture").click();

  await expect
    .poll(() => readCapturedPalette(page))
    .toMatchObject({
      captureAspectRatio: "4:3",
      colorCount: 4,
      hasPhotoAsset: true,
    });

  const captured = await readCapturedPalette(page);
  expect(captured.photoSize).toBeGreaterThan(0);
  expect(["image/jpeg", "image/webp"]).toContain(captured.photoType);
  await expect(page.locator("#photo")).toHaveAttribute("data-palette-id", String(captured.id));
  await expect(page.locator("#photo")).toBeVisible();
});

test("switches a live synthetic stream from rear to front camera", async ({ page }) => {
  await page.goto("/offline.html");

  const result = await page.evaluate(async () => {
    const { createCameraController } = await import("/modules/camera-controller.js");
    const video = document.createElement("video");
    const controller = createCameraController({ cameraFeed: video });

    const rearStarted = await controller.startStream();
    const rearTrack = video.srcObject.getVideoTracks()[0];
    const frontStarted = await controller.toggleFacingMode();
    const frontTrack = video.srcObject.getVideoTracks()[0];
    const state = window.__syntheticCameraTestState;
    const snapshot = {
      facingMode: controller.getFacingMode(),
      frontStarted,
      frontTrackState: frontTrack.readyState,
      rearStarted,
      rearTrackState: rearTrack.readyState,
      requests: state.requests.map((request) => request.facingMode),
      stopsBeforeDestroy: state.stopCount,
    };

    controller.destroy();
    return { ...snapshot, stopsAfterDestroy: state.stopCount };
  });

  expect(result).toEqual({
    facingMode: "user",
    frontStarted: true,
    frontTrackState: "live",
    rearStarted: true,
    rearTrackState: "ended",
    requests: ["environment", "user"],
    stopsAfterDestroy: 2,
    stopsBeforeDestroy: 1,
  });
});
