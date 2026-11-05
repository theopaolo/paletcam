import { expect, test } from "@playwright/test";
import { installDeniedCamera } from "./support/browser-fixtures.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "content-type,x-request-id",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

/** URLs are paths here; `mockFeed` roots them at whichever origin the app calls. */
const feedItem = (id, userName) => ({
  id,
  user_name: userName,
  caught_at: "2026-02-20T12:44:14+00:00",
  colors: ["#ffc800", "#112233", "#aa3355"],
  square_url: `/catch/square/${id}`,
  polaroid_url: `/catch/polaroid/${id}`,
  url: `/c/${id}`,
});

const URL_FIELDS = ["square_url", "polaroid_url", "url"];

function rootUrls(body, origin) {
  if (!Array.isArray(body.items)) return body;
  return {
    ...body,
    items: body.items.map((item) => ({
      ...item,
      ...Object.fromEntries(URL_FIELDS.map((field) => [field, `${origin}${item[field]}`])),
    })),
  };
}

/**
 * Mocks the public feed, on whichever origin the app is configured to call
 * (COMMUNITY_API_PROXY_TARGET in .env points it at a local ccs). `pages` maps a cursor ("" for the first page) to a
 * response; a function entry decides per call (to simulate failures).
 */
async function mockFeed(page, pages) {
  const requests = [];
  await page.route(
    (url) => url.pathname === "/api/v1/catches",
    async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      const after = new URL(route.request().url()).searchParams.get("after") ?? "";
      requests.push(after);
      const entry = pages[after];
      const response = typeof entry === "function" ? entry(requests.length) : entry;
      await route.fulfill({
        status: response.status ?? 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify(rootUrls(response.body ?? {}, new URL(route.request().url()).origin)),
      });
    },
  );
  // The pages ship COEP: require-corp, so remote pictures need a CORP header.
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
  return requests;
}

async function openCommunity(page) {
  await page.goto("/");
  const button = page.locator(".btn-community-feed");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator("shared-panel.community-panel.visible")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installDeniedCamera(page);
});

test("the community button opens a gallery that pages in older catches", async ({ page }) => {
  const requests = await mockFeed(page, {
    "": {
      body: { items: [feedItem("A1", "nuagelait"), feedItem("A2", "ciel")], next_cursor: "A2" },
    },
    A2: { body: { items: [feedItem("A3", "brume")], next_cursor: null } },
  });

  await openCommunity(page);
  // The cards open large, so the end of the list can be a scroll away: older
  // catches come in as the reader gets there.
  await expect(page.locator("#communityGrid .palette-card").first()).toBeVisible();
  await expect
    .poll(async () => {
      await page.locator("#communityGrid").evaluate((grid) => {
        grid.closest(".collection-panel-body").scrollTo({ top: 1e6 });
      });
      return page.locator("#communityGrid .palette-card").count();
    })
    .toBe(3);
  expect(requests).toEqual(["", "A2"]);
  await expect(page.locator("#communityStatus")).toBeHidden();
});

test("the gallery slides in from the left, the collection from the right", async ({ page }) => {
  await mockFeed(page, {
    "": { body: { items: [feedItem("A1", "nuagelait")], next_cursor: null } },
  });
  await page.goto("/");

  const slideFrom = (name) =>
    page.evaluate((panelName) => {
      const panel = document.querySelector(`shared-panel[data-panel-name="${panelName}"]`);
      return getComputedStyle(panel).getPropertyValue("--panel-slide-from").trim() || "100%";
    }, name);

  expect(await slideFrom("community")).toBe("-100%");
  expect(await slideFrom("collection")).toBe("100%");
});

test("a tapped catch opens in the collection's viewer, read-only, with its author", async ({
  page,
}) => {
  await mockFeed(page, {
    "": {
      body: { items: [feedItem("A1", "nuagelait"), feedItem("A2", "ciel")], next_cursor: null },
    },
  });

  await openCommunity(page);
  await page.locator('.palette-card[data-palette-id="A1"] .palette-card-trigger').click();

  await expect(page.locator("shared-panel.catch-details-panel.visible")).toBeVisible();
  await expect(page.locator("#catchDetailsMetaDate")).toContainText("nuagelait");
  // The author's name leads to their page on the site.
  const author = page.locator("#catchDetailsMetaDate a.palette-viewer-meta-author");
  await expect(author).toHaveText("nuagelait");
  await expect(author).toHaveAttribute("href", /^https?:\/\/[^/]+\/u\/nuagelait\?ref=/);
  await expect(author).toHaveAttribute("target", "_blank");
  await expect(author).toHaveAttribute("rel", /noopener/);
  // Someone else's catch: it turns over, but there is nothing to delete, share or publish.
  await expect(page.locator("#catchDetailsFlipButton")).toBeVisible();
  await expect(page.locator("#catchDetailsDeleteButton")).toBeHidden();
  await expect(page.locator("#catchDetailsShareButton")).toBeHidden();
  await expect(page.locator("#catchDetailsPublishButton")).toBeHidden();
  // The star is "collect" here, and it needs an account: it stays on offer.
  await expect(page.locator("#catchDetailsFavoriteButton")).toBeVisible();
  await expect(page.locator("#catchDetailsMetaPosition")).toBeHidden();
  await expect(page.locator("#catchDetailsTrack img[src*='/catch/polaroid/A1']")).toHaveCount(1);
});

