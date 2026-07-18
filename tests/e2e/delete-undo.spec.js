import { expect, test } from "@playwright/test";
import { deriveCommunityAccountKey } from "../../src/community-account-key.js";
import { installDeniedCamera, readPalette, seedPalette } from "./support/browser-fixtures.js";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SESSION_KEY = "paletcam:community:session:v1";
const BULK_DELETE_SESSION = {
  token: "test-community-token",
  email: "catcher@example.com",
  user: null,
};
const BULK_DELETE_OWNER_ACCOUNT_KEY = deriveCommunityAccountKey(BULK_DELETE_SESSION);
const TEST_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization,content-type,idempotency-key,x-request-id",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST",
  "Access-Control-Allow-Origin": "*",
};

const palette = {
  id: 9301,
  timestamp: "2026-07-12T10:00:00.000Z",
  colors: [
    { r: 222, g: 72, b: 83 },
    { r: 32, g: 108, b: 180 },
  ],
  captureAspectRatio: "4:3",
  captureCropRect: null,
  polaroidRenderSettings: { footerLabel: "Color Catchers" },
  remoteCatchId: null,
  moderationStatus: null,
  postedAt: null,
  moderationUpdatedAt: null,
  lastModerationCheckAt: null,
  hasPhotoAsset: true,
};

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("undo restores a staged local deletion without losing metadata or image assets", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  const { expectsPhotoAsset, expectsPreviewAssets } = await seedDeletionFixture(page, browserName);
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const card = page.locator(`[data-palette-id="${palette.id}"]`);
  await card.locator(".palette-card-trigger").click();
  await page.locator("#catchDetailsDeleteButton").click();

  await expect(card).toBeHidden();
  const undoToast = page.locator('toast-host [data-toast-type="undo"]');
  await expect(undoToast).toContainText(/supprim|deleted/i);

  // Deletion is staged until the undo window expires. Metadata, the master
  // photo, and both derived preview variants remain durable while undo is possible.
  expect(await readPalette(page, palette.id)).toMatchObject({
    id: palette.id,
    hasPhotoAsset: expectsPhotoAsset,
  });
  expect(await readPhotoAsset(page, palette.id)).toEqual(
    expectsPhotoAsset ? { size: 68, type: "image/png" } : null,
  );
  assertPreviewRows(await readPreviewAssets(page, palette.id), expectsPreviewAssets);

  await undoToast.locator(".toast-action").click();
  await expect(card).toBeVisible();
  expect(await readPalette(page, palette.id)).toMatchObject({
    id: palette.id,
    hasPhotoAsset: expectsPhotoAsset,
  });
  expect(await readPhotoAsset(page, palette.id)).toEqual(
    expectsPhotoAsset ? { size: 68, type: "image/png" } : null,
  );
  assertPreviewRows(await readPreviewAssets(page, palette.id), expectsPreviewAssets);

  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect(card).toBeVisible();
});

test("an expired deletion removes metadata and its master photo across reload", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  const { expectsPreviewAssets } = await seedDeletionFixture(page, browserName);
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const card = page.locator(`[data-palette-id="${palette.id}"]`);
  await card.locator(".palette-card-trigger").click();
  await page.locator("#catchDetailsDeleteButton").click();

  const undoToast = page.locator('toast-host [data-toast-type="undo"]');
  await expect(undoToast).toBeVisible();
  await expect(undoToast).toBeHidden({ timeout: 8000 });
  await expect.poll(() => readPalette(page, palette.id)).toBeNull();
  await expect.poll(() => readPhotoAsset(page, palette.id)).toBeNull();
  if (expectsPreviewAssets) {
    await expect
      .poll(() => readPreviewAssets(page, palette.id))
      .toEqual({ gallery: null, viewer: null });
  }

  await page.reload();
  expect(await readPalette(page, palette.id)).toBeNull();
  expect(await readPhotoAsset(page, palette.id)).toBeNull();
  expect(await readPreviewAssets(page, palette.id)).toEqual({ gallery: null, viewer: null });
});

test("swiping the undo toast commits the staged deletion across reload", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  const { expectsPreviewAssets } = await seedDeletionFixture(page, browserName);
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const card = page.locator(`[data-palette-id="${palette.id}"]`);
  await card.locator(".palette-card-trigger").click();
  await page.locator("#catchDetailsDeleteButton").click();

  const undoToast = page.locator('toast-host [data-toast-type="undo"]');
  await expect(undoToast).toBeVisible();
  await undoToast.dispatchEvent("pointerdown", {
    clientX: 20,
    clientY: 20,
    isPrimary: true,
    pointerId: 1,
  });
  await undoToast.dispatchEvent("pointermove", {
    clientX: 140,
    clientY: 20,
    isPrimary: true,
    pointerId: 1,
  });
  await undoToast.dispatchEvent("pointerup", {
    clientX: 140,
    clientY: 20,
    isPrimary: true,
    pointerId: 1,
  });
  await assertDeletionIsDurable(page, expectsPreviewAssets);
});

