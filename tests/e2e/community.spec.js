import { expect, test } from "@playwright/test";
import { installDeniedCamera, readPalette, seedPalette } from "./support/browser-fixtures.js";

const SESSION_KEY = "paletcam:community:session:v1";
const DELETE_OUTBOX_KEY = "paletcam:community:delete-cleanup-outbox:v1";
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TEST_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization,content-type,idempotency-key,x-request-id",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST",
  "Access-Control-Allow-Origin": "*",
};

async function fulfillCorsPreflight(route) {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: TEST_CORS_HEADERS });
  return true;
}

function accountKeyForEmail(email) {
  let hash = 0xcbf29ce484222325n;
  for (const character of `email:${email.trim().toLowerCase()}`) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `account:${hash.toString(16).padStart(16, "0")}`;
}
const palette = {
  id: 9201,
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
  hasPhotoAsset: true,
};

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("login reports a mocked API failure, then persists a verified session", async ({ page }) => {
  let loginAttempts = 0;
  await page.route("**/api/v1/login", async (route) => {
    if (await fulfillCorsPreflight(route)) return;
    loginAttempts += 1;
    if (loginAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: TEST_CORS_HEADERS,
        body: JSON.stringify({ message: "Community temporarily unavailable" }),
      });
      return;
    }
    await route.fulfill({ status: 204, headers: TEST_CORS_HEADERS });
  });
  await page.route("**/api/v1/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "test-community-token",
        user: { id: "user-1", email: "catcher@example.com", name: "Catcher" },
      }),
    }),
  );

  await page.goto("/");
  await page.locator(".btn-open-settings").click();
  const email = page.locator("#communityEmailInput");
  await email.fill(" Catcher@Example.com ");
  await page.locator("#communityRequestCodeButton").click();
  await expect.poll(() => loginAttempts).toBe(1);
  await expect(page.locator("#communityAuthHint")).toContainText(
    "Community temporarily unavailable",
  );
  await expect(page.locator("#communityCodeField")).toBeHidden();

  await page.locator("#communityRequestCodeButton").click();
  await expect(page.locator("#communityCodeField")).toBeVisible();
  await page.locator("#communityCodeInput").fill("123456");
  await page.locator("#communityVerifyCodeButton").click();
  await expect(page.locator("#communityAccountState")).toContainText("catcher@example.com");

  const storedSession = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SESSION_KEY,
  );
  expect(storedSession).toMatchObject({
    token: "test-community-token",
    email: "catcher@example.com",
    user: { id: "user-1", email: "catcher@example.com" },
  });

  await page.reload();
  await page.locator(".btn-open-settings").click();
  await expect(page.locator("#communityAccountState")).toContainText("catcher@example.com");
});

test("publishes and unpublishes a seeded photo palette through mocked APIs", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit cannot persist Blob-backed IndexedDB fixtures; verify publishing on a real iOS device.",
  );
  const requests = [];
  await page.route("**/api/v1/catch/publish", async (route) => {
    requests.push({ kind: "publish", request: route.request() });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ catch: { id: "remote-9201", status: "PUBLIC" } }),
    });
  });
  await page.route("**/api/v1/catch/remote-9201/unpublish", async (route) => {
    requests.push({ kind: "unpublish", request: route.request() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/catches/statuses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ catches: [], deletedIds: [] }),
    }),
  );

  await page.goto("/");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: { token: "test-community-token", email: "catcher@example.com", user: null },
  });
  await seedPalette(page, palette, {
    photoBase64: ONE_PIXEL_PNG_BASE64,
    photoType: "image/png",
  });
  await page.reload();
  await page.locator(".btn-view-collection").click();
  const paletteCard = page.locator(".palette-card").first();
  const paletteId = Number(await paletteCard.getAttribute("data-palette-id"));
  await paletteCard.locator(".palette-card-trigger").click();

  const publicationButton = page.locator("#catchDetailsPublishButton");
  await expect(publicationButton).toHaveAccessibleName(/publier|publish/i);
  await publicationButton.click();
  await expect(publicationButton).toHaveAccessibleName(/d.pub|unpublish/i);

  const published = await readPalette(page, paletteId);
  expect(published).toMatchObject({ remoteCatchId: "remote-9201", moderationStatus: "PUBLIC" });
  expect(requests).toHaveLength(1);
  expect(requests[0].request.headers().authorization).toBe("Bearer test-community-token");
  const publishBody = requests[0].request.postDataJSON();
  expect(publishBody.colors).toHaveLength(3);
  expect(publishBody.photoBlob).toBeTruthy();

  await publicationButton.click();
  await expect(publicationButton).toHaveAccessibleName(/publier|publish/i);
  await expect
    .poll(async () => {
      const unpublished = await readPalette(page, paletteId);
      return {
        remoteCatchId: unpublished?.remoteCatchId,
        moderationStatus: unpublished?.moderationStatus,
      };
    })
    .toEqual({ remoteCatchId: "remote-9201", moderationStatus: "PRIVATE" });
  expect(requests).toHaveLength(2);
  expect(requests[1].request.headers().authorization).toBe("Bearer test-community-token");
});

