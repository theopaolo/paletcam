import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import { openDirectPaletteViewer, PALETTE_DELETED_EVENT } from "./collection-ui.js";
import { setLocale, t } from "./i18n.js";
import { createCameraController } from "./modules/camera-controller.js";
import { renderOutputSwatches } from "./modules/camera-ui.js";
import { reportAppError } from "./modules/error-reporting.js";
import { createExposureUiController } from "./modules/exposure-ui.js";
import { createCameraGridUiController } from "./modules/camera-grid-ui.js";
import {
  createPhotoQualityUiController,
  PHOTO_QUALITY_EXPORT_VALUES,
} from "./modules/photo-quality-ui.js";
import { createCaptureMicroInteractions } from "./modules/micro-interactions.js";
import { createPaletteExtractionWorkerController } from "./modules/palette-extraction-worker.js";
import { createPerformanceHudController } from "./modules/performance-hud.js";
import { createSwatchSliderUiController } from "./modules/swatch-slider-ui.js";
import { showToast } from "./modules/toast-ui.js";
import { bindUncaughtErrorHandlers } from "./modules/uncaught-error-handler.js";
import { createVisualEffects } from "./modules/visual-effects.js";
import { createZoomUiController } from "./modules/zoom-ui.js";
import { createCameraLifecycleController } from "./modules/app/camera-lifecycle-controller.js";
import { createCaptureController } from "./modules/app/capture-controller.js";
import { CAMERA_FRAME_ASPECT_RATIO, getContainedSize } from "./modules/app/geometry.js";
import { createLivePreviewController } from "./modules/app/live-preview-controller.js";
import { isIOSDevice, supportsCameraStartup } from "./modules/platform.js";
import { createPhotoOutputController } from "./modules/app/photo-output.js";
import { createRalPreviewController } from "./modules/app/ral-preview.js";
import { createViewportHeightController } from "./modules/app/viewport-height.js";
import { initCommunityHomepageLink } from "./community-homepage-link.js";
import "./modules/panels/config-panel.js";
import "./modules/panels/settings-panel.js";

bindUncaughtErrorHandlers();
setLocale(getAppSettings().locale, { force: true });

const cameraFeed = /** @type {HTMLVideoElement | null} */ (document.querySelector(".camera-feed"));
const captureButton = /** @type {HTMLButtonElement | null} */ (
  document.querySelector(".btn-capture")
);
const captureModeToggle = /** @type {HTMLButtonElement | null} */ (
  document.querySelector(".btn-capture-mode-toggle")
);
const allowButton = /** @type {HTMLElement | null} */ (document.querySelector(".btn-allow-media"));
const allowText = /** @type {HTMLElement | null} */ (
  document.querySelector(".allow-container span")
);
const captureContainer = /** @type {HTMLElement | null} */ (document.querySelector(".capture"));
const capturePaletteStage = /** @type {HTMLElement | null} */ (
  document.querySelector(".capture-palette-stage")
);
const captureCameraStage = /** @type {HTMLElement | null} */ (
  document.querySelector(".capture-camera-stage")
);
const cameraStageMount = document.getElementById("cameraStageMount");
const cameraPreviewDock = document.getElementById("cameraPreviewDock");
const photoOutput = /** @type {HTMLImageElement | null} */ (document.getElementById("photo"));
const outputPalette = document.getElementById("outputPalette");
const frameCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("canvas"));
const paletteCanvas = /** @type {HTMLCanvasElement | null} */ (
  document.getElementById("canvas-palette")
);
const paletteLockOverlay = document.getElementById("paletteLockOverlay");
const rotateButton = /** @type {HTMLButtonElement | null} */ (
  document.querySelector(".btn-rotate")
);
const swatchSlider = /** @type {HTMLInputElement | null} */ (
  document.querySelector('.swatch-slider input[type="range"]')
);
const ralReticle = document.getElementById("ralReticle");
const ralLiveSwatch = document.getElementById("ralLiveSwatch");
const ralLiveSwatchColor = document.getElementById("ralLiveSwatchColor");
const ralLiveSwatchCode = document.getElementById("ralLiveSwatchCode");
const ralLiveSwatchName = document.getElementById("ralLiveSwatchName");
const ralLiveSwatchQuality = document.getElementById("ralLiveSwatchQuality");
const slidersContainer = document.querySelector(".sliders-container");
const paletteCaptureStage = document.querySelector(".capture-palette-stage");

const cameraViewportFrame = document.createElement("div");
const cameraSourceMount = document.createElement("div");
const paletteOriginsOverlay = document.createElement("canvas");
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

