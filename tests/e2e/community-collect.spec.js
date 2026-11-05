import { expect, test } from "@playwright/test";
import { installDeniedCamera } from "./support/browser-fixtures.js";

const SESSION_KEY = "paletcam:community:session:v1";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,PUT",
  "Access-Control-Allow-Origin": "*",
};

const item = (id, userName) => ({
  id,
  user_name: userName,
  caught_at: "2026-02-20T12:44:14+00:00",
  colors: ["#ffc800", "#112233", "#aa3355"],
  square_url: `/catch/square/${id}`,
  polaroid_url: `/catch/polaroid/${id}`,
  url: `/c/${id}`,
});

/**
 * Mocks the feed, the collection and the collect endpoints on whichever origin
 * the app calls. `collected` is the server's own set of collected catch ids.
 */
async function mockCommunity(page, { collected = [] } = {}) {
  const state = { collected: new Set(collected), collectionCursors: [], writes: [], tokens: [] };
  const rootUrls = (body, origin) => ({
    ...body,
    items: body.items.map((entry) => ({
      ...entry,
      square_url: `${origin}${entry.square_url}`,
      polaroid_url: `${origin}${entry.polaroid_url}`,
      url: `${origin}${entry.url}`,
    })),
  });
  const reply = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    });

  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }

      if (url.pathname === "/api/v1/catches") {
        const signedIn = Boolean(request.headers().authorization);
        state.tokens.push(request.headers().authorization ?? null);
        const items = [item("A1", "nuagelait"), item("A2", "ciel")].map((entry) =>
          signedIn ? { ...entry, collected: state.collected.has(entry.id) } : entry,
        );
        await reply(
          route,
          rootUrls(
            {
              items,
              next_cursor: null,
              ...(signedIn ? { collected_count: state.collected.size } : {}),
            },
            url.origin,
          ),
        );
        return;
      }

      if (url.pathname === "/api/v1/collection") {
        const after = url.searchParams.get("after") ?? "";
        state.collectionCursors.push(after);
        const page =
          after === ""
            ? { items: [{ ...item("A2", "ciel"), collected: true }], next_cursor: "7" }
            : { items: [{ ...item("A9", "brume"), collected: true }], next_cursor: null };
        await reply(
          route,
          rootUrls({ ...page, collected_count: state.collected.size }, url.origin),
        );
        return;
      }

      const collect = url.pathname.match(/^\/api\/v1\/catch\/([^/]+)\/collect$/);
      if (collect) {
        const collectedNow = request.method() === "PUT";
        state.writes.push(`${request.method()} ${collect[1]}`);
        if (collectedNow) state.collected.add(collect[1]);
        else state.collected.delete(collect[1]);
        await reply(route, { collected: collectedNow });
        return;
      }

      await route.fallback();
    },
  );
  await page.route(
    (url) => url.pathname.startsWith("/catch/"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
        body: ONE_PIXEL_PNG,
      }),
  );
  return state;
}

async function signIn(page) {
  await page.goto("/");
  await page.evaluate(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ token: "test-token", email: "catcher@example.com", user: null }),
      ),
    { key: SESSION_KEY },
  );
  await page.reload();
}

async function openCommunity(page) {
  await expect(page.locator(".btn-community-feed")).toBeEnabled();
  await page.locator(".btn-community-feed").click();
  await expect(page.locator("shared-panel.community-panel.visible")).toBeVisible();
}

const card = (page, id) => page.locator(`#communityGrid .palette-card[data-palette-id="${id}"]`);
const star = (page) => page.locator("#catchDetailsFavoriteButton");

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("a signed-in reader sees their collected catches marked and can collect another", async ({
  page,
}) => {
  const state = await mockCommunity(page, { collected: ["A2"] });
  await signIn(page);
  await openCommunity(page);

  expect(state.tokens).toEqual(["Bearer test-token"]);
  await expect(card(page, "A2")).toHaveClass(/is-favorite/);
  await expect(card(page, "A1")).not.toHaveClass(/is-favorite/);

  await card(page, "A1").locator(".palette-card-trigger").click();
  await expect(star(page)).toBeVisible();
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(star(page)).toHaveAccessibleName(/collecter/i);

  await star(page).click();

  await expect(star(page)).toHaveAttribute("aria-pressed", "true");
  await expect(star(page)).toHaveAccessibleName(/retirer de ma collection/i);
  expect(state.writes).toEqual(["PUT A1"]);

  await page.locator("shared-panel.catch-details-panel .close-button").click();
  await expect(card(page, "A1")).toHaveClass(/is-favorite/);
});