test("the viewer walks on to the next catch and flips to the colors", async ({ page }) => {
  await mockFeed(page, {
    "": {
      body: { items: [feedItem("A1", "nuagelait"), feedItem("A2", "ciel")], next_cursor: null },
    },
  });

  await openCommunity(page);
  await page.locator('.palette-card[data-palette-id="A1"] .palette-card-trigger').click();
  await expect(page.locator("#catchDetailsTrack img[src*='/catch/polaroid/A2']")).toHaveCount(1);

  await page.locator("#catchDetailsFlipButton").click();
  await expect(page.locator("#catchDetailsFlipButton")).toHaveAttribute("aria-pressed", "true");
});

test("the three views and their zoom work on the community's catches", async ({ page }) => {
  await mockFeed(page, {
    "": {
      body: { items: [feedItem("A1", "nuagelait"), feedItem("A2", "ciel")], next_cursor: null },
    },
  });

  await openCommunity(page);
  const grid = page.locator("#communityGrid");
  await expect(grid).toHaveAttribute("data-view-mode", "grid");

  await page.locator("#communityViewSwatchButton").click();
  await expect(grid).toHaveAttribute("data-view-mode", "swatch");
  await expect(grid.locator(".palette-card--swatch")).toHaveCount(2);

  await page.locator("#communityViewSpectrumButton").click();
  await expect(grid).toHaveAttribute("data-view-mode", "spectrum");
  await expect(grid.locator(".palette-card--chip")).toHaveCount(2);

  await page.locator("#communityViewGridButton").click();
  await page.locator("#communityViewGridButton").click();
  await expect(grid).toHaveAttribute("data-view-mode", "grid");
});

test("the community gallery has its own zoom, starting on the largest cards", async ({ page }) => {
  await mockFeed(page, {
    "": { body: { items: [feedItem("A1", "nuagelait")], next_cursor: null } },
  });

  await openCommunity(page);
  const columns = (selector) =>
    page
      .locator(selector)
      .evaluate((grid) => grid.style.getPropertyValue("--collection-grid-columns"));
  await expect.poll(() => columns("#communityGrid")).toBe("1");

  // Pressing the view already in use steps its zoom: 1 -> 2 -> 3 cards per row.
  await page.locator("#communityViewGridButton").click();
  await page.locator("#communityViewGridButton").click();
  await expect.poll(() => columns("#communityGrid")).toBe("3");

  await page
    .locator("shared-panel.community-panel .close-button")
    .click()
    .catch(() => {});
  await page.evaluate(() => {
    document.querySelector(".btn-view-collection").click();
  });
  await expect(page.locator("shared-panel.collection-panel.visible")).toBeVisible();
  // The collection kept its own default of two per row.
  await expect.poll(() => columns("#collectionGrid")).toBe("2");
});

test("closing and reopening the gallery shows the catches again", async ({ page }) => {
  const requests = await mockFeed(page, {
    "": {
      body: { items: [feedItem("A1", "nuagelait"), feedItem("A2", "ciel")], next_cursor: null },
    },
  });

  await openCommunity(page);
  await expect(page.locator("#communityGrid .palette-card")).toHaveCount(2);

  await page.locator("shared-panel.community-panel .close-button").click();
  await expect(page.locator("shared-panel.community-panel.visible")).toHaveCount(0);
  await page.locator(".btn-community-feed").click();
  await expect(page.locator("shared-panel.community-panel.visible")).toBeVisible();

  await expect(page.locator("#communityGrid .palette-card")).toHaveCount(2);
  await expect(page.locator("#communityGrid .palette-card-image").first()).toBeVisible();
  // Reopening shows what is already loaded; it does not fetch the feed again.
  expect(requests).toEqual([""]);
});

test("a failed first load offers a retry that recovers", async ({ page }) => {
  await mockFeed(page, {
    "": (callCount) =>
      callCount === 1
        ? { status: 503, body: { message: "down" } }
        : { body: { items: [feedItem("A1", "nuagelait")], next_cursor: null } },
  });

  await openCommunity(page);

  await expect(page.locator("#communityStatus")).toBeVisible();
  await expect(page.locator("#communityRetryButton")).toBeVisible();
  await page.locator("#communityRetryButton").click();

  await expect(page.locator("#communityGrid .palette-card")).toHaveCount(1);
  await expect(page.locator("#communityStatus")).toBeHidden();
});

test("an empty community says so", async ({ page }) => {
  await mockFeed(page, { "": { body: { items: [], next_cursor: null } } });

  await openCommunity(page);

  await expect(page.locator("#communityGrid .empty-message")).toHaveText(/aucun catch|no catches/i);
  await expect(page.locator("#communityRetryButton")).toBeHidden();
});

test("the footer keeps the community button left and the last catch beside the gallery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.locator(".btn-community-feed")).toBeEnabled();

  const box = async (selector) => page.locator(selector).boundingBox();
  const community = await box(".btn-community-feed");
  const shutter = await box(".btn-capture");
  const thumbnail = await box(".mini-output");
  const gallery = await box(".btn-view-collection");

  expect(community.x + community.width).toBeLessThan(shutter.x);
  expect(shutter.x + shutter.width).toBeLessThan(thumbnail.x);
  expect(thumbnail.x + thumbnail.width).toBeLessThanOrEqual(gallery.x);
  expect(gallery.x - (thumbnail.x + thumbnail.width)).toBeLessThan(16);
});

test("the last-catch thumbnail stays unseen until there is a catch to show", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.locator(".btn-community-feed")).toBeEnabled();
  const thumbnail = page.locator(".mini-output");

  await expect(thumbnail).toHaveCSS("opacity", "0");
  // Hidden, not removed: the caught palette still needs its box to fly to.
  expect((await thumbnail.boundingBox()).width).toBeGreaterThan(0);

  await page.locator("#photo").evaluate((image) => {
    image.hidden = false;
  });
  await expect(thumbnail).toHaveCSS("opacity", "1");
});
