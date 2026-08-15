import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import { setLocale, t } from "./i18n.js";
import { createCameraController } from "./modules/camera-controller.js";
import { renderOutputSwatches } from "./modules/camera-ui.js";
import { reportAppError } from "./modules/error-reporting.js";
import { createExposureUiController } from "./modules/exposure-ui.js";
import { createCameraGridUiController } from "./modules/camera-grid-ui.js";
import { createCaptureMicroInteractions } from "./modules/micro-interactions.js";
import { createPaletteExtractionWorkerController } from "./modules/palette-extraction-worker.js";
import { createPerformanceHudBridge } from "./modules/performance-hud-bridge.js";
import { createSwatchCountDrumUiController } from "./modules/swatch-count-drum-ui.js";
import { showToast } from "./modules/toast-ui.js";
import { bindUncaughtErrorHandlers } from "./modules/uncaught-error-handler.js";
import { initializeStorageHealth } from "./modules/storage-health.js";
import { recordOperationalMetric, recordSessionStarted } from "./modules/operational-metrics.js";
import { createVisualEffects } from "./modules/visual-effects.js";
import { createZoomUiController } from "./modules/zoom-ui.js";
import { createCameraLifecycleController } from "./modules/app/camera-lifecycle-controller.js";
import { createCameraSurfaceLifecycleController } from "./modules/app/camera-surface-lifecycle-controller.js";
import { createCaptureController } from "./modules/app/capture-controller.js";
import { CAMERA_FRAME_ASPECT_RATIO, getContainedSize } from "./modules/app/geometry.js";
import { createLivePreviewController } from "./modules/app/live-preview-controller.js";
import { createPanelCameraUiController } from "./modules/app/panel-camera-ui-controller.js";
import {
  COLLECTION_SURFACE_NAME,
  createCollectionEntryController,
  VIEWER_SURFACE_NAME,
} from "./modules/app/collection-entry-controller.js";
import { isIOSDevice, supportsCameraStartup } from "./modules/platform.js";
import { createPhotoOutputController } from "./modules/app/photo-output.js";
import { createRalPreviewController } from "./modules/app/ral-preview.js";
import { createViewportHeightController } from "./modules/app/viewport-height.js";
import { createAppView, hasRequiredAppViewElements } from "./modules/app/app-view.js";
import { terminateAppLifetime } from "./modules/app-terminal-lifecycle.js";
import { initCommunityHomepageLink } from "./community-homepage-link.js";
import "./modules/panels/config-panel.js";
import "./modules/panels/settings-panel.js";
import { initializePaletteStorage, subscribePaletteDatabaseLifecycle } from "./palette-storage.js";

const unbindUncaughtErrorHandlers = bindUncaughtErrorHandlers();
recordSessionStarted();
setLocale(getAppSettings().locale, { force: true });
void initializePaletteStorage({
  polaroidRenderSettings: { footerLabel: getAppSettings().polaroidFooterLabel },
}).catch(() => {
  showToast(t("storage.database.maintenanceFailed"), {
    variant: "error",
    duration: 8000,
  });
});

const appView = createAppView(document);
const {
  allowButton,
  allowText,
  cameraFeed,
  cameraPreviewDock,
  cameraSourceMount,
  cameraStageMount,
  cameraViewportFrame,
  captureButton,
  captureCameraStage,
  captureContainer,
  captureModeSection,
  captureModeToggle,
  capturePaletteStage,
  configPanel,
  frameCanvas,
  outputPalette,
  paletteCanvas,
  paletteLockOverlay,
  paletteOriginsOverlay,
  photoOutput,
  ralLiveSwatch,
  ralLiveSwatchCode,
  ralLiveSwatchColor,
  ralLiveSwatchName,
  ralLiveSwatchQuality,
  ralReticle,
  rotateButton,
  slidersContainer,
  swatchCountDrum,
  viewCollectionButton,
} = appView;
const paletteCaptureStage = capturePaletteStage;
paletteOriginsOverlay.className = "palette-origins-overlay";
paletteOriginsOverlay.setAttribute("aria-hidden", "true");
const isIOS = isIOSDevice();
const shouldUseCanvasPreview = isIOS;
const cameraPreviewSurface = shouldUseCanvasPreview ? frameCanvas : cameraFeed;

