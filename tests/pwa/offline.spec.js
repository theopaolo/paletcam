import { expect, test } from "@playwright/test";
import { installSyntheticCamera } from "../e2e/support/browser-fixtures.js";

test.beforeEach(async ({ context }) => {
  await context.route("**/clientlog", (route) => route.abort("blockedbyclient"));
});

async function installDeferredCanvasExport(page) {
  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    const pendingExports = [];
    const state = {
      callCount: 0,
      pendingCount: 0,
      releaseAll() {
        const exportsToRelease = pendingExports.splice(0);
        exportsToRelease.forEach((release) => {
          release();
        });
      },
    };
    Object.defineProperty(window, "__deferredCanvasExportTestState", { value: state });

    HTMLCanvasElement.prototype.toBlob = function deferredToBlob(callback, ...args) {
      state.callCount += 1;
      state.pendingCount += 1;
      pendingExports.push(() => {
        state.pendingCount -= 1;
        nativeToBlob.call(this, callback, ...args);
      });
    };
  });
}

async function waitForControlledServiceWorker(page) {
  await expect
    .poll(async () => {
      try {
        return await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
      } catch (_error) {
        return false;
      }
    })
    .toBe(true);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(250);
}

test("installs a bounded app shell without debug resources and reloads offline", async ({
  context,
  page,
  request,
}) => {
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  const cacheState = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const urls = (
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          return (await cache.keys()).map((request) => new URL(request.url).pathname);
        }),
      )
    ).flat();
    return { cacheNames, urls };
  });

  expect(cacheState.cacheNames).toHaveLength(1);
  expect(cacheState.cacheNames[0]).toMatch(/^colorcatcher-/);
  expect(cacheState.urls).toContain("/index.html");
  expect(cacheState.urls).toContain("/offline.html");
  expect(cacheState.urls.some((path) => path.startsWith("/assets/img/"))).toBe(false);
  expect(cacheState.urls.some((path) => path.startsWith("/__"))).toBe(false);
  expect(cacheState.urls.some((path) => path.includes("debug-extraction"))).toBe(false);
  expect(cacheState.urls).not.toContain("/components.html");

  const precacheManifest = await (await request.get("/precache-manifest.json")).json();
  const requiredCodeAndStyles = precacheManifest.filter(
    (url) => url.endsWith(".js") || url.endsWith(".css"),
  );
  expect(requiredCodeAndStyles.length).toBeGreaterThan(0);
  expect(requiredCodeAndStyles.every((url) => cacheState.urls.includes(url))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Color Catchers/);
  await expect(page.locator(".btn-capture")).toBeVisible();
  await page.locator(".btn-view-collection").click();
  await expect(page.locator("shared-panel.collection-panel")).toHaveClass(/visible/);
  await expect(page.locator(".collection-empty")).toBeVisible();
  await context.setOffline(false);
});

test("activation removes only older Paletcam caches", async ({ page }) => {
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  await page.evaluate(async () => {
    const staleCache = await caches.open("colorcatcher-stale-e2e");
    await staleCache.put("/stale.txt", new Response("stale"));
    const unrelatedCache = await caches.open("unrelated-site-cache-e2e");
    await unrelatedCache.put("/unrelated.txt", new Response("preserve me"));
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  });

  await page.reload();
  await waitForControlledServiceWorker(page);

  await expect
    .poll(() =>
      page.evaluate(async () => ({
        staleRemoved: !(await caches.keys()).includes("colorcatcher-stale-e2e"),
        unrelatedPreserved: (await caches.keys()).includes("unrelated-site-cache-e2e"),
      })),
    )
    .toEqual({ staleRemoved: true, unrelatedPreserved: true });

  await page.evaluate(() => caches.delete("unrelated-site-cache-e2e"));
});

test("does not runtime-cache same-origin resources outside the manifest", async ({ page }) => {
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  const responseStatus = await page.evaluate(async () => {
    const response = await fetch("/uncatalogued-resource.txt");
    return response.status;
  });
  expect(responseStatus).toBe(200);

  expect(
    await page.evaluate(async () => Boolean(await caches.match("/uncatalogued-resource.txt"))),
  ).toBe(false);
});