test("app teardown cancels a staged deletion without losing durable data", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  const { expectsPhotoAsset, expectsPreviewAssets } = await seedDeletionFixture(page, browserName);
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const card = page.locator(`[data-palette-id="${palette.id}"]`);
  await card.locator(".palette-card-trigger").click();
  await page.locator("#catchDetailsDeleteButton").click();
  await expect(page.locator('toast-host [data-toast-type="undo"]')).toBeVisible();

  // Leaving the document destroys the lazy collection module. Its programmatic
  // settlement must cancel the staged operation instead of committing it.
  await page.goto("about:blank");
  await page.goto("/");

  expect(await readPalette(page, palette.id)).toMatchObject({
    id: palette.id,
    hasPhotoAsset: expectsPhotoAsset,
  });
  expect(await readPhotoAsset(page, palette.id)).toEqual(
    expectsPhotoAsset ? { size: 68, type: "image/png" } : null,
  );
  assertPreviewRows(await readPreviewAssets(page, palette.id), expectsPreviewAssets);

  await page.locator(".btn-view-collection").click();
  await expect(card).toBeVisible();
});

test("bulk selection commits several deletions through the bounded runner", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  const paletteIds = [9401, 9402, 9403];
  for (const [index, paletteId] of paletteIds.entries()) {
    await seedPalette(
      page,
      {
        ...palette,
        id: paletteId,
        timestamp: `2026-07-12T10:0${index}:00.000Z`,
        hasPhotoAsset: browserName !== "webkit",
      },
      browserName !== "webkit"
        ? {
            photoBase64: ONE_PIXEL_PNG_BASE64,
            photoType: "image/png",
          }
        : {},
    );
  }
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const cards = paletteIds.map((paletteId) => page.locator(`[data-palette-id="${paletteId}"]`));
  await cards[0].dispatchEvent("pointerdown", { clientX: 10, clientY: 10 });
  await page.waitForTimeout(550);
  await cards[0].dispatchEvent("pointerup", { clientX: 10, clientY: 10 });
  // A real long press is followed by a click; selection mode suppresses that
  // one click so the initiating card remains selected.
  await cards[0].click();
  await cards[1].click();
  await cards[2].click();

  await expect(page.locator("#collectionSelectionCount")).toHaveText("3");
  await page.locator("#collectionSelectionDelete").click();
  await expect(cards[0]).toBeHidden();

  await expect
    .poll(async () => Promise.all(paletteIds.map((paletteId) => readPalette(page, paletteId))), {
      timeout: 10_000,
    })
    .toEqual([null, null, null]);

  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(".collection-empty")).toBeVisible();
});

test("cancelling a running bulk deletion preserves work that has not started", async ({ page }) => {
  let releaseRemoteCleanup = () => {};
  const remoteCleanupGate = new Promise((resolve) => {
    releaseRemoteCleanup = resolve;
  });
  let cleanupAttempts = 0;

  await page.route("**/api/v1/catch/*/unpublish", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: TEST_CORS_HEADERS });
      return;
    }
    cleanupAttempts += 1;
    await remoteCleanupGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: TEST_CORS_HEADERS,
      body: "{}",
    });
  });

  await page.goto("/");

  const paletteIds = [9501, 9502, 9503, 9504, 9505, 9506];
  for (const [index, paletteId] of paletteIds.entries()) {
    await seedPalette(page, {
      ...palette,
      id: paletteId,
      timestamp: `2026-07-12T11:0${index}:00.000Z`,
      hasPhotoAsset: false,
      remoteCatchId: `remote-${paletteId}`,
      remoteOwnerAccountKey: BULK_DELETE_OWNER_ACCOUNT_KEY,
      moderationStatus: "PUBLIC",
      postedAt: `2026-07-12T11:0${index}:00.000Z`,
    });
  }
  await page.reload();
  await page.locator(".btn-view-collection").click();

  const cards = paletteIds.map((paletteId) => page.locator(`[data-palette-id="${paletteId}"]`));
  await cards[0].dispatchEvent("pointerdown", { clientX: 10, clientY: 10 });
  await page.waitForTimeout(550);
  await cards[0].dispatchEvent("pointerup", { clientX: 10, clientY: 10 });
  await cards[0].click();
  for (const card of cards.slice(1)) {
    await card.click();
  }
  await expect(page.locator("#collectionSelectionCount")).toHaveText("6");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: BULK_DELETE_SESSION,
  });
  await page.locator("#collectionSelectionDelete").click();

  const progressToast = page
    .locator('toast-host [data-toast-type="undo"]')
    .filter({ hasText: /définitive|permanently deleting/i });
  await expect(progressToast).toBeVisible({ timeout: 8000 });
  // The durable outbox is intentionally a single remote executor. The bulk
  // runner may have two local deletion commits in flight, but the second
  // cleanup does not start until the first leased job settles.
  await expect.poll(() => cleanupAttempts).toBe(1);

  await progressToast.locator(".toast-action").click();
  releaseRemoteCleanup();
  await expect.poll(() => cleanupAttempts).toBe(2);

  await expect
    .poll(async () => {
      const palettes = await Promise.all(
        paletteIds.map((paletteId) => readPalette(page, paletteId)),
      );
      return palettes.filter(Boolean).length;
    })
    .toBe(4);
  expect(cleanupAttempts).toBe(2);

  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(".palette-card")).toHaveCount(4);
});