if (shouldUseCanvasPreview) {
  document.documentElement.classList.add("use-canvas-camera-preview");
  cameraSourceMount.className = "camera-source-mount";
  cameraPreviewSurface?.classList.add("camera-feed-canvas");
  cameraPreviewSurface?.setAttribute("aria-label", t("capture.cameraPreview"));
  cameraPreviewSurface?.setAttribute("role", "img");
  cameraFeed?.setAttribute("aria-hidden", "true");
  document.body.appendChild(cameraSourceMount);
  if (cameraFeed) {
    cameraSourceMount.appendChild(cameraFeed);
  }
}

let swatchCount = Number(swatchCountDrum?.dataset.value) || 4;
let currentCaptureMode = "palette";
let oneMoreColor = Boolean(getAppSettings().oneMoreColor);
let originBadgesEnabled = Boolean(getAppSettings().originBadgesEnabled);
let medianCutExtractionSettings = { ...getAppSettings().medianCut };
let hybridSettings = { ...getAppSettings().hybrid };
let lastCameraViewportLayout = null;
let unsubscribeFromAppSettings = () => {};
let unsubscribeFromDatabaseLifecycle = () => {};
let destroyCommunityHomepageLink = () => {};
let cancelDeferredDeleteOutboxInitialization = () => {};
let isAppDestroyed = false;
let currentLocale = getAppSettings().locale;
let livePreviewController = null;
let captureController = null;
const eventAbortController = new AbortController();
const eventListenerSignal = eventAbortController.signal;
function bindManagedEventListener(target, eventName, listener) {
  target?.addEventListener?.(eventName, listener, { signal: eventListenerSignal });
}
const photoOutputController = createPhotoOutputController(photoOutput);
const clearPhotoOutput = photoOutputController.clear;
let cameraLifecycleController = null;
const performanceHud = createPerformanceHudBridge({
  initialEnabled: getAppSettings().performanceHudEnabled,
  loadController: __PALETCAM_DEBUG_TOOLS__
    ? () => import(new URL("debug/performance-hud.js", document.baseURI).href)
    : null,
});

cameraViewportFrame.className = "camera-feed-frame";
const captureMicroInteractions = createCaptureMicroInteractions({
  captureButton,
  captureContainer,
});
const visualEffects = createVisualEffects({ captureButton });
const ralPreview = createRalPreviewController({
  ralLiveSwatch,
  ralLiveSwatchColor,
  ralLiveSwatchCode,
  ralLiveSwatchName,
  ralLiveSwatchQuality,
  visualEffects,
});
const paletteExtractionWorker = createPaletteExtractionWorkerController({
  onError: (error) => {
    recordOperationalMetric("worker-fallback", {
      worker: "palette-extraction",
      errorName: error instanceof Error ? error.name : "Error",
    });
    reportAppError(error, {
      logMessage: "Palette extraction worker unavailable.",
      consoleLevel: "warn",
    });
  },
  onResult: ({ colors, durationMs, origins, frozenPresence }) => {
    livePreviewController?.handleWorkerResult({ colors, durationMs, origins, frozenPresence });
  },
});
const swatchCountDrumUi = createSwatchCountDrumUiController({
  swatchCountDrum,
  onSwatchCountChange: (nextSwatchCount) => {
    swatchCount = nextSwatchCount;
    livePreviewController?.reset();
    livePreviewController?.scheduleRefresh();
  },
});

function shouldMirrorUserFacingCamera() {
  if (cameraController.getFacingMode() !== "user") {
    return false;
  }

  // Keep mirror behavior for touch-first devices, but disable it on desktop.
  return window.matchMedia?.("(any-pointer: coarse)").matches ?? false;
}

function syncCameraFeedOrientation() {
  if (shouldUseCanvasPreview || !cameraFeed) {
    return;
  }

  cameraFeed.style.transform = shouldMirrorUserFacingCamera() ? "scaleX(-1)" : "scaleX(1)";
}

let viewportHeightController = null;

function syncCameraViewportLayout() {
  const hostElement = cameraViewportFrame.parentElement;
  if (!hostElement) {
    lastCameraViewportLayout = null;
    return;
  }

  const { width, height } = getContainedSize(
    hostElement.clientWidth,
    hostElement.clientHeight,
    CAMERA_FRAME_ASPECT_RATIO,
  );

  if (width <= 0 || height <= 0) {
    lastCameraViewportLayout = null;
    return;
  }

  const nextLayoutKey = `${width}x${height}`;
  if (lastCameraViewportLayout === nextLayoutKey) {
    return;
  }

  cameraViewportFrame.style.width = `${width}px`;
  cameraViewportFrame.style.height = `${height}px`;
  lastCameraViewportLayout = nextLayoutKey;
}