let swatchCount = Number(swatchSlider?.value) || 4;
let currentCaptureMode = "palette";
let oneMoreColor = Boolean(getAppSettings().oneMoreColor);
let originBadgesEnabled = Boolean(getAppSettings().originBadgesEnabled);
let photoExportQuality =
  PHOTO_QUALITY_EXPORT_VALUES[getAppSettings().photoQualityMode] ?? PHOTO_QUALITY_EXPORT_VALUES.hd;
let medianCutExtractionSettings = { ...getAppSettings().medianCut };
let hybridSettings = { ...getAppSettings().hybrid };
let lastCameraViewportLayout = null;
let unsubscribeFromAppSettings = () => {};
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
const performanceHud = createPerformanceHudController({
  initialEnabled: getAppSettings().performanceHudEnabled,
});

cameraViewportFrame.className = "camera-feed-frame";
const captureMicroInteractions = createCaptureMicroInteractions({
  captureButton,
  captureContainer,
});
const visualEffects = createVisualEffects({
  captureButton,
  swatchSliderShell: swatchSlider?.closest(".swatch-slider") ?? null,
});
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
    reportAppError(error, {
      logMessage: "Palette extraction worker unavailable.",
      consoleLevel: "warn",
    });
  },
  onResult: ({ colors, durationMs, origins, frozenPresence }) => {
    livePreviewController?.handleWorkerResult({ colors, durationMs, origins, frozenPresence });
  },
});
const swatchSliderUi = createSwatchSliderUiController({
  swatchSlider,
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
  swatchSliderUi.initialize(swatchCount);
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
  photoQualityMode,
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
  photoExportQuality =
    PHOTO_QUALITY_EXPORT_VALUES[photoQualityMode] ?? PHOTO_QUALITY_EXPORT_VALUES.hd;
  photoQualityUi?.syncMode(photoQualityMode);
  performanceHud.setEnabled(performanceHudEnabled);
  medianCutExtractionSettings = { ...medianCut };
  hybridSettings = { ...hybrid };
  livePreviewController?.reset();
  syncCaptureMode(captureMode);
}

captureModeToggle?.addEventListener("click", () => {
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
let photoQualityUi = null;
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
  getPhotoExportQuality: () => photoExportQuality,
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

photoQualityUi = createPhotoQualityUiController({
  overlayHost: cameraViewportFrame,
  onModeChange: (mode) => updateAppSettings({ photoQualityMode: mode }),
});

gridUi = createCameraGridUiController({
  overlayHost: cameraViewportFrame,
});

// The capture-mode toggle overlays the live preview like the grid/quality/EV
// controls, so it moves into the viewport frame alongside them.
const captureModeSection = document.querySelector(".capture-mode-section");
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

async function handleMiniOutputClick() {
  const paletteId = photoOutputController.getPaletteId();
  if (!photoOutputController.hasPhoto() || paletteId === null) {
    return;
  }

  const viewerOpenState = await openDirectPaletteViewer(paletteId);
  if (viewerOpenState === "opened") {
    return;
  }

  if (viewerOpenState === "pending-delete") {
    showToast(t("collection.viewerPendingDelete"), {
      duration: 1800,
    });
    return;
  }

  clearPhotoOutput();
  showToast(t("collection.viewerMissing"), {
    duration: 1800,
  });
}

function handleWindowBeforeUnload() {
  destroyApp();
}

function initializeApp() {
  if (
    !cameraFeed ||
    !captureButton ||
    !captureContainer ||
    !frameCanvas ||
    !paletteCanvas ||
    !cameraStageMount ||
    !cameraPreviewDock
  ) {
    reportAppError(null, {
      consoleMessage: "Missing required DOM elements for camera app initialization.",
      includeClientLog: false,
    });
    return;
  }

  isAppDestroyed = false;
  viewportHeightController?.sync();
  applyAppSettings(getAppSettings());
  setPreviewExpanded(true);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindMiniOutputEvents();
  zoomUi.bindEvents();
  exposureUi.bindEvents();
  photoQualityUi.bindEvents();
  gridUi.bindEvents();
  bindRotationEvents();
  swatchSliderUi.bindEvents();
  bindManagedEventListener(window, "beforeunload", handleWindowBeforeUnload);
  bindManagedEventListener(window, "focus", cameraLifecycleController?.handleWindowFocus);
  bindManagedEventListener(window, "pagehide", cameraLifecycleController?.handleAppHidden);
  bindManagedEventListener(window, "pageshow", cameraLifecycleController?.handleWindowPageShow);
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

  const configPanelEl = /** @type {HTMLElement | null} */ (document.querySelector("config-panel"));
  let configPipVideo = null;
  bindManagedEventListener(document, "config-drawer-change", (event) => {
    if (event.detail.isOpen) {
      zoomUi?.setDisabled();
      exposureUi?.setDisabled();
      photoQualityUi?.hide();
      gridUi?.hide();
      const stream = cameraFeed?.srcObject;
      if (stream && configPanelEl && !configPipVideo && window.innerHeight < 800) {
        configPipVideo = document.createElement("video");
        configPipVideo.autoplay = true;
        configPipVideo.muted = true;
        configPipVideo.playsInline = true;
        configPipVideo.className = "config-pip";
        configPipVideo.setAttribute("aria-hidden", "true");
        configPipVideo.srcObject = /** @type {MediaStream} */ (stream);
        document.body.appendChild(configPipVideo);
        configPipVideo.play().catch(() => {});
      }
    } else {
      if (configPipVideo) {
        configPipVideo.srcObject = null;
        configPipVideo.remove();
        configPipVideo = null;
      }
      zoomUi?.syncCapabilities();
      exposureUi?.syncCapabilities();
      photoQualityUi?.show();
      gridUi?.show();
    }
  });
  bindManagedEventListener(document, "settings-drawer-change", (event) => {
    if (event.detail.isOpen) {
      zoomUi?.setDisabled();
      exposureUi?.setDisabled();
      photoQualityUi?.hide();
      gridUi?.hide();
    } else {
      zoomUi?.syncCapabilities();
      exposureUi?.syncCapabilities();
      photoQualityUi?.show();
      gridUi?.show();
    }
  });
  bindManagedEventListener(document, "toggle-performance-hud", () => {
    const next = !getAppSettings().performanceHudEnabled;
    updateAppSettings({ performanceHudEnabled: next });
  });
  unsubscribeFromAppSettings = subscribeAppSettings(applyAppSettings);
  syncCameraFeedOrientation();

  zoomUi.initialize();
  exposureUi.initialize();
  photoQualityUi.initialize(getAppSettings().photoQualityMode);
  gridUi.initialize();
  swatchSliderUi.initialize(swatchCount);
  cameraLifecycleController?.syncActionAvailability();
  clearPhotoOutput();
  renderOutputSwatches(outputPalette, []);

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
  bindManagedEventListener(cameraViewportFrame, "pointerdown", (event) => {
    const overlayRect = paletteOriginsOverlay.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) {
      return;
    }

    const normalizedX = (event.clientX - overlayRect.left) / overlayRect.width;
    const normalizedY = (event.clientY - overlayRect.top) / overlayRect.height;
    if (livePreviewController?.toggleOriginFreezeAt(normalizedX, normalizedY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
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

function handlePaletteDeleted(event) {
  const deletedPaletteId = Number(event?.detail?.paletteId);
  if (
    !Number.isFinite(deletedPaletteId) ||
    photoOutputController.getPaletteId() !== deletedPaletteId
  ) {
    return;
  }

  clearPhotoOutput();
}

function bindMiniOutputEvents() {
  if (!photoOutput) {
    return;
  }

  bindManagedEventListener(photoOutput, "load", () => {
    photoOutput.hidden = false;
  });
  bindManagedEventListener(photoOutput, "error", () => {
    if (photoOutput.getAttribute("src")) {
      clearPhotoOutput();
    }
  });
  bindManagedEventListener(photoOutput, "click", handleMiniOutputClick);
  bindManagedEventListener(window, PALETTE_DELETED_EVENT, handlePaletteDeleted);
}

function bindRotationEvents() {
  bindManagedEventListener(rotateButton, "click", () => cameraLifecycleController?.rotateCamera());
}

function destroyApp() {
  if (isAppDestroyed) {
    return;
  }

  isAppDestroyed = true;
  viewportHeightController?.clear();
  cameraLifecycleController?.stopCurrentStream({ preserveResumeIntent: false });
  swatchSliderUi.destroy?.();
  zoomUi?.destroy?.();
  exposureUi?.destroy?.();
  photoQualityUi?.destroy?.();
  gridUi?.destroy?.();
  cameraController.destroy?.();
  paletteExtractionWorker.destroy();
  performanceHud.destroy?.();
  unsubscribeFromAppSettings();
  unsubscribeFromAppSettings = () => {};
  eventAbortController.abort();
  clearPhotoOutput();
}

initCommunityHomepageLink();
initializeApp();