test("does not cache query-bearing variants of allowlisted resources", async ({ page }) => {
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  expect(
    await page.evaluate(async () => {
      const urls = ["/app.js?cache-variant=1", "/app.js?cache-variant=2"];
      const statuses = await Promise.all(urls.map(async (url) => (await fetch(url)).status));
      const cacheNames = await caches.keys();
      const cachedUrls = (
        await Promise.all(
          cacheNames.map(async (cacheName) => {
            const cache = await caches.open(cacheName);
            return (await cache.keys()).map((request) => request.url);
          }),
        )
      ).flat();
      return {
        statuses,
        cachedVariants: cachedUrls.filter((url) => new URL(url).searchParams.has("cache-variant")),
      };
    }),
  ).toEqual({ statuses: [200, 200], cachedVariants: [] });
});

test("keeps direct document navigations from poisoning the cached app shell", async ({ page }) => {
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  const indexBefore = await page.evaluate(() =>
    caches.match("/index.html").then((response) => response?.text()),
  );
  expect(indexBefore).toContain("Color Catchers");
  expect(indexBefore).not.toContain("Vous êtes hors ligne");

  await page.goto("/offline.html");
  await expect(page).toHaveTitle(/Hors ligne|Offline/i);
  await expect(page.locator("h1")).toContainText(/hors ligne|offline/i);

  const cachedDocuments = await page.evaluate(async () => ({
    index: await caches.match("/index.html").then((response) => response?.text()),
    offline: await caches.match("/offline.html").then((response) => response?.text()),
  }));
  expect(cachedDocuments.index).toBe(indexBefore);
  expect(cachedDocuments.offline).toContain("Vous êtes hors ligne");

  await page.goto("/");
  await expect(page).toHaveTitle(/Color Catchers/);
  await expect(page.locator(".btn-capture")).toBeVisible();
});

test("preprod debug pages and image corpus remain network-only", async ({ page }) => {
  test.skip(!process.env.PWA_EXPECT_DEBUG_ASSETS, "preprod-only cache boundary");

  await page.goto("/");
  await waitForControlledServiceWorker(page);

  const corpusManifest = await page.evaluate(async () => {
    const response = await fetch("/debug/image-corpus-manifest.json", { cache: "reload" });
    return { status: response.status, body: await response.json() };
  });
  expect(corpusManifest.status).toBe(200);
  expect(corpusManifest.body.totals.files).toBe(216);
  expect(corpusManifest.body.files).toHaveLength(216);

  const sampleIndexes = [0, Math.floor(corpusManifest.body.files.length / 2), -1];
  const imageSamples = sampleIndexes.map((index) => {
    const file = index < 0 ? corpusManifest.body.files.at(index) : corpusManifest.body.files[index];
    return `/${file.path}`;
  });
  const debugUrls = [
    "/components.html",
    "/debug-extraction.html",
    "/debug/performance-hud.js",
    "/debug/image-corpus-manifest.json",
    ...imageSamples,
  ];
  expect(
    await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(async (url) => ({
            url,
            status: (await fetch(url, { cache: "reload" })).status,
          })),
        ),
      debugUrls,
    ),
  ).toEqual(debugUrls.map((url) => ({ url, status: 200 })));

  expect(
    await page.evaluate(
      async (urls) => Promise.all(urls.map(async (url) => Boolean(await caches.match(url)))),
      debugUrls,
    ),
  ).toEqual(debugUrls.map(() => false));

  const moduleErrors = [];
  page.on("pageerror", (error) => moduleErrors.push(error.message));

  await page.goto("/components.html");
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await expect(page.locator("toast-host .toast")).toContainText(
    "This is a standard toast notification",
  );

  await page.goto("/__verso-preview.html");
  await expect(page.locator(".verso-slot")).toHaveCount(3);
  await expect(page.locator(".export-slot img")).toHaveCount(2);
  expect(moduleErrors).toEqual([]);
});