viewportHeightController = createViewportHeightController({
  onSync: () => {
    syncCameraViewportLayout();
    livePreviewController?.updateCachedDimensions();
  },
});

function getPaletteExtractionOptions() {
  return {
    medianCut: { ...medianCutExtractionSettings },
    hybrid: { ...hybridSettings },
  };
}

function syncUserFacingCopy() {
  cameraPreviewSurface?.setAttribute("aria-label", t("capture.cameraPreview"));
  swatchCountDrumUi.initialize(swatchCount);
  ralPreview.resyncCopy();
}

function syncCaptureMode(mode) {
  const isRal = mode === "ral";
  currentCaptureMode = mode;

  if (captureModeToggle) {
    captureModeToggle.textContent =
      mode === "ral" ? t("capture.mode.palette") : t("capture.mode.ral");
    captureModeToggle.dataset.captureMode = mode;
    captureModeToggle.setAttribute(
      "aria-label",
      t("capture.mode.toggleAria", {
        mode: mode === "ral" ? t("capture.mode.palette") : t("capture.mode.ral"),
      }),
    );
  }

  // Toggle camera UI elements
  document.body.classList.toggle("is-ral-mode", isRal);
  if (ralReticle) ralReticle.hidden = !isRal;
  if (ralLiveSwatch) ralLiveSwatch.hidden = !isRal;
  if (slidersContainer) slidersContainer.hidden = isRal;
  if (paletteCaptureStage) paletteCaptureStage.hidden = isRal;

  syncCameraViewportLayout();
  livePreviewController?.updateCachedDimensions();

  // Reset state when switching modes
  livePreviewController?.reset();
  livePreviewController?.scheduleRefresh();
}

function applyAppSettings({
  captureMode,
  locale,
  performanceHudEnabled,
  oneMoreColor: nextOneMoreColor,
  originBadgesEnabled: nextOriginBadgesEnabled,
  medianCut,
  hybrid,
}) {
  if (locale !== currentLocale) {
    currentLocale = locale;
    setLocale(locale);
    syncUserFacingCopy();
  }

  oneMoreColor = Boolean(nextOneMoreColor);
  originBadgesEnabled = Boolean(nextOriginBadgesEnabled);
  performanceHud.setEnabled(performanceHudEnabled);
  medianCutExtractionSettings = { ...medianCut };
  hybridSettings = { ...hybrid };
  livePreviewController?.reset();
  syncCaptureMode(captureMode);
}

bindManagedEventListener(captureModeToggle, "click", () => {
  const nextMode = currentCaptureMode === "ral" ? "palette" : "ral";
  updateAppSettings({ captureMode: nextMode });
});

function mountCameraFeed(targetElement) {
  if (!cameraPreviewSurface || !targetElement) {
    return;
  }

  if (cameraViewportFrame.parentElement !== targetElement) {
    targetElement.appendChild(cameraViewportFrame);
    lastCameraViewportLayout = null;
  }

  if (cameraPreviewSurface.parentElement !== cameraViewportFrame) {
    cameraViewportFrame.appendChild(cameraPreviewSurface);
  }

  if (shouldUseCanvasPreview && cameraFeed && cameraFeed.parentElement !== cameraSourceMount) {
    cameraSourceMount.appendChild(cameraFeed);
  }

  if (paletteOriginsOverlay.parentElement !== cameraViewportFrame) {
    cameraViewportFrame.appendChild(paletteOriginsOverlay);
  }

  if (ralReticle && ralReticle.parentElement !== cameraViewportFrame) {
    cameraViewportFrame.appendChild(ralReticle);
  }

  syncCameraViewportLayout();
}

function setPreviewExpanded(shouldExpand) {
  if (!captureContainer || !cameraStageMount || !cameraPreviewDock) {
    return;
  }

  const nextExpandedState = Boolean(shouldExpand);

  captureContainer.classList.toggle("is-preview-expanded", nextExpandedState);
  document.body.classList.toggle("is-preview-expanded", nextExpandedState);
  captureCameraStage?.setAttribute("aria-hidden", String(!nextExpandedState));
  cameraPreviewSurface?.setAttribute("aria-expanded", String(nextExpandedState));

  mountCameraFeed(nextExpandedState ? cameraStageMount : cameraPreviewDock);
  syncCameraFeedOrientation();
  syncCameraViewportLayout();
  livePreviewController?.updateCachedDimensions();
}