test("retains a failed cleanup outbox across reload and flushes it after reconnect", async ({
  page,
}) => {
  let cleanupAttempts = 0;
  await page.addInitScript(() => {
    globalThis.__paletcamTestOnline = false;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => globalThis.__paletcamTestOnline === true,
    });
  });
  const accountKey = accountKeyForEmail("catcher@example.com");
  await page.addInitScript(
    ({ accountKey, sessionKey, outboxKey }) => {
      const fixtureMarker = "paletcam:test:legacy-outbox-seeded";
      if (sessionStorage.getItem(fixtureMarker) === "1") {
        return;
      }
      sessionStorage.setItem(fixtureMarker, "1");
      localStorage.setItem(
        sessionKey,
        JSON.stringify({ token: "test-community-token", email: "catcher@example.com", user: null }),
      );
      localStorage.setItem(
        outboxKey,
        JSON.stringify([
          {
            accountKey,
            remoteCatchId: "remote-outbox",
            attemptCount: 1,
            enqueuedAt: "2026-07-11T10:00:00.000Z",
            lastAttemptAt: "2026-07-11T10:01:00.000Z",
            nextAttemptAt: "2099-01-01T00:00:00.000Z",
          },
        ]),
      );
    },
    {
      sessionKey: SESSION_KEY,
      outboxKey: DELETE_OUTBOX_KEY,
      accountKey,
    },
  );
  await page.route("**/api/v1/catch/remote-outbox/unpublish", async (route) => {
    if (await fulfillCorsPreflight(route)) return;
    cleanupAttempts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: TEST_CORS_HEADERS,
      body: "{}",
    });
  });

  await page.goto("/");
  await page.locator(".btn-view-collection").click();
  await expect.poll(() => cleanupAttempts).toBe(0);
  await expect
    .poll(async () => {
      const retained = await readDeleteOutbox(page);
      return retained.map(({ remoteCatchId, attemptCount }) => ({ remoteCatchId, attemptCount }));
    })
    .toEqual([{ remoteCatchId: "remote-outbox", attemptCount: 1 }]);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), DELETE_OUTBOX_KEY))
    .toBeNull();

  await page.reload();
  await page.locator(".btn-view-collection").click();
  await expect
    .poll(async () => {
      const retained = await readDeleteOutbox(page);
      return retained.map(({ remoteCatchId, attemptCount }) => ({ remoteCatchId, attemptCount }));
    })
    .toEqual([{ remoteCatchId: "remote-outbox", attemptCount: 1 }]);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), DELETE_OUTBOX_KEY))
    .toBeNull();

  await page.evaluate(() => {
    globalThis.__paletcamTestOnline = false;
    globalThis.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => cleanupAttempts).toBe(0);
  await page.evaluate(() => {
    globalThis.__paletcamTestOnline = true;
    globalThis.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => cleanupAttempts).toBe(1);
  await expect.poll(() => readDeleteOutbox(page)).toEqual([]);
});

async function readDeleteOutbox(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("PaletcamDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction("communityDeleteOutbox", "readonly")
          .objectStore("communityDeleteOutbox")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}