test("does not activate or retain a partial cache when required app code fails", async ({
  page,
  request,
}) => {
  await request.get("/__e2e/fail-required-shell?enabled=1");
  try {
    await page.goto("/");

    await expect
      .poll(async () => {
        const response = await request.get("/__e2e/status");
        return (await response.json()).requiredShellFailureCount;
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return {
            controlled: Boolean(navigator.serviceWorker.controller),
            active: Boolean(registration?.active),
            installing: Boolean(registration?.installing),
            waiting: Boolean(registration?.waiting),
          };
        }),
      )
      .toEqual({
        controlled: false,
        active: false,
        installing: false,
        waiting: false,
      });

    const cachedShell = await page.evaluate(async () => {
      const matches = await Promise.all([
        caches.match("/index.html"),
        caches.match("/offline.html"),
      ]);
      return matches.every(Boolean);
    });
    expect(cachedShell).toBe(false);
  } finally {
    await request.get("/__e2e/fail-required-shell?enabled=0");
  }
});

test("still activates when an optional precache asset fails", async ({ page, request }) => {
  await request.get("/__e2e/fail-optional-asset?enabled=1");
  try {
    await page.goto("/");
    await waitForControlledServiceWorker(page);

    expect(
      await page.evaluate(async () => ({
        index: Boolean(await caches.match("/index.html")),
        offline: Boolean(await caches.match("/offline.html")),
        failedOptionalAsset: Boolean(await caches.match("/logo/colorcatchers.svg")),
      })),
    ).toEqual({ index: true, offline: true, failedOptionalAsset: false });
  } finally {
    await request.get("/__e2e/fail-optional-asset?enabled=0");
  }
});