let zoomUi = null;
let exposureUi = null;
let gridUi = null;

/** @param {ErrorLike | null | undefined} error */
function handleCameraControllerError(error) {
  reportAppError(error, {
    logMessage: "Camera unavailable.",
    includeConsole: false,
  });

  cameraLifecycleController?.handleCameraStartError(error);
}

const cameraController = createCameraController({
  cameraFeed,
  onError: handleCameraControllerError,
  onCameraActiveChange: (isCameraActive) =>
    cameraLifecycleController?.handleCameraActiveChange(isCameraActive),
  onZoomChange: (zoomValue) => {
    zoomUi?.handleZoomChange(zoomValue);
  },
  onExposureChange: (exposureValue) => {
    exposureUi?.handleExposureChange(exposureValue);
  },
  onStreamInterrupted: (event) => cameraLifecycleController?.handleStreamInterrupted(event),
});

livePreviewController = createLivePreviewController({
  cameraFeed,
  frameCanvas,
  paletteCanvas,
  paletteLockOverlay,
  captureContainer,
  capturePaletteStage,
  originsOverlayCanvas: paletteOriginsOverlay,
  paletteCaptureStage,
  cameraController,
  paletteExtractionWorker,
  performanceHud,
  ralPreview,
  visualEffects,
  getCurrentCaptureMode: () => currentCaptureMode,
  getIsCaptureSavePending: () => Boolean(captureController?.isSavePending()),
  getMedianCutExtractionSettings: () => medianCutExtractionSettings,
  getOneMoreColor: () => oneMoreColor,
  getOriginBadgesEnabled: () => originBadgesEnabled,
  getHybridSettings: () => hybridSettings,
  getShouldMirrorUserFacingCamera: shouldMirrorUserFacingCamera,
  getSwatchCount: () => swatchCount,
  shouldUseCanvasPreview,
});

captureController = createCaptureController({
  cameraFeed,
  frameCanvas,
  outputPalette,
  cameraController,
  captureMicroInteractions,
  livePreviewController,
  photoOutputController,
  ralPreview,
  getCaptureMode: () => currentCaptureMode,
  getOneMoreColor: () => oneMoreColor,
  getPaletteExtractionOptions,
  getShouldMirrorUserFacingCamera: shouldMirrorUserFacingCamera,
});

zoomUi = createZoomUiController({
  cameraController,
  overlayHost: cameraViewportFrame,
});

exposureUi = createExposureUiController({
  cameraController,
  overlayHost: cameraViewportFrame,
});

gridUi = createCameraGridUiController({
  overlayHost: cameraViewportFrame,
});

const panelCameraUi = createPanelCameraUiController({
  cameraFeed,
  configPanel,
  zoomUi,
  exposureUi,
  gridUi,
});

// The capture-mode toggle overlays the live preview like the grid/quality/EV
// controls, so it moves into the viewport frame alongside them.
if (captureModeSection) {
  cameraViewportFrame.appendChild(captureModeSection);
}

cameraLifecycleController = createCameraLifecycleController({
  cameraFeed,
  cameraController,
  captureButton,
  rotateButton,
  captureMicroInteractions,
  isIOS,
  livePreviewController,
  visualEffects,
  getExposureUi: () => exposureUi,
  getIsAppDestroyed: () => isAppDestroyed,
  getZoomUi: () => zoomUi,
  scheduleViewportMetricsSync: () => viewportHeightController?.schedule(),
  syncCameraFeedOrientation,
  syncCameraViewportLayout,
  updateCachedPreviewDimensions: () => livePreviewController?.updateCachedDimensions() ?? false,
});

