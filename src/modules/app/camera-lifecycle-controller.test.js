import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCameraLifecycleController } from "./camera-lifecycle-controller.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createButton() {
  return {
    classList: { toggle: mock(() => {}) },
    disabled: false,
  };
}

function createHarness({ isIOS = false, startImplementation = async () => true } = {}) {
  let isStreaming = false;
  const cameraFeed = {
    currentTime: 1,
    pause: mock(() => {}),
    play: mock(async () => {}),
    readyState: 4,
    videoHeight: 1080,
    videoWidth: 1920,
  };
  const captureButton = createButton();
  const rotateButton = createButton();
  const recordMetric = mock(() => true);
  const cameraController = {
    getStreamState: mock(() => ({
      hasStream: true,
      hasVideoTrack: true,
      trackReadyState: "live",
      videoReadyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    })),
    startStream: mock(startImplementation),
    stopStream: mock(() => {}),
    toggleFacingMode: mock(async () => true),
  };
  const livePreviewController = {
    cancelRefresh: mock(() => {}),
    getIsStreaming: mock(() => isStreaming),
    recordStoppedFrame: mock(() => {}),
    reset: mock(() => {}),
    scheduleRefresh: mock(() => {}),
    setStreaming: mock((next) => {
      isStreaming = next;
    }),
  };
  const controller = createCameraLifecycleController({
    cameraFeed,
    cameraController,
    captureButton,
    rotateButton,
    captureMicroInteractions: { cleanup: mock(() => {}) },
    isIOS,
    livePreviewController,
    visualEffects: { setCaptureGlowActive: mock(() => {}) },
    getExposureUi: () => ({ setDisabled() {}, syncCapabilities() {} }),
    getIsAppDestroyed: () => false,
    getZoomUi: () => ({ setDisabled() {}, syncCapabilities() {} }),
    scheduleViewportMetricsSync: mock(() => {}),
    syncCameraFeedOrientation: mock(() => {}),
    syncCameraViewportLayout: mock(() => {}),
    updateCachedPreviewDimensions: mock(() => true),
    now: () => 25,
    recordMetric,
  });

  return {
    cameraController,
    cameraFeed,
    captureButton,
    controller,
    livePreviewController,
    recordMetric,
    rotateButton,
  };
}

describe("camera lifecycle controller", () => {
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;
  const originalHtmlMediaElement = globalThis.HTMLMediaElement;
  let visibilityState;
  let scheduledTimers;

  beforeEach(() => {
    visibilityState = "visible";
    scheduledTimers = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia() {} } },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get visibilityState() {
          return visibilityState;
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        clearTimeout: mock(() => {}),
        setTimeout(callback, delay) {
          scheduledTimers.push({ callback, delay });
          return scheduledTimers.length;
        },
      },
    });
    Object.defineProperty(globalThis, "HTMLMediaElement", {
      configurable: true,
      value: { HAVE_CURRENT_DATA: 2 },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "HTMLMediaElement", {
      configurable: true,
      value: originalHtmlMediaElement,
    });
  });

  test("deduplicates starts and disables capture actions until completion", async () => {
    const deferred = createDeferred();
    const harness = createHarness({ startImplementation: () => deferred.promise });

    const first = harness.controller.startCameraStream();
    const second = harness.controller.startCameraStream();

    expect(harness.cameraController.startStream).toHaveBeenCalledTimes(1);
    expect(harness.captureButton.disabled).toBe(true);
    expect(harness.rotateButton.disabled).toBe(true);

    deferred.resolve(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(harness.captureButton.disabled).toBe(false);
    expect(harness.rotateButton.disabled).toBe(false);
    expect(harness.livePreviewController.scheduleRefresh).toHaveBeenCalledTimes(1);
    expect(harness.recordMetric).toHaveBeenCalledTimes(1);
    expect(harness.recordMetric).toHaveBeenCalledWith("camera-start", {
      durationMs: 0,
      operation: "start",
      outcome: "success",
    });
  });

  test("stops iOS tracks in the background and reacquires on foreground", async () => {
    const harness = createHarness({ isIOS: true });
    harness.controller.setInitialStartupComplete();
    expect(await harness.controller.startCameraStream()).toBe(true);

    visibilityState = "hidden";
    harness.controller.handleDocumentVisibilityChange();
    expect(harness.cameraController.stopStream).toHaveBeenCalledTimes(1);
    expect(harness.cameraFeed.pause).toHaveBeenCalled();

    visibilityState = "visible";
    harness.controller.handleDocumentVisibilityChange();
    expect(scheduledTimers).toHaveLength(1);
    expect(scheduledTimers[0].delay).toBe(900);
    scheduledTimers[0].callback();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.cameraController.startStream).toHaveBeenCalledTimes(2);
  });

  test("keeps non-iOS tracks warm while pausing preview work", async () => {
    const harness = createHarness({ isIOS: false });
    harness.controller.setInitialStartupComplete();
    expect(await harness.controller.startCameraStream()).toBe(true);

    visibilityState = "hidden";
    harness.controller.handleDocumentVisibilityChange();

    expect(harness.cameraController.stopStream).not.toHaveBeenCalled();
    expect(harness.livePreviewController.cancelRefresh).toHaveBeenCalled();
    expect(harness.cameraFeed.pause).toHaveBeenCalled();

    visibilityState = "visible";
    harness.controller.handleDocumentVisibilityChange();
    expect(scheduledTimers[0].delay).toBe(240);
  });

  test("camera rotation stops the old stream and reports the new start result", async () => {
    const harness = createHarness();

    expect(await harness.controller.rotateCamera()).toBe(true);
    expect(harness.cameraController.stopStream).toHaveBeenCalledTimes(1);
    expect(harness.cameraController.toggleFacingMode).toHaveBeenCalledTimes(1);
  });

  test("surface suspension cancels pending startup and blocks background resume work", async () => {
    const deferred = createDeferred();
    const harness = createHarness({ startImplementation: () => deferred.promise });
    harness.controller.setInitialStartupComplete();

    const pendingStart = harness.controller.startCameraStream();
    expect(harness.controller.isStartPending()).toBe(true);

    harness.controller.setSurfaceSuspended(true);
    harness.controller.stopCurrentStream({ preserveResumeIntent: true });
    expect(harness.controller.isStartPending()).toBe(false);
    expect(harness.captureButton.disabled).toBe(true);
    expect(harness.rotateButton.disabled).toBe(true);

    harness.controller.handleWindowFocus();
    expect(scheduledTimers).toHaveLength(0);
    expect(await harness.controller.startCameraStream()).toBe(false);

    deferred.resolve(true);
    expect(await pendingStart).toBe(false);
    expect(harness.livePreviewController.scheduleRefresh).not.toHaveBeenCalled();

    harness.controller.setSurfaceSuspended(false);
    expect(harness.captureButton.disabled).toBe(false);
    expect(harness.rotateButton.disabled).toBe(false);
  });
});