test("keeps an updated worker waiting until the user accepts activation", async ({
  page,
  request,
}) => {
  await request.get("/__e2e/artifact-revision?value=");
  await page.goto("/");
  await waitForControlledServiceWorker(page);

  const artifactA = await page.evaluate(async () => {
    const cacheNames = (await caches.keys()).filter((name) => name.startsWith("colorcatcher-"));
    const buildManifest = await fetch("/build-manifest.json", { cache: "no-store" }).then(
      (response) => response.json(),
    );
    const cache = await caches.open(cacheNames[0]);
    const appSource = await cache.match("/app.js").then((response) => response?.text());
    return { appSource, buildId: buildManifest.buildId, cacheNames };
  });
  expect(artifactA.cacheNames).toEqual([`colorcatcher-${artifactA.buildId}`]);
  expect(artifactA.appSource).not.toContain("e2e-artifact:");

  const revision = `update-${Date.now()}`;
  const artifactB = await request
    .get(`/__e2e/artifact-revision?value=${revision}`)
    .then((response) => response.json());
  expect(artifactB).toMatchObject({
    enabled: true,
    baseBuildId: artifactA.buildId,
    marker: `e2e-artifact:${revision}`,
  });
  expect(artifactB.buildId).not.toBe(artifactA.buildId);

  try {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return {
            controlledByActive: navigator.serviceWorker.controller === registration?.active,
            waiting: registration?.waiting?.state ?? "",
          };
        }),
      )
      .toEqual({ controlledByActive: true, waiting: "installed" });

    expect(
      await page.evaluate(
        async ({ artifactACache, artifactBCache, marker }) => {
          const cacheNames = await caches.keys();
          const artifactAApp = await caches
            .open(artifactACache)
            .then((cache) => cache.match("/app.js"))
            .then((response) => response?.text());
          const artifactBApp = await caches
            .open(artifactBCache)
            .then((cache) => cache.match("/app.js"))
            .then((response) => response?.text());
          return {
            artifactAPreserved: cacheNames.includes(artifactACache),
            artifactAHasMarker: artifactAApp?.includes(marker) ?? false,
            artifactBInstalled: cacheNames.includes(artifactBCache),
            artifactBHasMarker: artifactBApp?.includes(marker) ?? false,
          };
        },
        {
          artifactACache: `colorcatcher-${artifactA.buildId}`,
          artifactBCache: `colorcatcher-${artifactB.buildId}`,
          marker: artifactB.marker,
        },
      ),
    ).toEqual({
      artifactAPreserved: true,
      artifactAHasMarker: false,
      artifactBInstalled: true,
      artifactBHasMarker: true,
    });

    // Waiting is intentional: artifact B must not interrupt active artifact A
    // without the user's explicit update action.
    await page.waitForTimeout(750);
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting?.state;
      }),
    ).toBe("installed");

    const updateAction = page.locator("toast-host .toast-action", {
      hasText: /update|mettre à jour/i,
    });
    await expect(updateAction).toBeVisible();
    await Promise.all([page.waitForEvent("framenavigated"), updateAction.click()]);
    await waitForControlledServiceWorker(page);

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return Boolean(registration?.active) && !registration?.waiting;
        }),
      )
      .toBe(true);

    expect(
      await page.evaluate(
        async ({ artifactACache, artifactBCache, buildId, marker }) => {
          const cacheNames = await caches.keys();
          const artifactBApp = await caches
            .open(artifactBCache)
            .then((cache) => cache.match("/app.js"))
            .then((response) => response?.text());
          const buildManifest = await fetch("/build-manifest.json", { cache: "no-store" }).then(
            (response) => response.json(),
          );
          const serviceWorkerSource = await fetch("/service-worker.js", {
            cache: "no-store",
          }).then((response) => response.text());
          return {
            activeBuildId: buildManifest.buildId,
            artifactARemoved: !cacheNames.includes(artifactACache),
            artifactBActive: cacheNames.includes(artifactBCache),
            artifactBHasMarker: artifactBApp?.includes(marker) ?? false,
            serviceWorkerHasBuildId: serviceWorkerSource.includes(`colorcatcher-${buildId}`),
          };
        },
        {
          artifactACache: `colorcatcher-${artifactA.buildId}`,
          artifactBCache: `colorcatcher-${artifactB.buildId}`,
          buildId: artifactB.buildId,
          marker: artifactB.marker,
        },
      ),
    ).toEqual({
      activeBuildId: artifactB.buildId,
      artifactARemoved: true,
      artifactBActive: true,
      artifactBHasMarker: true,
      serviceWorkerHasBuildId: true,
    });
  } finally {
    await request.get("/__e2e/artifact-revision?value=");
  }
});

test("defers user-approved activation until an active capture finishes", async ({
  page,
  request,
}) => {
  await installSyntheticCamera(page);
  await installDeferredCanvasExport(page);
  await page.goto("/");
  await waitForControlledServiceWorker(page);
  await expect
    .poll(() => page.evaluate(() => window.__syntheticCameraTestState.playCount))
    .toBeGreaterThan(0);

  const revision = `capture-update-${Date.now()}`;
  await request.get(`/__e2e/service-worker-revision?value=${revision}`);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting?.state ?? "";
      }),
    )
    .toBe("installed");

  const captureButton = page.locator(".btn-capture");
  await expect
    .poll(async () => {
      const pendingCount = await page.evaluate(
        () => window.__deferredCanvasExportTestState.pendingCount,
      );
      if (pendingCount === 0) {
        await captureButton.click();
      }
      return page.evaluate(() => window.__deferredCanvasExportTestState.pendingCount);
    })
    .toBe(1);

  const updateAction = page.locator("toast-host .toast-action", {
    hasText: /update|mettre à jour/i,
  });
  await expect(updateAction).toBeVisible();
  await updateAction.click();

  await expect(page.locator("toast-host")).toContainText(
    /operation finishes|fin de l’opération en cours/i,
  );
  await page.waitForTimeout(750);
  expect(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting?.state;
    }),
  ).toBe("installed");

  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.evaluate(() => window.__deferredCanvasExportTestState.releaseAll()),
  ]);
  await waitForControlledServiceWorker(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active) && !registration?.waiting;
      }),
    )
    .toBe(true);
});