const cameraSurfaceLifecycleController = createCameraSurfaceLifecycleController({
  isCameraActive: () =>
    Boolean(livePreviewController?.getIsStreaming()) ||
    Boolean(cameraController.getStreamState().hasStream) ||
    Boolean(cameraLifecycleController?.isStartPending()),
  suspendCamera: ({ shouldResume }) => {
    cameraLifecycleController?.setSurfaceSuspended(true);
    cameraLifecycleController?.stopCurrentStream({ preserveResumeIntent: shouldResume });
  },
  releaseCamera: ({ shouldResume }) => {
    cameraLifecycleController?.setSurfaceSuspended(false);
    return shouldResume ? cameraLifecycleController?.startCameraStream() : false;
  },
  onError: (error, operation) => {
    reportAppError(error, {
      logMessage: `Failed to ${operation} the camera for a full-screen surface.`,
    });
  },
});

const collectionEntryController = createCollectionEntryController({
  photoOutput,
  viewCollectionButton,
  photoOutputController,
  deletedEventTarget: window,
  loadCollectionModule: () => import("./collection-ui.js"),
  onLoadError: (error, operation) => {
    reportAppError(error, {
      logMessage:
        operation === "viewer" ? "Failed to load collection viewer." : "Failed to load collection.",
    });
    showToast(t("collection.loadErrorToast"), { variant: "error", duration: 1800 });
  },
  onViewerPendingDelete: () => {
    showToast(t("collection.viewerPendingDelete"), { duration: 1800 });
  },
  onViewerMissing: () => {
    showToast(t("collection.viewerMissing"), { duration: 1800 });
  },
  onSurfaceOpening: cameraSurfaceLifecycleController.open,
  onSurfaceOpenAbandoned: cameraSurfaceLifecycleController.close,
});

function handleSharedPanelClosed(event) {
  const panelName = event?.detail?.panelName;
  if (panelName === COLLECTION_SURFACE_NAME || panelName === VIEWER_SURFACE_NAME) {
    cameraSurfaceLifecycleController.close(panelName);
  }
}

function handleCaptureButtonClick(event) {
  event.preventDefault();

  if (
    !livePreviewController?.getIsStreaming() ||
    livePreviewController.getFrameWidth() <= 0 ||
    livePreviewController.getFrameHeight() <= 0
  ) {
    void cameraLifecycleController?.startCameraStream();
    return;
  }

  void captureController?.captureCurrentFrame();
}

function handleWindowBeforeUnload() {
  destroyApp();
}

function initializeApp() {
  if (!hasRequiredAppViewElements(appView)) {
    reportAppError(null, {
      consoleMessage: "Missing required DOM elements for camera app initialization.",
      includeClientLog: false,
    });
    return;
  }

  unsubscribeFromDatabaseLifecycle = subscribePaletteDatabaseLifecycle((eventType) => {
    showToast(t(`storage.database.${eventType}`), {
      variant: "error",
      duration: 8000,
    });
  });

  isAppDestroyed = false;
  viewportHeightController?.sync();
  applyAppSettings(getAppSettings());
  setPreviewExpanded(true);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  collectionEntryController.bindEvents();
  zoomUi.bindEvents();
  exposureUi.bindEvents();
  gridUi.bindEvents();
  bindRotationEvents();
  swatchCountDrumUi.bindEvents();
  panelCameraUi.bind();
  bindManagedEventListener(window, "beforeunload", handleWindowBeforeUnload);
  bindManagedEventListener(window, "focus", cameraLifecycleController?.handleWindowFocus);
  bindManagedEventListener(window, "pagehide", cameraLifecycleController?.handleAppHidden);
  bindManagedEventListener(window, "pageshow", cameraLifecycleController?.handleWindowPageShow);
  bindManagedEventListener(document, "shared-panel-closed", handleSharedPanelClosed);
  bindManagedEventListener(window, "resize", () => viewportHeightController?.schedule());
  bindManagedEventListener(window, "orientationchange", () => viewportHeightController?.schedule());
  bindManagedEventListener(window.visualViewport, "resize", () =>
    viewportHeightController?.schedule(),
  );
  bindManagedEventListener(window.visualViewport, "scroll", () =>
    viewportHeightController?.schedule(),
  );
  bindManagedEventListener(
    document,
    "visibilitychange",
    cameraLifecycleController?.handleDocumentVisibilityChange,
  );

  if (__PALETCAM_DEBUG_TOOLS__) {
    bindManagedEventListener(document, "toggle-performance-hud", () => {
      const next = !getAppSettings().performanceHudEnabled;
      updateAppSettings({ performanceHudEnabled: next });
    });
  }
  unsubscribeFromAppSettings = subscribeAppSettings(applyAppSettings);
  syncCameraFeedOrientation();

  zoomUi.initialize();
  exposureUi.initialize();
  gridUi.initialize();
  swatchCountDrumUi.initialize(swatchCount);
  cameraLifecycleController?.syncActionAvailability();
  clearPhotoOutput();
  renderOutputSwatches(outputPalette, []);
  captureButton.disabled = false;
  if (viewCollectionButton) {
    viewCollectionButton.disabled = false;
  }
  document.documentElement.dataset.appReady = "true";

  if (supportsCameraStartup()) {
    void cameraLifecycleController?.startCameraStream()?.then(() => {
      cameraLifecycleController?.setInitialStartupComplete();
    });
  } else {
    cameraLifecycleController?.setInitialStartupComplete();
  }
}

