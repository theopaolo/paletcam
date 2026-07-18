import { expect, test } from "@playwright/test";
import {
  RUNTIME_PERFORMANCE_BUDGETS,
  RUNTIME_PERFORMANCE_PROFILE,
} from "../../scripts/performance-budgets.js";
import {
  clearPalettes,
  installDeniedCamera,
  installSyntheticCamera,
} from "../e2e/support/browser-fixtures.js";

const HIGH_CARDINALITY_BACKUP_PALETTE_COUNT = 1_000;
const SYNTHETIC_ONE_PIXEL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function createHighCardinalityBackupBuffer() {
  const palettes = Array.from({ length: HIGH_CARDINALITY_BACKUP_PALETTE_COUNT }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    colors: [
      { r: index % 256, g: (index * 3) % 256, b: (index * 7) % 256 },
      { r: (index * 11) % 256, g: (index * 13) % 256, b: (index * 17) % 256 },
    ],
    captureAspectRatio: "4:3",
    captureCropRect: null,
    polaroidRenderSettings: { footerLabel: `Synthetic ${index + 1}` },
    photoBlob: SYNTHETIC_ONE_PIXEL_PNG_DATA_URL,
  }));

  return Buffer.from(JSON.stringify({ version: 2, palettes }));
}

test.beforeEach(async ({ context }) => {
  await context.route("https://colorcatchers.co/api/v1/**", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await context.route("**/clientlog", (route) => route.abort("blockedbyclient"));
});

async function applySyntheticMobileProfile(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: RUNTIME_PERFORMANCE_PROFILE.cpuSlowdownRate,
  });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: RUNTIME_PERFORMANCE_PROFILE.latencyMs,
    downloadThroughput: RUNTIME_PERFORMANCE_PROFILE.downloadBytesPerSecond,
    uploadThroughput: RUNTIME_PERFORMANCE_PROFILE.uploadBytesPerSecond,
  });
}

async function readPaletteAssetCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["palettes", "paletteAssets"], "readonly");
      const count = (storeName) =>
        new Promise((resolve, reject) => {
          const countRequest = transaction.objectStore(storeName).count();
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        });
      const [palettes, paletteAssets] = await Promise.all([
        count("palettes"),
        count("paletteAssets"),
      ]);
      return { palettes, paletteAssets };
    } finally {
      database.close();
    }
  });
}

async function readImportStorageCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = ["palettes", "paletteAssets", "paletteImportStaging"];
      const transaction = database.transaction(stores, "readonly");
      const count = (storeName) =>
        new Promise((resolve, reject) => {
          const countRequest = transaction.objectStore(storeName).count();
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        });
      const [palettes, paletteAssets, paletteImportStaging] = await Promise.all(stores.map(count));
      return { palettes, paletteAssets, paletteImportStaging };
    } finally {
      database.close();
    }
  });
}

async function installAnimationFrameSampler(page) {
  await page.addInitScript(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const state = { recording: false, timestamps: [] };
    Object.defineProperty(window, "__performanceRafState", { value: state });
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((timestamp) => {
        if (state.recording && state.timestamps.length < 240) {
          state.timestamps.push(timestamp);
        }
        callback(timestamp);
      });
  });
}

