import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  tryBeginExclusiveCriticalOperation,
  isCriticalOperationActive,
  resetCriticalOperationsForTests,
} from "../critical-operation.js";

const appSettingsModuleUrl = new URL("../../app-settings.js", import.meta.url).href;
const cameraUiModuleUrl = new URL("../camera-ui.js", import.meta.url).href;
const captureStatModuleUrl = new URL("../../capture-stat-service.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../error-reporting.js", import.meta.url).href;
const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const photoExportModuleUrl = new URL("./photo-export.js", import.meta.url).href;
const previewPersistenceModuleUrl = new URL(
  "../collection/palette-preview-persistence.js",
  import.meta.url,
).href;
const toastUiModuleUrl = new URL("../toast-ui.js", import.meta.url).href;

let captureControllerModule;
let resolvePhotoExport;
const exportPhotoBlob = mock(
  () =>
    new Promise((resolve) => {
      resolvePhotoExport = resolve;
    }),
);

beforeAll(async () => {
  mock.module(appSettingsModuleUrl, () => ({
    getAppSettings: () => ({ polaroidFooterLabel: "Paletcam" }),
  }));
  mock.module(cameraUiModuleUrl, () => ({
    drawFrameToCanvas: mock(() => {}),
    renderOutputSwatches: mock(() => {}),
  }));
  mock.module(captureStatModuleUrl, () => ({ trackCaptureStatAsync: mock(() => {}) }));
  mock.module(errorReportingModuleUrl, () => ({
    createErrorToastOptions: (_error, options) => options,
    reportAppError: mock(() => {}),
  }));
  mock.module(i18nModuleUrl, () => ({ t: (key) => key }));
  mock.module(paletteStorageModuleUrl, () => ({
    savePalette: mock(async () => ({ id: 42 })),
  }));
  mock.module(photoExportModuleUrl, () => ({ exportPhotoBlob }));
  mock.module(previewPersistenceModuleUrl, () => ({
    scheduleSavedPalettePreviewWarmup: mock(() => {}),
  }));
  mock.module(toastUiModuleUrl, () => ({ showToast: mock(() => {}) }));

  captureControllerModule = await import(`./capture-controller.js?test=${Math.random()}`);
});

afterEach(() => {
  resetCriticalOperationsForTests();
  exportPhotoBlob.mockClear();
  resolvePhotoExport = undefined;
});

describe("capture controller critical-operation ownership", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("keeps service-worker activation deferred until the accepted capture is saved", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { requestAnimationFrame: (callback) => callback(0) },
    });

    const photoOutputController = {
      clearPaletteId: mock(() => {}),
      setBlob: mock(() => {}),
      setPaletteId: mock(() => {}),
    };
    const controller = captureControllerModule.createCaptureController({
      cameraFeed: { videoHeight: 480, videoWidth: 640 },
      frameCanvas: {},
      outputPalette: {},
      cameraController: { getFacingMode: () => "environment" },
      captureMicroInteractions: { triggerCaptureFlash: mock(() => {}) },
      livePreviewController: {
        getCapturePaletteColors: () => [{ r: 1, g: 2, b: 3 }],
        getFrameContext: () => ({}),
        getFrameHeight: () => 480,
        getFrameWidth: () => 640,
      },
      photoOutputController,
      ralPreview: {},
      getCaptureMode: () => "palette",
      getOneMoreColor: () => false,
      getPaletteExtractionOptions: () => ({}),
      getShouldMirrorUserFacingCamera: () => true,
      recordMetric: mock(() => {}),
    });

    const capture = controller.captureCurrentFrame();
    expect(controller.isSavePending()).toBe(true);
    expect(isCriticalOperationActive()).toBe(true);

    await Promise.resolve();
    resolvePhotoExport(new Blob(["photo"], { type: "image/webp" }));
    await capture;

    expect(photoOutputController.setPaletteId).toHaveBeenCalledWith(42);
    expect(controller.isSavePending()).toBe(false);
    expect(isCriticalOperationActive()).toBe(false);
  });

  test("starts the native snapshot before yielding the captured frame", async () => {
    let paintCallback;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        requestAnimationFrame: (callback) => {
          paintCallback = callback;
        },
      },
    });

    const controller = captureControllerModule.createCaptureController({
      cameraFeed: { videoHeight: 1080, videoWidth: 1920 },
      frameCanvas: {},
      outputPalette: {},
      cameraController: { getFacingMode: () => "environment" },
      captureMicroInteractions: { triggerCaptureFlash: mock(() => {}) },
      livePreviewController: {
        getCapturePaletteColors: () => [{ r: 1, g: 2, b: 3 }],
        getFrameContext: () => ({}),
        getFrameHeight: () => 300,
        getFrameWidth: () => 400,
      },
      photoOutputController: {
        clearPaletteId: mock(() => {}),
        setBlob: mock(() => {}),
        setPaletteId: mock(() => {}),
      },
      ralPreview: {},
      getCaptureMode: () => "palette",
      getOneMoreColor: () => false,
      getPaletteExtractionOptions: () => ({}),
      getShouldMirrorUserFacingCamera: () => false,
      recordMetric: mock(() => {}),
    });

    const capture = controller.captureCurrentFrame();

    expect(exportPhotoBlob).toHaveBeenCalledTimes(1);
    expect(exportPhotoBlob.mock.calls[0][0]).toMatchObject({
      cameraFeed: { videoHeight: 1080, videoWidth: 1920 },
      fallbackHeight: 300,
      fallbackWidth: 400,
      sourceRect: null,
    });
    expect(exportPhotoBlob.mock.calls[0][0].preferFallbackCanvas).toBeUndefined();

    resolvePhotoExport(new Blob(["photo"], { type: "image/webp" }));
    paintCallback(0);
    await capture;
  });

  test("does not start capture persistence while local-data reset owns exclusivity", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { requestAnimationFrame: (callback) => callback(0) },
    });

    const controller = captureControllerModule.createCaptureController({
      cameraFeed: { videoHeight: 480, videoWidth: 640 },
      frameCanvas: {},
      outputPalette: {},
      cameraController: { getFacingMode: () => "environment" },
      captureMicroInteractions: { triggerCaptureFlash: mock(() => {}) },
      livePreviewController: {
        getCapturePaletteColors: () => [{ r: 1, g: 2, b: 3 }],
        getFrameContext: () => ({}),
        getFrameHeight: () => 480,
        getFrameWidth: () => 640,
      },
      photoOutputController: {
        clearPaletteId: mock(() => {}),
        setBlob: mock(() => {}),
        setPaletteId: mock(() => {}),
      },
      ralPreview: {},
      getCaptureMode: () => "palette",
      getOneMoreColor: () => false,
      getPaletteExtractionOptions: () => ({}),
      getShouldMirrorUserFacingCamera: () => true,
      recordMetric: mock(() => {}),
    });
    const releaseReset = tryBeginExclusiveCriticalOperation("local-data-flush");

    await controller.captureCurrentFrame();

    expect(exportPhotoBlob).not.toHaveBeenCalled();
    expect(controller.isSavePending()).toBe(false);
    releaseReset();
  });
});