test("without an account the star asks to sign in and sends nothing", async ({ page }) => {
  const state = await mockCommunity(page);
  await page.goto("/");
  await openCommunity(page);

  await expect(page.locator("#communityFilterCollectedButton")).toBeHidden();

  await card(page, "A1").locator(".palette-card-trigger").click();
  await star(page).click();

  await expect(
    page.locator(".toast-message", { hasText: "Connectez votre email pour collecter." }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
});

test("the collected button shows the reader's collection, page after page", async ({ page }) => {
  const state = await mockCommunity(page, { collected: ["A2", "A9"] });
  await signIn(page);
  await openCommunity(page);

  const button = page.locator("#communityFilterCollectedButton");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  await expect(card(page, "A2")).toBeVisible();
  await expect(card(page, "A1")).toHaveCount(0);
  // Older collected catches come in as the reader reaches the end.
  await expect
    .poll(async () => {
      await page.locator("#communityGrid").evaluate((grid) => {
        grid.closest(".collection-panel-body").scrollTo({ top: 1e6 });
      });
      return page.locator("#communityGrid .palette-card").count();
    })
    .toBe(2);
  expect(state.collectionCursors).toEqual(["", "7"]);

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "A1")).toBeVisible();
});

test("removing a catch in the collected view keeps it listed until the view is left", async ({
  page,
}) => {
  const state = await mockCommunity(page, { collected: ["A2", "A9"] });
  await signIn(page);
  await openCommunity(page);
  await page.locator("#communityFilterCollectedButton").click();
  await expect(card(page, "A2")).toHaveClass(/is-favorite/);

  await card(page, "A2").locator(".palette-card-trigger").click();
  await expect(star(page)).toHaveAttribute("aria-pressed", "true");
  await star(page).click();

  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  expect(state.writes).toEqual(["DELETE A2"]);
  await page.locator("shared-panel.catch-details-panel .close-button").click();
  await expect(card(page, "A2")).toBeVisible();
  await expect(card(page, "A2")).not.toHaveClass(/is-favorite/);

  // Back on the whole feed the catch reads as not collected; reopening the
  // collection reads it from the server again.
  await page.locator("#communityFilterCollectedButton").click();
  await expect(card(page, "A2")).not.toHaveClass(/is-favorite/);
});

test("a failed collect leaves the star off and says so", async ({ page }) => {
  await mockCommunity(page);
  await page.route(
    (url) => /\/api\/v1\/catch\/[^/]+\/collect$/.test(url.pathname),
    async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: "down" }),
      });
    },
  );
  await signIn(page);
  await openCommunity(page);

  await card(page, "A1").locator(".palette-card-trigger").click();
  await star(page).click();

  await expect(
    page.locator(".toast-message", { hasText: "Impossible de modifier votre collection." }),
  ).toBeVisible();
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
});

test("the collected button counts the reader's collection and follows each change", async ({
  page,
}) => {
  await mockCommunity(page, { collected: ["A2"] });
  await signIn(page);
  await openCommunity(page);

  const button = page.locator("#communityFilterCollectedButton");
  await expect(button).toHaveAttribute("data-count", "1");
  // The pill shows the count the way the favourites chip does.
  expect(await button.evaluate((element) => getComputedStyle(element, "::after").content)).toBe(
    '"1"',
  );

  await card(page, "A1").locator(".palette-card-trigger").click();
  await star(page).click();
  await expect(star(page)).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAttribute("data-count", "2");

  await star(page).click();
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAttribute("data-count", "1");
});

test("with nothing collected the button stays away until the first catch is collected", async ({
  page,
}) => {
  await mockCommunity(page);
  await signIn(page);
  await openCommunity(page);

  const button = page.locator("#communityFilterCollectedButton");
  await expect(card(page, "A1")).toBeVisible();
  await expect(button).toBeHidden();

  await card(page, "A1").locator(".palette-card-trigger").click();
  await star(page).click();

  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("data-count", "1");
});

test("the header no longer links to the community; the footer key carries the signed-in LED", async ({
  page,
}) => {
  await mockCommunity(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.locator(".btn-community-feed")).toBeEnabled();

  await expect(page.locator("header .btn-community, #communityHomepageLink")).toHaveCount(0);
  // The name keeps its place in the middle of the header.
  const header = await page.locator(".shell-header").boundingBox();
  const name = await page.locator(".shell-nameplate").boundingBox();
  expect(Math.abs(name.x + name.width / 2 - (header.x + header.width / 2))).toBeLessThan(2);

  const led = (selector) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { color: style.backgroundColor, lit: element.classList.contains("is-signed-in") };
    });
  const signedOut = await led(".btn-community-feed");
  expect(signedOut.lit).toBe(false);

  await page.evaluate(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ token: "test-token", email: "catcher@example.com", user: null }),
      ),
    { key: SESSION_KEY },
  );
  await page.reload();
  await expect(page.locator(".btn-community-feed")).toBeEnabled();

  const signedIn = await led(".btn-community-feed");
  expect(signedIn.lit).toBe(true);
  expect(signedIn.color).not.toBe(signedOut.color);
});