async function seedDeletionFixture(page, browserName) {
  // Playwright's WebKit build rejects every Blob-backed IndexedDB fixture used
  // in this suite. It still covers the complete delete/undo UI and metadata
  // transaction; Chromium additionally proves the master-photo relationship.
  const expectsPhotoAsset = browserName !== "webkit";
  await seedPalette(
    page,
    { ...palette, hasPhotoAsset: expectsPhotoAsset },
    expectsPhotoAsset
      ? {
          photoBase64: ONE_PIXEL_PNG_BASE64,
          photoType: "image/png",
        }
      : {},
  );
  if (expectsPhotoAsset) {
    await seedPreviewAssets(page, palette.id);
  }
  return { expectsPhotoAsset, expectsPreviewAssets: expectsPhotoAsset };
}

async function assertDeletionIsDurable(page, expectsPreviewAssets) {
  await expect.poll(() => readPalette(page, palette.id)).toBeNull();
  await expect.poll(() => readPhotoAsset(page, palette.id)).toBeNull();
  if (expectsPreviewAssets) {
    await expect
      .poll(() => readPreviewAssets(page, palette.id))
      .toEqual({ gallery: null, viewer: null });
  }

  await page.reload();
  expect(await readPalette(page, palette.id)).toBeNull();
  expect(await readPhotoAsset(page, palette.id)).toBeNull();
  expect(await readPreviewAssets(page, palette.id)).toEqual({ gallery: null, viewer: null });
}

async function seedPreviewAssets(page, paletteId) {
  await page.evaluate(
    async ({ id, previewBase64 }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("PaletcamDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const bytes = Uint8Array.from(atob(previewBase64), (character) => character.charCodeAt(0));
      const createPreviewBlob = () =>
        new Response(bytes, { headers: { "Content-Type": "image/png" } }).blob();
      const [galleryBlob, viewerBlob] = await Promise.all([
        createPreviewBlob(),
        createPreviewBlob(),
      ]);
      const transaction = database.transaction("palettePreviews", "readwrite");
      transaction.objectStore("palettePreviews").put({
        paletteId: id,
        variant: "gallery",
        blob: galleryBlob,
        footerLabel: "preview-v9:gallery:image/webp:Color Catchers",
      });
      transaction.objectStore("palettePreviews").put({
        paletteId: id,
        variant: "viewer",
        blob: viewerBlob,
        footerLabel: "preview-v9:viewer:image/webp:Color Catchers",
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    { id: paletteId, previewBase64: ONE_PIXEL_PNG_BASE64 },
  );
}

function assertPreviewRows(previews, expected) {
  if (!expected) {
    expect(previews).toEqual({ gallery: null, viewer: null });
    return;
  }

  expect(previews.gallery).toMatchObject({ paletteId: palette.id, variant: "gallery" });
  expect(previews.gallery.blobSize).toBeGreaterThan(0);
  expect(previews.viewer).toMatchObject({ paletteId: palette.id, variant: "viewer" });
  expect(previews.viewer.blobSize).toBeGreaterThan(0);
}

async function readPreviewAssets(page, paletteId) {
  return page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("PaletcamDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("palettePreviews", "readonly");
    const read = (variant) =>
      new Promise((resolve, reject) => {
        const request = transaction.objectStore("palettePreviews").get([id, variant]);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    const [gallery, viewer] = await Promise.all([read("gallery"), read("viewer")]);
    database.close();
    const summarize = (record) =>
      record
        ? {
            blobSize: record.blob instanceof Blob ? record.blob.size : 0,
            paletteId: record.paletteId,
            variant: record.variant,
          }
        : null;
    return { gallery: summarize(gallery), viewer: summarize(viewer) };
  }, paletteId);
}

async function readPhotoAsset(page, paletteId) {
  return page.evaluate(async (id) => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise((resolve, reject) => {
      const getRequest = database
        .transaction("paletteAssets", "readonly")
        .objectStore("paletteAssets")
        .get(id);
      getRequest.onsuccess = () => resolve(getRequest.result ?? null);
      getRequest.onerror = () => reject(getRequest.error);
    });
    database.close();
    return record?.photoBlob instanceof Blob
      ? { size: record.photoBlob.size, type: record.photoBlob.type }
      : null;
  }, paletteId);
}
