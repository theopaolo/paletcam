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
import {
  createAdjLeverUi,
  createCountDialUi,
  createShutterSlideUi,
  createTrayScrollerUi,
} from "./modules/count-controls-ui.js";
import { getFooterLab, subscribeFooterLab } from "./modules/footer-lab.js";
import { createIrisShutter } from "./modules/iris-shutter.js";
import { bindTuneTray } from "./modules/tune-tray.js";
import {
  prepareUiFeedback,
  pressFeedback,
  shutterFeedback,
  unlockUiFeedback,
} from "./modules/ui-feedback.js";
import { showToast } from "./modules/toast-ui.js";
import { bindUncaughtErrorHandlers } from "./modules/uncaught-error-handler.js";
import { initializeStorageHealth } from "./modules/storage-health.js";
import { initializeBackupService } from "./backup-service.js";
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
  capturePaletteStage,
  configPanel,
  frameCanvas,
  gridKey,
  outputPalette,
  paletteCanvas,
  paletteLockOverlay,
  paletteOriginsOverlay,
  photoOutput,
  pinsKey,
  ralLiveSwatch,
  ralLiveSwatchCode,
  ralLiveSwatchColor,
  ralLiveSwatchName,
  ralReticle,
  rotateButton,
  swatchCountDrum,
  tuneTray,
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
let unsubscribeFromFooterLab = () => {};
let tuneTrayControl = { beginDrag() {}, destroy() {} };
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
  paletteSource: capturePaletteStage,
  thumbnailTarget: photoOutput?.closest(".mini-output") ?? null,
});
const visualEffects = createVisualEffects({ captureButton });
const ralPreview = createRalPreviewController({
  ralLiveSwatch,
  ralLiveSwatchColor,
  ralLiveSwatchCode,
  ralLiveSwatchName,
  visualEffects,
  onColorChange: (color) => {
    irisShutter.setColors([color]);
    countControl?.setColors?.([color]);
  },
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
/* One color is its own mode (aim the crosshair, take that color); two is left out. */
const SWATCH_COUNT_STOPS = Object.freeze([1, 3, 4, 5, 6, 7]);
const footerControls = /** @type {HTMLElement | null} */ (
  captureButton?.closest(".btn-containers") ?? null
);
const irisShutter = createIrisShutter({ button: captureButton });
/** The count control of the active footer variant (dial, ADJ lever, shutter slide or tray scroller); the drum is always built. */
let countControl = null;

/** Single color reuses the RAL capture path: crosshair sample, catches saved as "ral". */
function getCaptureModeForCount(count) {
  return count === 1 ? "ral" : "palette";
}

function applySwatchCount(nextSwatchCount) {
  swatchCount = nextSwatchCount;
  syncCaptureMode(getCaptureModeForCount(swatchCount));
}

const swatchCountDrumUi = createSwatchCountDrumUiController({
  swatchCountDrum,
  values: [...SWATCH_COUNT_STOPS],
  onSwatchCountChange: (nextSwatchCount) => {
    applySwatchCount(nextSwatchCount);
    countControl?.sync(nextSwatchCount);
  },
});

function handleCountControlChange(nextSwatchCount) {
  applySwatchCount(nextSwatchCount);
  swatchCountDrumUi.initialize(nextSwatchCount);
}

function applyFooterLab({ shutter, count }) {
  document.body.dataset.footerShutter = shutter;
  document.body.dataset.footerCount = count;
  irisShutter.setLook(shutter);
  countControl?.destroy();
  countControl = null;
  const countOptions = {
    values: [...SWATCH_COUNT_STOPS],
    value: swatchCount,
    onChange: handleCountControlChange,
  };
  if (count === "dial" || count === "numbered") {
    countControl = createCountDialUi({
      ...countOptions,
      button: viewCollectionButton,
      numbered: count === "numbered",
    });
  } else if (count === "adj") {
    countControl = createAdjLeverUi({ ...countOptions, host: footerControls });
  } else if (count === "tray") {
    countControl = createTrayScrollerUi({
      ...countOptions,
      host: tuneTray?.querySelector(".tune-quick") ?? null,
    });
  } else if (count === "shutter") {
    countControl = createShutterSlideUi({
      ...countOptions,
      button: captureButton,
      onVerticalDrag: (event, startY) => tuneTrayControl.beginDrag(event, startY),
    });
  }
}

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
  const isEntering = mode !== currentCaptureMode;
  currentCaptureMode = mode;

  // Toggle camera UI elements
  document.body.classList.toggle("is-ral-mode", isRal);
  if (configPanel) configPanel.isTuningDisabled = isRal;
  if (ralReticle) ralReticle.hidden = !isRal;
  if (ralLiveSwatch) ralLiveSwatch.hidden = !isRal;
  if (paletteCaptureStage) paletteCaptureStage.hidden = isRal;
  // Expose for what sits under the crosshair, where the camera supports a point.
  if (isRal && isEntering) {
    void cameraController.setMeteringPoint({ x: 0.5, y: 0.5 });
  }

  syncCameraViewportLayout();
  livePreviewController?.updateCachedDimensions();

  // Reset state when switching modes
  livePreviewController?.reset();
  livePreviewController?.scheduleRefresh();
}

function applyAppSettings({
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
  pinsKey?.setAttribute("aria-pressed", String(originBadgesEnabled));
  performanceHud.setEnabled(performanceHudEnabled);
  medianCutExtractionSettings = { ...medianCut };
  hybridSettings = { ...hybrid };
  syncCaptureMode(getCaptureModeForCount(swatchCount));
}

bindManagedEventListener(pinsKey, "click", () => {
  updateAppSettings({ originBadgesEnabled: !originBadgesEnabled });
});

/** The Pins key previews its markers in the live palette's first two colors. */
function paintPinDots(colors) {
  const dots = pinsKey?.querySelectorAll(".pin-dots b") ?? [];
  dots.forEach((dot, index) => {
    const color = colors[index];
    if (dot instanceof HTMLElement && color) {
      dot.style.backgroundColor = `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
    }
  });
}

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
  onPaletteChange: (colors) => {
    irisShutter.setColors(colors);
    countControl?.setColors?.(colors);
    paintPinDots(colors);
  },
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
  toggleButton: gridKey,
});

const panelCameraUi = createPanelCameraUiController({
  zoomUi,
  exposureUi,
});

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

  unlockUiFeedback();
  shutterFeedback();
  irisShutter.snap();
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
  globalThis.requestIdleCallback?.(prepareUiFeedback, { timeout: 3000 });
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
  tuneTrayControl = bindTuneTray({ tray: tuneTray });
  swatchCountDrumUi.initialize(swatchCount);
  applyFooterLab(getFooterLab());
  unsubscribeFromFooterLab = subscribeFooterLab(applyFooterLab);
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
  // Camera-screen buttons click as they go down; the shutter has its own clack.
  const handleButtonPress = (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button:not(.btn-capture):not(:disabled)")
    ) {
      unlockUiFeedback();
      pressFeedback();
    }
  };
  bindManagedEventListener(captureContainer, "pointerdown", handleButtonPress);
  bindManagedEventListener(footerControls, "pointerdown", handleButtonPress);
  bindManagedEventListener(tuneTray, "pointerdown", handleButtonPress);
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
  countControl?.destroy();
  countControl = null;
  irisShutter.destroy();
  unsubscribeFromFooterLab();
  unsubscribeFromFooterLab = () => {};
  zoomUi?.destroy?.();
  exposureUi?.destroy?.();
  gridUi?.destroy?.();
  tuneTrayControl.destroy();
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
initializeBackupService();
initializeApp();
scheduleDeleteOutboxInitialization();