test("cold mobile production startup stays within synthetic budgets", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.__paletcamLongTasks = [];
    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          window.__paletcamLongTasks.push(...list.getEntries().map((entry) => entry.duration));
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch (_error) {
        // Web performance entry support varies; absence is recorded as no samples.
      }
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          throw new DOMException("Denied by performance profile", "NotAllowedError");
        },
      },
    });
  });
  await applySyntheticMobileProfile(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".btn-capture")).toBeEnabled();
  const appReadyMs = await page.evaluate(() => performance.now());
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts?.ready);

  const metrics = await page.evaluate((readyMs) => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const longTasks = window.__paletcamLongTasks ?? [];
    const sumDecodedBytes = (suffix) =>
      resources
        .filter((entry) => new URL(entry.name).pathname.endsWith(suffix))
        .reduce((total, entry) => total + (entry.decodedBodySize || 0), 0);

    return {
      appReadyMs: readyMs,
      cssDecodedBytes: sumDecodedBytes(".css"),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
      fontDecodedBytes: sumDecodedBytes(".woff2"),
      jsDecodedBytes: sumDecodedBytes(".js"),
      loadMs: navigation?.loadEventEnd ?? 0,
      longTaskCount: longTasks.length,
      maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
      totalLongTaskMs: longTasks.reduce((total, duration) => total + duration, 0),
    };
  }, appReadyMs);

  const extractionMetrics = await page.evaluate(async () => {
    const width = 320;
    const height = 240;
    const durations = [];
    const worker = new Worker("/workers/palette-extraction.worker.js", { type: "module" });

    try {
      for (let requestId = 1; requestId <= 7; requestId += 1) {
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const pixel = offset / 4;
          pixels[offset] = pixel % 256;
          pixels[offset + 1] = Math.floor(pixel / width) % 256;
          pixels[offset + 2] = (pixel * 17) % 256;
          pixels[offset + 3] = 255;
        }

        const result = await new Promise((resolve, reject) => {
          const handleMessage = (event) => {
            if (event.data?.requestId !== requestId) return;
            worker.removeEventListener("message", handleMessage);
            if (event.data.type === "palette-extraction-error") {
              reject(new Error(event.data.message));
            } else {
              resolve(event.data);
            }
          };
          worker.addEventListener("message", handleMessage);
          worker.postMessage(
            {
              type: "extract-palette",
              requestId,
              generation: 0,
              width,
              height,
              swatchCount: 4,
              options: undefined,
              frozenColors: [],
              buffer: pixels.buffer,
            },
            [pixels.buffer],
          );
        });
        if (requestId > 1) durations.push(result.durationMs);
      }
    } finally {
      worker.terminate();
    }

    durations.sort((left, right) => left - right);
    return {
      extractionP50Ms: durations[Math.floor(durations.length * 0.5)],
      extractionP95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    };
  });

  await page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("palettes", "readwrite");
    const store = transaction.objectStore("palettes");
    for (let index = 1; index <= 250; index += 1) {
      store.put({
        id: 20_000 + index,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        colors: [
          { r: index % 256, g: (index * 3) % 256, b: (index * 7) % 256 },
          { r: (index * 11) % 256, g: (index * 13) % 256, b: (index * 17) % 256 },
        ],
        captureAspectRatio: "4:3",
        captureCropRect: null,
        polaroidRenderSettings: { footerLabel: "Performance fixture" },
        remoteCatchId: null,
        moderationStatus: null,
        hasPhotoAsset: false,
      });
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  const collectionStartedAt = await page.evaluate(() => performance.now());
  await page.locator(".btn-view-collection").click();
  await expect(page.locator(".palette-card").first()).toBeVisible();
  const collection250InitialRenderMs = await page.evaluate(
    (startedAt) => performance.now() - startedAt,
    collectionStartedAt,
  );
  await expect(page.locator(".palette-card")).toHaveCount(250);
  const collection250HydrationMs = await page.evaluate(
    (startedAt) => performance.now() - startedAt,
    collectionStartedAt,
  );

  Object.assign(metrics, extractionMetrics, {
    collection250HydrationMs,
    collection250InitialRenderMs,
  });

  await testInfo.attach("performance-baseline.json", {
    body: Buffer.from(
      `${JSON.stringify({ metrics, profile: RUNTIME_PERFORMANCE_PROFILE }, null, 2)}\n`,
    ),
    contentType: "application/json",
  });

  expect(metrics.appReadyMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.appReadyMs);
  expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.domContentLoadedMs,
  );
  expect(metrics.loadMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.loadMs);
  expect(metrics.extractionP95Ms).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.extractionP95Ms);
  expect(metrics.collection250InitialRenderMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.collection250InitialRenderMs,
  );
  expect(metrics.collection250HydrationMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.collection250HydrationMs,
  );
  expect(metrics.maxLongTaskMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.maxLongTaskMs);
  expect(metrics.totalLongTaskMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.totalLongTaskMs);

  console.log(`Synthetic mobile performance: ${JSON.stringify(metrics)}`);
});