function bindCameraPermissionEvents() {
  if (!supportsCameraStartup()) {
    return;
  }

  bindManagedEventListener(allowButton, "click", () =>
    cameraLifecycleController?.startCameraStream(),
  );
  bindManagedEventListener(allowText, "click", () =>
    cameraLifecycleController?.startCameraStream(),
  );
}

function bindCaptureEvents() {
  bindManagedEventListener(cameraFeed, "canplay", cameraLifecycleController?.handleCameraCanPlay);
  bindManagedEventListener(
    captureButton,
    "pointerdown",
    captureMicroInteractions.pulseCaptureButton,
  );
  bindManagedEventListener(captureButton, "click", handleCaptureButtonClick);
  // Tapping the preview meters the exposure there (see exposure-ui.js), so
  // pinning a colour is done from the palette strip below instead.
  bindManagedEventListener(paletteCanvas, "pointerdown", (event) => {
    const paletteRect = paletteCanvas?.getBoundingClientRect();
    if (!paletteRect || paletteRect.width <= 0) {
      return;
    }

    const normalizedX = (event.clientX - paletteRect.left) / paletteRect.width;
    if (livePreviewController?.togglePaletteSwatchFreezeAt(normalizedX)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function scheduleDeleteOutboxInitialization() {
  const initialize = () => {
    cancelDeferredDeleteOutboxInitialization = () => {};
    void import("./community-delete-outbox.js")
      .then(({ initializeDeleteOutbox }) => initializeDeleteOutbox())
      .catch((error) => {
        reportAppError(error, {
          logMessage: "Failed to initialize remote deletion cleanup.",
          consoleLevel: "warn",
        });
      });
  };

  if (typeof globalThis.requestIdleCallback === "function") {
    const idleId = globalThis.requestIdleCallback(initialize, { timeout: 3000 });
    cancelDeferredDeleteOutboxInitialization = () => globalThis.cancelIdleCallback(idleId);
    return;
  }

  const timeoutId = globalThis.setTimeout(initialize, 1200);
  cancelDeferredDeleteOutboxInitialization = () => globalThis.clearTimeout(timeoutId);
}

function bindRotationEvents() {
  bindManagedEventListener(rotateButton, "click", () => cameraLifecycleController?.rotateCamera());
}

function destroyApp() {
  if (isAppDestroyed) {
    return;
  }

  isAppDestroyed = true;
  terminateAppLifetime();
  viewportHeightController?.clear();
  cameraSurfaceLifecycleController.destroy();
  cameraLifecycleController?.stopCurrentStream({ preserveResumeIntent: false });
  swatchCountDrumUi.destroy?.();
  zoomUi?.destroy?.();
  exposureUi?.destroy?.();
  gridUi?.destroy?.();
  panelCameraUi.destroy();
  collectionEntryController.destroy();
  cameraController.destroy?.();
  paletteExtractionWorker.destroy();
  performanceHud.destroy?.();
  unsubscribeFromAppSettings();
  unsubscribeFromAppSettings = () => {};
  unsubscribeFromDatabaseLifecycle();
  unsubscribeFromDatabaseLifecycle = () => {};
  cancelDeferredDeleteOutboxInitialization();
  cancelDeferredDeleteOutboxInitialization = () => {};
  destroyCommunityHomepageLink();
  destroyCommunityHomepageLink = () => {};
  eventAbortController.abort();
  unbindUncaughtErrorHandlers();
  clearPhotoOutput();
}

destroyCommunityHomepageLink = initCommunityHomepageLink();
void initializeStorageHealth();
initializeApp();
scheduleDeleteOutboxInitialization();
