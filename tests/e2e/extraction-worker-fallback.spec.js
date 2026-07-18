import { expect, test } from "@playwright/test";
import { installDeniedCamera } from "./support/browser-fixtures.js";

const validExtractionRequest = {
  imageData: [0, 0, 0, 255],
  options: {},
  swatchCount: 1,
  width: 1,
  height: 1,
  frozenColors: [],
};

test("real extraction worker ignores stale work and delivers the current result", async ({
  page,
}) => {
  await installDeniedCamera(page);
  await page.goto("/offline.html");

  const result = await page.evaluate(async () => {
    const { createPaletteExtractionWorkerController } = await import(
      "/modules/palette-extraction-worker.js"
    );
    const deliveredResults = [];
    let resolveCurrentResult;
    const currentResult = new Promise((resolve) => {
      resolveCurrentResult = resolve;
    });
    const controller = createPaletteExtractionWorkerController({
      onResult: (workerResult) => {
        deliveredResults.push(workerResult);
        resolveCurrentResult(workerResult);
      },
    });
    const makeSolidFrame = (width, height, [r, g, b]) => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = r;
        pixels[index + 1] = g;
        pixels[index + 2] = b;
        pixels[index + 3] = 255;
      }
      return pixels;
    };

    const staleAccepted = controller.requestExtraction({
      imageData: makeSolidFrame(320, 240, [220, 20, 20]),
      options: {},
      swatchCount: 1,
      width: 320,
      height: 240,
      frozenColors: [],
    });
    controller.invalidate();
    const currentAccepted = controller.requestExtraction({
      imageData: makeSolidFrame(2, 1, [20, 220, 20]),
      options: {},
      swatchCount: 1,
      width: 2,
      height: 1,
      frozenColors: [],
    });

    const workerResult = await Promise.race([
      currentResult,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out waiting for extraction worker result.")),
          5000,
        ),
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.destroy();

    return {
      color: workerResult.colors[0],
      currentAccepted,
      deliveredCount: deliveredResults.length,
      staleAccepted,
    };
  });

  expect(result).toMatchObject({
    currentAccepted: true,
    deliveredCount: 1,
    staleAccepted: true,
  });
  expect(result.color.g).toBeGreaterThan(200);
  expect(result.color.r).toBeLessThan(40);
  expect(result.color.b).toBeLessThan(40);
});

test("worker construction failure disables offloading and leaves the capture shell usable", async ({
  page,
}) => {
  await installDeniedCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class BrokenWorker {
        constructor() {
          throw new Error("worker construction blocked by test");
        }
      },
    });
  });
  await page.goto("/");

  const result = await exerciseWorkerController(page, "construction");
  expect(result).toEqual({ firstAccepted: false, secondAccepted: false, errorCount: 1 });
  await assertUsableCaptureShell(page);
});

test("worker runtime failure disables offloading and leaves the capture shell usable", async ({
  page,
}) => {
  await installDeniedCamera(page);
  await page.addInitScript(() => {
    class CrashingWorker extends EventTarget {
      postMessage() {
        queueMicrotask(() =>
          this.dispatchEvent(new ErrorEvent("error", { message: "worker crashed" })),
        );
      }

      terminate() {}
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CrashingWorker });
  });
  await page.goto("/");

  const result = await exerciseWorkerController(page, "runtime");
  expect(result).toEqual({ firstAccepted: true, secondAccepted: false, errorCount: 1 });
  await assertUsableCaptureShell(page);
});

async function exerciseWorkerController(page, failureMode) {
  return page.evaluate(
    async ({ mode, request }) => {
      const { createPaletteExtractionWorkerController } = await import(
        "/modules/palette-extraction-worker.js"
      );
      let errorCount = 0;
      const controller = createPaletteExtractionWorkerController({
        onError: () => {
          errorCount += 1;
        },
      });
      const makeRequest = () =>
        controller.requestExtraction({
          ...request,
          imageData: new Uint8ClampedArray(request.imageData),
        });
      const firstAccepted = makeRequest();
      if (mode === "runtime") {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const secondAccepted = makeRequest();
      controller.destroy();
      return { firstAccepted, secondAccepted, errorCount };
    },
    { mode: failureMode, request: validExtractionRequest },
  );
}

async function assertUsableCaptureShell(page) {
  await expect(page).toHaveTitle(/Color Catchers/);
  await expect(page.locator(".btn-capture")).toBeVisible();
  await expect(page.locator(".btn-view-collection")).toBeVisible();
  await page.locator(".btn-view-collection").click();
  await expect(page.locator("shared-panel.collection-panel")).toHaveClass(/visible/);
}