test("critical capture, viewer, and backup journeys record synthetic timings", async ({
  context,
  page: capturePage,
}, testInfo) => {
  await installAnimationFrameSampler(capturePage);
  await installSyntheticCamera(capturePage);
  await applySyntheticMobileProfile(capturePage);
  await capturePage.goto("/");
  await expect
    .poll(() => capturePage.evaluate(() => window.__syntheticCameraTestState?.requests.length ?? 0))
    .toBeGreaterThan(0);
  await expect(capturePage.locator(".btn-capture")).toBeEnabled();
  const cameraReadyMs = await capturePage.evaluate(() => performance.now());
  await capturePage.evaluate(() => {
    window.__performanceRafState.timestamps = [];
    window.__performanceRafState.recording = true;
  });
  await expect
    .poll(() => capturePage.evaluate(() => window.__performanceRafState?.timestamps.length ?? 0))
    .toBeGreaterThanOrEqual(30);
  const previewFrameIntervalP95Ms = await capturePage.evaluate(() => {
    const state = window.__performanceRafState;
    state.recording = false;
    const intervals = state.timestamps
      .slice(1)
      .map((timestamp, index) => timestamp - state.timestamps[index])
      .sort((left, right) => left - right);
    return intervals[Math.ceil(intervals.length * 0.95) - 1];
  });

  const captureStartedAt = await capturePage.evaluate(() => performance.now());
  await capturePage.locator(".btn-capture").click();
  await expect
    .poll(() => readPaletteAssetCount(capturePage))
    .toEqual({
      palettes: 1,
      paletteAssets: 1,
    });
  await expect(capturePage.locator("#photo")).toHaveAttribute("data-palette-id", /\d+/);
  const captureToSaveMs = await capturePage.evaluate(
    (startedAt) => performance.now() - startedAt,
    captureStartedAt,
  );

  const journeyPage = await context.newPage();
  await installDeniedCamera(journeyPage);
  await applySyntheticMobileProfile(journeyPage);
  await journeyPage.goto("/");
  await expect(journeyPage.locator(".btn-view-collection")).toBeEnabled();
  await journeyPage.locator(".btn-view-collection").click();
  await expect(journeyPage.locator(".palette-card")).toHaveCount(1);

  const viewerStartedAt = await journeyPage.evaluate(() => performance.now());
  await journeyPage.locator(".palette-card").click();
  await expect(journeyPage.locator("shared-panel.catch-details-panel")).toHaveClass(/visible/);
  await expect(journeyPage.locator(".palette-viewer-slide")).toHaveCount(1);
  await expect(journeyPage.locator(".palette-viewer-image")).toHaveAttribute(
    "src",
    /^(blob:|data:image\/)/,
  );
  const viewerOpenMs = await journeyPage.evaluate(
    (startedAt) => performance.now() - startedAt,
    viewerStartedAt,
  );
  await journeyPage.locator("#catchDetailsCameraButton").click();
  await expect(journeyPage.locator("shared-panel.catch-details-panel")).toBeHidden();

  await journeyPage.locator(".btn-open-settings").click();
  await journeyPage.locator("#settingsTabData").click();
  const backupRoundTripStartedAt = await journeyPage.evaluate(() => performance.now());
  const backupExportStartedAt = backupRoundTripStartedAt;
  const downloadPromise = journeyPage.waitForEvent("download");
  await journeyPage.locator("#settingsExportButton").click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  const backupExportMs = await journeyPage.evaluate(
    (startedAt) => performance.now() - startedAt,
    backupExportStartedAt,
  );

  await clearPalettes(journeyPage);
  await expect
    .poll(() => readPaletteAssetCount(journeyPage))
    .toEqual({
      palettes: 0,
      paletteAssets: 0,
    });
  const backupImportStartedAt = await journeyPage.evaluate(() => performance.now());
  await journeyPage.locator("#settingsImportInput").setInputFiles(backupPath);
  await expect
    .poll(() => readPaletteAssetCount(journeyPage))
    .toEqual({
      palettes: 1,
      paletteAssets: 1,
    });
  await expect(journeyPage.locator("#settingsImportInput")).toBeEnabled();
  await expect(journeyPage.locator("#settingsDataStatus")).not.toHaveClass(/is-error/);
  const backupImportMs = await journeyPage.evaluate(
    (startedAt) => performance.now() - startedAt,
    backupImportStartedAt,
  );
  const backupRoundTripMs = await journeyPage.evaluate(
    (startedAt) => performance.now() - startedAt,
    backupRoundTripStartedAt,
  );

  await clearPalettes(journeyPage);
  await expect
    .poll(() => readImportStorageCount(journeyPage))
    .toEqual({
      palettes: 0,
      paletteAssets: 0,
      paletteImportStaging: 0,
    });

  const highCardinalityBackup = createHighCardinalityBackupBuffer();
  const highCardinalityBackupBytes = highCardinalityBackup.byteLength;
  await journeyPage.evaluate(() => {
    const intervalMs = 10;
    const state = {
      intervalId: 0,
      lastTickMs: performance.now(),
      maxGapMs: 0,
      ticks: 0,
    };
    state.intervalId = window.setInterval(() => {
      const now = performance.now();
      state.maxGapMs = Math.max(state.maxGapMs, now - state.lastTickMs);
      state.lastTickMs = now;
      state.ticks += 1;
    }, intervalMs);
    window.__highCardinalityImportResponsiveness = state;
  });
  const highCardinalityImportStartedAt = await journeyPage.evaluate(() => performance.now());
  await journeyPage.locator("#settingsImportInput").setInputFiles({
    name: "synthetic-high-cardinality-backup.json",
    mimeType: "application/json",
    buffer: highCardinalityBackup,
  });
  await expect
    .poll(() => readImportStorageCount(journeyPage), { timeout: 30_000 })
    .toEqual({
      palettes: HIGH_CARDINALITY_BACKUP_PALETTE_COUNT,
      paletteAssets: HIGH_CARDINALITY_BACKUP_PALETTE_COUNT,
      paletteImportStaging: 0,
    });
  await expect(journeyPage.locator("#settingsImportInput")).toBeEnabled();
  await expect(journeyPage.locator("#settingsDataStatus")).not.toHaveClass(/is-error/);
  const highCardinalityMetrics = await journeyPage.evaluate((startedAt) => {
    const state = window.__highCardinalityImportResponsiveness;
    window.clearInterval(state.intervalId);
    return {
      backupHighCardinalityImportMs: performance.now() - startedAt,
      backupHighCardinalityMaxEventLoopGapMs: state.maxGapMs,
      backupHighCardinalityResponsivenessTicks: state.ticks,
    };
  }, highCardinalityImportStartedAt);

  const metrics = {
    backupExportMs,
    backupImportMs,
    backupRoundTripMs,
    cameraReadyMs,
    captureToSaveMs,
    previewFrameIntervalP95Ms,
    viewerOpenMs,
    ...highCardinalityMetrics,
    backupHighCardinalityBytes: highCardinalityBackupBytes,
    backupHighCardinalityPaletteCount: HIGH_CARDINALITY_BACKUP_PALETTE_COUNT,
  };
  for (const value of Object.values(metrics)) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  }
  expect(metrics.captureToSaveMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.captureToSaveMs);
  expect(metrics.cameraReadyMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.cameraReadyMs);
  expect(metrics.previewFrameIntervalP95Ms).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.previewFrameIntervalP95Ms,
  );
  expect(metrics.viewerOpenMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.viewerOpenMs);
  expect(metrics.backupExportMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.backupExportMs);
  expect(metrics.backupImportMs).toBeLessThanOrEqual(RUNTIME_PERFORMANCE_BUDGETS.backupImportMs);
  expect(metrics.backupRoundTripMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.backupRoundTripMs,
  );
  expect(metrics.backupHighCardinalityImportMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.backupHighCardinalityImportMs,
  );
  expect(metrics.backupHighCardinalityMaxEventLoopGapMs).toBeLessThanOrEqual(
    RUNTIME_PERFORMANCE_BUDGETS.backupHighCardinalityMaxEventLoopGapMs,
  );
  expect(metrics.backupHighCardinalityResponsivenessTicks).toBeGreaterThan(0);

  await testInfo.attach("critical-journey-performance.json", {
    body: Buffer.from(
      `${JSON.stringify({ metrics, profile: RUNTIME_PERFORMANCE_PROFILE }, null, 2)}\n`,
    ),
    contentType: "application/json",
  });
  console.log(`Synthetic critical-journey performance: ${JSON.stringify(metrics)}`);
});

test.describe("service-worker performance", () => {
  test.use({ serviceWorkers: "allow" });

  test("initial install and immutable update record synthetic timings", async ({
    page,
    request,
  }, testInfo) => {
    await request.get("/__e2e/artifact-revision?value=");
    await installDeniedCamera(page);
    await applySyntheticMobileProfile(page);
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const serviceWorkerInitialControlMs = await page.evaluate(() => performance.now());
    const artifactA = await request.get("/build-manifest.json").then((response) => response.json());
    const revision = `performance-${Date.now()}`;
    const artifactB = await request
      .get(`/__e2e/artifact-revision?value=${revision}`)
      .then((response) => response.json());
    expect(artifactB.buildId).not.toBe(artifactA.buildId);

    try {
      const updateStartedAt = await page.evaluate(() => performance.now());
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
      const serviceWorkerUpdateInstallMs = await page.evaluate(
        (startedAt) => performance.now() - startedAt,
        updateStartedAt,
      );

      const activationStartedAt = await page.evaluate(() => performance.now());
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
      });
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const paletcamCaches = (await caches.keys()).filter((name) =>
              name.startsWith("colorcatcher-"),
            );
            return {
              controlled: Boolean(navigator.serviceWorker.controller),
              waiting: Boolean(registration?.waiting),
              caches: paletcamCaches,
            };
          }),
        )
        .toEqual({
          controlled: true,
          waiting: false,
          caches: [`colorcatcher-${artifactB.buildId}`],
        });
      const serviceWorkerUpdateActivationMs = await page.evaluate(
        (startedAt) => performance.now() - startedAt,
        activationStartedAt,
      );

      const metrics = {
        serviceWorkerInitialControlMs,
        serviceWorkerUpdateActivationMs,
        serviceWorkerUpdateInstallMs,
      };
      for (const value of Object.values(metrics)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
      expect(metrics.serviceWorkerInitialControlMs).toBeLessThanOrEqual(
        RUNTIME_PERFORMANCE_BUDGETS.serviceWorkerInitialControlMs,
      );
      expect(metrics.serviceWorkerUpdateInstallMs).toBeLessThanOrEqual(
        RUNTIME_PERFORMANCE_BUDGETS.serviceWorkerUpdateInstallMs,
      );
      expect(metrics.serviceWorkerUpdateActivationMs).toBeLessThanOrEqual(
        RUNTIME_PERFORMANCE_BUDGETS.serviceWorkerUpdateActivationMs,
      );

      await testInfo.attach("service-worker-performance.json", {
        body: Buffer.from(
          `${JSON.stringify({ metrics, profile: RUNTIME_PERFORMANCE_PROFILE }, null, 2)}\n`,
        ),
        contentType: "application/json",
      });
      console.log(`Synthetic service-worker performance: ${JSON.stringify(metrics)}`);
    } finally {
      await request.get("/__e2e/artifact-revision?value=");
    }
  });
});
