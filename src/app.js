import { getAppSettings, subscribeAppSettings } from "./app-settings.js";
import { openDirectPaletteViewer, PALETTE_DELETED_EVENT } from "./collection-ui.js";
import { createCameraController } from "./modules/camera-controller.js";
import {
  DEFAULT_CAMERA_RESUME_DELAY_MS,
  getCameraResumeDelay,
} from "./modules/camera-resume-policy.js";
import { drawFrameToCanvas, renderOutputSwatches } from "./modules/camera-ui.js";
import { clientLog } from "./modules/client-log.js";
import { createErrorToastOptions, reportAppError } from "./modules/error-reporting.js";
import { findClosestRAL, getRalQualityLabel } from "./modules/color-matching-ral.js";
import { formatErrorDetails } from "./modules/error-format.js";
import { createExposureUiController } from "./modules/exposure-ui.js";
import { createCaptureMicroInteractions } from "./modules/micro-interactions.js";
import {
  extractPaletteColors,
  getDominantColor,
  renderPaletteBars,
  resetColorSmoothing,
  smoothColors,
} from "./modules/palette-extraction.js";
import { createPaletteExtractionWorkerController } from "./modules/palette-extraction-worker.js";
import { createPerformanceHudController } from "./modules/performance-hud.js";
import { sampleColorFromContextAtPoint } from "./modules/ral-live-sampling.js";
import { createSwatchSliderUiController } from "./modules/swatch-slider-ui.js";
import { showToast } from "./modules/toast-ui.js";
import { createVisualEffects } from "./modules/visual-effects.js";
import { createZoomUiController } from "./modules/zoom-ui.js";
import { savePalette } from "./palette-storage.js";
import { trackCaptureStatAsync } from "./capture-stat-service.js";
import "./modules/panels/settings-panel.js";
import "./delete-account-ui.js";

const PHOTO_EXPORT_MAX_WIDTH = 2048;
const CAMERA_FRAME_ASPECT_RATIO = 4 / 3;
const CAMERA_FRAME_ASPECT_RATIO_LABEL = "4:3";
const CAMERA_HEALTH_CHECK_DELAY_MS = 320;
const CAMERA_MIN_TIME_ADVANCE_SECONDS = 0.05;
const APP_VIEWPORT_HEIGHT_CSS_VAR = "--app-height";
const APP_VIEWPORT_RESYNC_DELAYS_MS = [120, 360];
const ANALYSIS_MAX_WIDTH = 640;
const PREVIEW_SMOOTHING_FACTOR = 0.16;
const RAL_SMOOTHING_FACTOR = 0.18;
const RAL_COLOR_DISTANCE_THRESHOLD = 12;


const cameraFeed = /** @type {HTMLVideoElement | null} */ (document.querySelector(".camera-feed"));
const captureButton = /** @type {HTMLButtonElement | null} */ (document.querySelector(".btn-capture"));
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
const analysisCanvas = document.createElement("canvas");
const rotateButton = /** @type {HTMLButtonElement | null} */ (document.querySelector(".btn-rotate"));
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
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

const cameraViewportFrame = document.createElement("div");
const cameraSourceMount = document.createElement("div");
const isIOS = isIOSDevice();
const shouldUseCanvasPreview = isIOS;
const cameraPreviewSurface = shouldUseCanvasPreview ? frameCanvas : cameraFeed;

if (shouldUseCanvasPreview) {
  document.documentElement.classList.add("use-canvas-camera-preview");
  cameraSourceMount.className = "camera-source-mount";
  cameraPreviewSurface?.classList.add("camera-feed-canvas");
  cameraPreviewSurface?.setAttribute("aria-label", "Aperçu caméra");
  cameraPreviewSurface?.setAttribute("role", "img");
  cameraFeed?.setAttribute("aria-hidden", "true");
  document.body.appendChild(cameraSourceMount);
  if (cameraFeed) {
    cameraSourceMount.appendChild(cameraFeed);
  }
}

const frameContext =
  frameCanvas?.getContext("2d", { willReadFrequently: true }) ?? frameCanvas?.getContext("2d");
const paletteContext = paletteCanvas?.getContext("2d");
const analysisContext =
  analysisCanvas.getContext("2d", { willReadFrequently: true }) ?? analysisCanvas.getContext("2d");

let frameWidth = 0;
let frameHeight = 0;
let analysisWidth = 0;
let analysisHeight = 0;
let isStreaming = false;
let swatchCount = Number(swatchSlider?.value) || 4;
let _isPreviewExpanded = false;
let extractionFrame = 0;
let lastExtractedColors = null;
let lastVisiblePaletteColors = [];
let currentCaptureMode = "palette";
let oneMoreColor = Boolean(getAppSettings().oneMoreColor);
let photoExportQuality = getAppSettings().photoExportQuality;
let medianCutExtractionSettings = { ...getAppSettings().medianCut };
let paletteScoringSettings = { ...getAppSettings().paletteScoring };
const EXTRACTION_INTERVAL = 4;
let lastCameraViewportLayout = null;
let cachedPaletteWidth = 0;
let cachedPaletteHeight = 0;
let previewFrameRequestId = 0;
let unsubscribeFromAppSettings = () => {};
const appEventCleanups = [];
let isAppDestroyed = false;
let isInitialStartupComplete = false;
let shouldResumeCameraOnForeground = false;
let cameraResumeTimeoutId = 0;
let cameraResumeAttemptId = 0;
let viewportHeightSyncFrameId = 0;
const viewportHeightSyncTimeoutIds = [];
let lastViewportHeight = 0;
let currentPhotoObjectUrl = "";
let isCaptureSavePending = false;
let latestPaletteWorkerDurationMs = null;
let activeCameraStartPromise = null;
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
});
const paletteExtractionWorker = createPaletteExtractionWorkerController({
  onError: (error) => {
    reportAppError(error, {
      logMessage: "Palette extraction worker unavailable.",
      consoleLevel: "warn",
    });
  },
  onResult: ({ colors, durationMs }) => {
    latestPaletteWorkerDurationMs = durationMs;
    lastExtractedColors = colors;
  },
});
const swatchSliderUi = createSwatchSliderUiController({
  swatchSlider,
  onSwatchCountChange: (nextSwatchCount) => {
    swatchCount = nextSwatchCount;
    resetPalettePreviewState();
    schedulePreviewRefresh();
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

function getPaletteViewportSize() {
  const paletteViewport =
    currentCaptureMode === "ral" || paletteCaptureStage?.hidden
      ? captureContainer
      : (capturePaletteStage ?? captureContainer);

  return {
    width: paletteViewport?.clientWidth ?? 0,
    height: paletteViewport?.clientHeight ?? 0,
  };
}

function bindManagedEventListener(target, eventName, listener, options) {
  if (!target || typeof target.addEventListener !== "function") {
    return;
  }

  target.addEventListener(eventName, listener, options);
  appEventCleanups.push(() => {
    target.removeEventListener(eventName, listener, options);
  });
}

function supportsCameraStartup() {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

function setButtonDisabled(button, shouldDisable) {
  if (!button) {
    return;
  }

  button.disabled = shouldDisable;
}

function syncCameraActionAvailability() {
  const shouldDisableActions = !supportsCameraStartup() || Boolean(activeCameraStartPromise);
  setButtonDisabled(captureButton, shouldDisableActions);
  setButtonDisabled(rotateButton, shouldDisableActions);
  captureButton?.classList.toggle("is-loading", Boolean(activeCameraStartPromise));
}

function getCameraStartToastOptions(error) {
  const name = error?.name ?? "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      message: "Autorisez l’accès à la caméra pour capturer des palettes.",
      duration: 4200,
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      message: "Aucune caméra n’a été détectée sur cet appareil.",
      duration: 3800,
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      message: "La caméra est déjà utilisée ou momentanément indisponible.",
      duration: 3800,
    };
  }

  if (name === "OverconstrainedError") {
    return {
      message: "Impossible de démarrer une caméra compatible.",
      duration: 3800,
    };
  }

  return {
    message: "Impossible de démarrer la caméra.",
    duration: 3500,
    details: formatErrorDetails(error),
  };
}

function handleCameraStartError(error) {
  const { message, duration, details } = getCameraStartToastOptions(error);
  showToast(message, {
    variant: "error",
    duration,
    details,
  });
}

function finalizeStartedCameraStream(started) {
  if (!started) {
    return false;
  }

  syncCameraViewportLayout();
  updateCachedPreviewDimensions();
  zoomUi?.syncCapabilities();
  exposureUi?.syncCapabilities();
  shouldResumeCameraOnForeground = true;

  if (!isStreaming) {
    isStreaming = true;
    schedulePreviewRefresh();
  }

  return true;
}

async function runCameraStartOperation(startOperation) {
  if (!supportsCameraStartup()) {
    syncCameraActionAvailability();
    return false;
  }

  if (activeCameraStartPromise) {
    return activeCameraStartPromise;
  }

  const startPromise = (async () => {
    cancelScheduledCameraResume();
    invalidateCameraResumeChecks();
    isStreaming = false;
    cancelPreviewRefresh();

    const started = await startOperation();

    return finalizeStartedCameraStream(started);
  })();

  activeCameraStartPromise = startPromise;
  syncCameraActionAvailability();

  try {
    return await startPromise;
  } finally {
    if (activeCameraStartPromise === startPromise) {
      activeCameraStartPromise = null;
    }
    syncCameraActionAvailability();
  }
}

function clearManagedEventListeners() {
  while (appEventCleanups.length > 0) {
    const cleanup = appEventCleanups.pop();
    cleanup?.();
  }
}

function clearScheduledViewportHeightSync() {
  if (viewportHeightSyncFrameId) {
    window.cancelAnimationFrame(viewportHeightSyncFrameId);
    viewportHeightSyncFrameId = 0;
  }

  while (viewportHeightSyncTimeoutIds.length > 0) {
    window.clearTimeout(viewportHeightSyncTimeoutIds.pop());
  }
}

function getLiveViewportHeight() {
  const viewportHeightCandidates = [
    window.visualViewport?.height ?? 0,
    window.innerHeight,
    document.documentElement?.clientHeight ?? 0,
  ].filter((value) => Number.isFinite(value) && value > 0);

  if (viewportHeightCandidates.length === 0) {
    return 0;
  }

  return Math.round(Math.min(...viewportHeightCandidates));
}

function applyViewportHeight() {
  const nextViewportHeight = getLiveViewportHeight();
  if (nextViewportHeight <= 0 || nextViewportHeight === lastViewportHeight) {
    return;
  }

  document.documentElement.style.setProperty(
    APP_VIEWPORT_HEIGHT_CSS_VAR,
    `${nextViewportHeight}px`,
  );
  lastViewportHeight = nextViewportHeight;
}

function syncViewportMetrics() {
  applyViewportHeight();
  syncCameraViewportLayout();
  updateCachedPreviewDimensions();
}

function scheduleViewportMetricsSync() {
  clearScheduledViewportHeightSync();

  viewportHeightSyncFrameId = window.requestAnimationFrame(() => {
    viewportHeightSyncFrameId = 0;
    syncViewportMetrics();
  });

  for (const delayMs of APP_VIEWPORT_RESYNC_DELAYS_MS) {
    const timeoutId = window.setTimeout(() => {
      const timeoutIndex = viewportHeightSyncTimeoutIds.indexOf(timeoutId);
      if (timeoutIndex >= 0) {
        viewportHeightSyncTimeoutIds.splice(timeoutIndex, 1);
      }

      syncViewportMetrics();
    }, delayMs);

    viewportHeightSyncTimeoutIds.push(timeoutId);
  }
}

function cancelPreviewRefresh() {
  if (!previewFrameRequestId) {
    return;
  }

  window.cancelAnimationFrame(previewFrameRequestId);
  previewFrameRequestId = 0;
}

function schedulePreviewRefresh() {
  if (!isStreaming || previewFrameRequestId) {
    return;
  }

  previewFrameRequestId = window.requestAnimationFrame((rafTimestamp) => {
    previewFrameRequestId = 0;
    refreshPreview(rafTimestamp);
  });
}

function cancelScheduledCameraResume() {
  if (!cameraResumeTimeoutId) {
    return;
  }

  window.clearTimeout(cameraResumeTimeoutId);
  cameraResumeTimeoutId = 0;
}

function invalidateCameraResumeChecks() {
  cameraResumeAttemptId += 1;
}

function updateCachedPreviewDimensions() {
  const { width: nextPaletteWidth, height: nextPaletteHeight } = getPaletteViewportSize();
  if (nextPaletteWidth <= 0 || nextPaletteHeight <= 0) {
    cachedPaletteWidth = 0;
    cachedPaletteHeight = 0;
    frameWidth = 0;
    frameHeight = 0;
    analysisWidth = 0;
    analysisHeight = 0;
    analysisCanvas.width = 0;
    analysisCanvas.height = 0;
    return false;
  }

  cachedPaletteWidth = nextPaletteWidth;
  cachedPaletteHeight = nextPaletteHeight;
  frameWidth = nextPaletteWidth;
  frameHeight = getTargetFrameHeight(frameWidth);

  if (
    !cameraFeed ||
    !frameCanvas ||
    !paletteCanvas ||
    !analysisContext ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return false;
  }

  cameraFeed.setAttribute("width", String(frameWidth));
  cameraFeed.setAttribute("height", String(frameHeight));

  if (frameCanvas.width !== frameWidth || frameCanvas.height !== frameHeight) {
    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;
  }

  if (paletteCanvas.width !== frameWidth || paletteCanvas.height !== cachedPaletteHeight) {
    paletteCanvas.width = frameWidth;
    paletteCanvas.height = cachedPaletteHeight;
  }

  updateAnalysisDimensions();
  return true;
}

function waitForDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function waitForNextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function revokePhotoOutputObjectUrl() {
  if (!currentPhotoObjectUrl) {
    return;
  }

  URL.revokeObjectURL(currentPhotoObjectUrl);
  currentPhotoObjectUrl = "";
}

function clearPhotoOutput() {
  revokePhotoOutputObjectUrl();
  photoOutput?.removeAttribute("src");
  photoOutput?.removeAttribute("data-palette-id");
  if (photoOutput) {
    photoOutput.hidden = true;
  }
}

function setPhotoOutputBlob(blob) {
  if (!(blob instanceof Blob) || !photoOutput) {
    return;
  }

  revokePhotoOutputObjectUrl();
  currentPhotoObjectUrl = URL.createObjectURL(blob);
  photoOutput.hidden = true;
  photoOutput.setAttribute("src", currentPhotoObjectUrl);
}

function getContainedSize(width, height, aspectRatio) {
  if (width <= 0 || height <= 0 || aspectRatio <= 0) {
    return { width: 0, height: 0 };
  }

  const containerAspectRatio = width / height;

  if (containerAspectRatio > aspectRatio) {
    const nextHeight = Math.max(1, Math.floor(height));
    const nextWidth = Math.max(1, Math.floor(nextHeight * aspectRatio));
    return { width: nextWidth, height: nextHeight };
  }

  const nextWidth = Math.max(1, Math.floor(width));
  const nextHeight = Math.max(1, Math.floor(nextWidth / aspectRatio));
  return { width: nextWidth, height: nextHeight };
}

function getTargetFrameHeight(width) {
  if (width <= 0) {
    return 0;
  }

  return Math.max(1, Math.floor(width / CAMERA_FRAME_ASPECT_RATIO));
}

function updateAnalysisDimensions() {
  if (frameWidth <= 0 || frameHeight <= 0) {
    analysisWidth = 0;
    analysisHeight = 0;
    analysisCanvas.width = 0;
    analysisCanvas.height = 0;
    return false;
  }

  const scale = Math.min(1, ANALYSIS_MAX_WIDTH / frameWidth);
  const nextAnalysisWidth = Math.max(1, Math.round(frameWidth * scale));
  const nextAnalysisHeight = Math.max(1, Math.round(frameHeight * scale));

  analysisWidth = nextAnalysisWidth;
  analysisHeight = nextAnalysisHeight;

  if (analysisCanvas.width !== nextAnalysisWidth || analysisCanvas.height !== nextAnalysisHeight) {
    analysisCanvas.width = nextAnalysisWidth;
    analysisCanvas.height = nextAnalysisHeight;
  }

  return true;
}

function getCenteredAspectCropRect(
  sourceWidth,
  sourceHeight,
  targetAspectRatio = CAMERA_FRAME_ASPECT_RATIO,
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetAspectRatio <= 0) {
    return null;
  }

  const sourceAspectRatio = sourceWidth / sourceHeight;

  if (Math.abs(sourceAspectRatio - targetAspectRatio) < 0.0001) {
    return {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  if (sourceAspectRatio > targetAspectRatio) {
    const width = Math.max(1, Math.round(sourceHeight * targetAspectRatio));
    const x = Math.max(0, Math.floor((sourceWidth - width) / 2));

    return {
      x,
      y: 0,
      width: Math.min(width, sourceWidth),
      height: sourceHeight,
    };
  }

  const height = Math.max(1, Math.round(sourceWidth / targetAspectRatio));
  const y = Math.max(0, Math.floor((sourceHeight - height) / 2));

  return {
    x: 0,
    y,
    width: sourceWidth,
    height: Math.min(height, sourceHeight),
  };
}

function getCameraFrameSourceRect() {
  return getCenteredAspectCropRect(cameraFeed?.videoWidth ?? 0, cameraFeed?.videoHeight ?? 0);
}

function roundNormalizedCropValue(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toNormalizedCropRect(sourceRect, sourceWidth, sourceHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const safeRect =
    sourceRect && sourceRect.width > 0 && sourceRect.height > 0
      ? sourceRect
      : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  const clampedX = Math.max(0, Math.min(Math.round(safeRect.x), Math.max(0, sourceWidth - 1)));
  const clampedY = Math.max(0, Math.min(Math.round(safeRect.y), Math.max(0, sourceHeight - 1)));
  const clampedWidth = Math.max(1, Math.min(Math.round(safeRect.width), sourceWidth - clampedX));
  const clampedHeight = Math.max(1, Math.min(Math.round(safeRect.height), sourceHeight - clampedY));

  return {
    x: roundNormalizedCropValue(clampedX / sourceWidth),
    y: roundNormalizedCropValue(clampedY / sourceHeight),
    width: roundNormalizedCropValue(clampedWidth / sourceWidth),
    height: roundNormalizedCropValue(clampedHeight / sourceHeight),
  };
}

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

function getPaletteExtractionOptions() {
  return {
    medianCut: { ...medianCutExtractionSettings },
    scoring: { ...paletteScoringSettings },
  };
}

function clonePaletteColors(colors) {
  if (!Array.isArray(colors)) {
    return [];
  }

  return colors.map((color) => ({ ...color }));
}

function clearRalPreviewState() {
  if (ralLiveSwatchColor) {
    ralLiveSwatchColor.style.backgroundColor = "";
  }
  if (ralLiveSwatchCode) {
    ralLiveSwatchCode.textContent = "";
  }
  if (ralLiveSwatchName) {
    ralLiveSwatchName.textContent = "";
  }
  if (ralLiveSwatchQuality) {
    ralLiveSwatchQuality.textContent = "";
  }
}

function syncRalPreview(match, sampledColor) {
  if (ralLiveSwatchColor) {
    ralLiveSwatchColor.style.backgroundColor = `rgb(${match.ral.r}, ${match.ral.g}, ${match.ral.b})`;
  }
  if (ralLiveSwatchCode) {
    ralLiveSwatchCode.textContent = match.ral.code;
  }
  if (ralLiveSwatchName) {
    ralLiveSwatchName.textContent = match.ral.name;
  }
  if (ralLiveSwatchQuality) {
    ralLiveSwatchQuality.textContent = `${getRalQualityLabel(match.deltaE)}`;
  }

  visualEffects.setCaptureButtonGlowColor(sampledColor);
  visualEffects.setCaptureGlowActive(true);
}

/** @type {{ r: number, g: number, b: number } | null} */
let previousRalSampledColor = null;
/** @type {{ match: RalMatch, sampledColor: { r: number, g: number, b: number } } | null} */
let currentLiveRalPreview = null;

function smoothRalSampledColor(raw) {
  if (!previousRalSampledColor) {
    previousRalSampledColor = raw;
    return raw;
  }

  const distance = Math.hypot(
    raw.r - previousRalSampledColor.r,
    raw.g - previousRalSampledColor.g,
    raw.b - previousRalSampledColor.b,
  );

  if (distance < RAL_COLOR_DISTANCE_THRESHOLD) {
    return previousRalSampledColor;
  }

  const smoothed = {
    r: Math.round(previousRalSampledColor.r + (raw.r - previousRalSampledColor.r) * RAL_SMOOTHING_FACTOR),
    g: Math.round(previousRalSampledColor.g + (raw.g - previousRalSampledColor.g) * RAL_SMOOTHING_FACTOR),
    b: Math.round(previousRalSampledColor.b + (raw.b - previousRalSampledColor.b) * RAL_SMOOTHING_FACTOR),
  };

  previousRalSampledColor = smoothed;
  return smoothed;
}

function resetRalSmoothing() {
  previousRalSampledColor = null;
  currentLiveRalPreview = null;
}

function readCurrentRalMatch(context = frameContext, width = frameWidth, height = frameHeight) {
  const rawColor = sampleColorFromContextAtPoint(context, width, height, width / 2, height / 2);
  const sampledColor = smoothRalSampledColor(rawColor);
  const matches = findClosestRAL(sampledColor.r, sampledColor.g, sampledColor.b, 1);
  const match = matches[0] ?? null;

  if (!match) {
    currentLiveRalPreview = null;
    clearRalPreviewState();
    visualEffects.setCaptureGlowActive(false);
    return null;
  }

  currentLiveRalPreview = {
    match,
    sampledColor: { ...sampledColor },
  };
  syncRalPreview(match, sampledColor);
  return match;
}

function resetPalettePreviewState() {
  extractionFrame = 0;
  lastExtractedColors = null;
  lastVisiblePaletteColors = [];
  latestPaletteWorkerDurationMs = null;
  clearRalPreviewState();
  paletteExtractionWorker.invalidate();
  resetColorSmoothing();
  resetRalSmoothing();
}

function syncCaptureMode(mode) {
  const isRal = mode === "ral";
  currentCaptureMode = mode;

  // Toggle camera UI elements
  document.body.classList.toggle("is-ral-mode", isRal);
  if (ralReticle) ralReticle.hidden = !isRal;
  if (ralLiveSwatch) ralLiveSwatch.hidden = !isRal;
  if (slidersContainer) slidersContainer.hidden = isRal;
  if (paletteCaptureStage) paletteCaptureStage.hidden = isRal;

  syncCameraViewportLayout();
  updateCachedPreviewDimensions();

  // Reset state when switching modes
  resetPalettePreviewState();
  schedulePreviewRefresh();
}

function getEffectiveSwatchCount() {
  return swatchCount + (oneMoreColor ? 1 : 0);
}

function removeDarkestColor(colors) {
  if (colors.length <= 1) return colors;
  let darkestIndex = 0;
  let lowestLuma = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const luma = 0.2126 * colors[i].r + 0.7152 * colors[i].g + 0.0722 * colors[i].b;
    if (luma < lowestLuma) {
      lowestLuma = luma;
      darkestIndex = i;
    }
  }
  return colors.filter((_, i) => i !== darkestIndex);
}

function getCapturePaletteColors() {
  if (lastVisiblePaletteColors.length === swatchCount) {
    return clonePaletteColors(lastVisiblePaletteColors);
  }

  return [];
}

function applyAppSettings({
  captureMode,
  performanceHudEnabled,
  oneMoreColor: nextOneMoreColor,
  photoExportQuality: nextPhotoExportQuality,
  medianCut,
  paletteScoring,
}) {
  oneMoreColor = Boolean(nextOneMoreColor);
  photoExportQuality = nextPhotoExportQuality;
  performanceHud.setEnabled(performanceHudEnabled);
  medianCutExtractionSettings = { ...medianCut };
  paletteScoringSettings = { ...paletteScoring };
  resetPalettePreviewState();
  syncCaptureMode(captureMode);
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
  _isPreviewExpanded = nextExpandedState;

  captureContainer.classList.toggle("is-preview-expanded", nextExpandedState);
  document.body.classList.toggle("is-preview-expanded", nextExpandedState);
  captureCameraStage?.setAttribute("aria-hidden", String(!nextExpandedState));
  cameraPreviewSurface?.setAttribute("aria-expanded", String(nextExpandedState));

  mountCameraFeed(nextExpandedState ? cameraStageMount : cameraPreviewDock);
  syncCameraFeedOrientation();
  syncCameraViewportLayout();
  updateCachedPreviewDimensions();
}

let zoomUi = null;
let exposureUi = null;

/** @param {ErrorLike | null | undefined} error */
function handleCameraControllerError(error) {
  reportAppError(error, {
    logMessage: "Camera unavailable.",
    includeConsole: false,
  });

  handleCameraStartError(error);
}

const cameraController = createCameraController({
  cameraFeed,
  onError: handleCameraControllerError,
  onCameraActiveChange: (isCameraActive) => {
    syncCameraFeedOrientation();
    if (!isCameraActive) {
      resetPalettePreviewState();
      zoomUi?.setDisabled();
      exposureUi?.setDisabled();
      visualEffects.setCaptureGlowActive(false);
    } else {
      zoomUi?.syncCapabilities();
      exposureUi?.syncCapabilities();
    }

    if (isCameraActive) {
      shouldResumeCameraOnForeground = true;
    } else {
      isStreaming = false;
    }
  },
  onZoomChange: (zoomValue) => {
    zoomUi?.handleZoomChange(zoomValue);
  },
  onExposureChange: (exposureValue) => {
    exposureUi?.handleExposureChange(exposureValue);
  },
  onStreamInterrupted: ({ type }) => {
    shouldResumeCameraOnForeground = true;

    if (document.visibilityState !== "visible") {
      return;
    }

    scheduleCameraResume(`track-${type}`, 0);
  },
});

zoomUi = createZoomUiController({
  cameraController,
  overlayHost: cameraViewportFrame,
});

exposureUi = createExposureUiController({
  cameraController,
  overlayHost: cameraViewportFrame,
});

function handleCaptureButtonClick(event) {
  event.preventDefault();

  if (!isStreaming || frameWidth <= 0 || frameHeight <= 0) {
    void startCameraStream();
    return;
  }

  void captureCurrentFrame();
}

async function handleMiniOutputClick() {
  const paletteId = getMiniOutputPaletteId();
  if (!photoOutput?.getAttribute("src") || paletteId === null) {
    return;
  }

  const viewerOpenState = await openDirectPaletteViewer(paletteId);
  if (viewerOpenState === "opened") {
    return;
  }

  if (viewerOpenState === "pending-delete") {
    showToast("Cette capture est en cours de suppression.", {
      duration: 1800,
    });
    return;
  }

  clearPhotoOutput();
  showToast("Cette capture n'est plus disponible.", {
    duration: 1800,
  });
}

async function handleRotateButtonClick() {
  stopCurrentStream({ preserveResumeIntent: true });
  await runCameraStartOperation(() => cameraController.toggleFacingMode());
}

function handleWindowResize() {
  scheduleViewportMetricsSync();
}

function drawCurrentFrameToAnalysisCanvas() {
  if (!analysisContext || analysisWidth <= 0 || analysisHeight <= 0) {
    return false;
  }

  drawFrameToCanvas({
    context: analysisContext,
    cameraFeed,
    width: analysisWidth,
    height: analysisHeight,
    facingMode: cameraController.getFacingMode(),
    shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
    sourceRect: getCameraFrameSourceRect(),
  });

  return true;
}

function copyVisibleFrameToAnalysisCanvas() {
  if (
    !analysisContext ||
    !frameCanvas ||
    analysisWidth <= 0 ||
    analysisHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return false;
  }

  analysisContext.drawImage(
    frameCanvas,
    0,
    0,
    frameWidth,
    frameHeight,
    0,
    0,
    analysisWidth,
    analysisHeight,
  );

  return true;
}

function getCameraTrackSettings() {
  const stream = cameraFeed?.srcObject;
  if (!(stream instanceof MediaStream)) {
    return null;
  }

  return stream.getVideoTracks()[0]?.getSettings?.() ?? null;
}

function pauseCameraPreview() {
  isStreaming = false;
  cancelPreviewRefresh();
  resetPalettePreviewState();
  cameraFeed?.pause?.();
  visualEffects.setCaptureGlowActive(false);
  captureMicroInteractions.cleanup();
  performanceHud.recordFrame({
    captureMode: currentCaptureMode,
    streaming: false,
  });
}

function shouldHandleCameraLifecycle() {
  return !isAppDestroyed && Boolean(cameraFeed);
}

function getShouldKeepCameraWarmInBackground() {
  return !isIOS;
}

async function resumePreviewFromActiveStream() {
  if (!cameraFeed) {
    return false;
  }

  try {
    await cameraFeed.play();
  } catch {
    return false;
  }

  syncCameraViewportLayout();
  if (!updateCachedPreviewDimensions()) {
    return false;
  }

  zoomUi?.syncCapabilities();
  isStreaming = true;
  schedulePreviewRefresh();

  return true;
}

async function isCameraStreamHealthy(resumeAttemptId) {
  if (!cameraFeed) {
    return false;
  }

  const initialState = cameraController.getStreamState();
  if (
    !initialState.hasStream ||
    !initialState.hasVideoTrack ||
    initialState.trackReadyState !== "live" ||
    initialState.videoReadyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return false;
  }

  try {
    await cameraFeed.play();
  } catch {
    return false;
  }

  const initialTime = cameraFeed.currentTime;
  await waitForDelay(CAMERA_HEALTH_CHECK_DELAY_MS);

  if (
    resumeAttemptId !== cameraResumeAttemptId ||
    !shouldHandleCameraLifecycle() ||
    document.visibilityState !== "visible"
  ) {
    return false;
  }

  const nextState = cameraController.getStreamState();
  if (
    !nextState.hasStream ||
    !nextState.hasVideoTrack ||
    nextState.trackReadyState !== "live" ||
    nextState.videoWidth <= 0 ||
    nextState.videoHeight <= 0
  ) {
    return false;
  }

  return cameraFeed.currentTime > initialTime + CAMERA_MIN_TIME_ADVANCE_SECONDS;
}

async function resumeCameraIfNeeded(reason) {
  if (
    !shouldHandleCameraLifecycle() ||
    !shouldResumeCameraOnForeground ||
    document.visibilityState !== "visible"
  ) {
    return;
  }

  const resumeAttemptId = ++cameraResumeAttemptId;
  const streamState = cameraController.getStreamState();

  if (
    !streamState.hasStream ||
    !streamState.hasVideoTrack ||
    streamState.trackReadyState !== "live" ||
    !getShouldKeepCameraWarmInBackground()
  ) {
    await startCameraStream();
    return;
  }

  const isHealthy = await isCameraStreamHealthy(resumeAttemptId);
  if (
    resumeAttemptId !== cameraResumeAttemptId ||
    !shouldHandleCameraLifecycle() ||
    !shouldResumeCameraOnForeground ||
    document.visibilityState !== "visible"
  ) {
    return;
  }

  if (isHealthy) {
    const resumed = await resumePreviewFromActiveStream();
    if (resumed) {
      return;
    }
  }

  clientLog("Restarting camera after app resume.", {
    reason,
    isIOS,
  });
  await startCameraStream();
}

function scheduleCameraResume(reason, delayMs = DEFAULT_CAMERA_RESUME_DELAY_MS) {
  if (
    !isInitialStartupComplete ||
    !shouldHandleCameraLifecycle() ||
    !shouldResumeCameraOnForeground ||
    document.visibilityState !== "visible"
  ) {
    return;
  }

  cancelScheduledCameraResume();
  const effectiveDelayMs = getCameraResumeDelay({
    isIOS,
    reason,
    requestedDelayMs: delayMs,
  });

  cameraResumeTimeoutId = window.setTimeout(() => {
    cameraResumeTimeoutId = 0;
    void resumeCameraIfNeeded(reason);
  }, effectiveDelayMs);
}

function handleAppHidden() {
  if (!shouldHandleCameraLifecycle()) {
    return;
  }

  const streamState = cameraController.getStreamState();
  // Preserve an earlier resume intent so repeated background events do not
  // clear it after the stream has already been paused/stopped once.
  shouldResumeCameraOnForeground =
    shouldResumeCameraOnForeground ||
    isStreaming ||
    streamState.hasStream ||
    streamState.trackReadyState === "live";
  invalidateCameraResumeChecks();
  cancelScheduledCameraResume();
  pauseCameraPreview();

  if (!getShouldKeepCameraWarmInBackground()) {
    cameraController.stopStream();
  }
}

function handleDocumentVisibilityChange() {
  if (document.visibilityState === "hidden") {
    handleAppHidden();
    return;
  }

  scheduleViewportMetricsSync();
  scheduleCameraResume("visibilitychange");
}

function handleWindowPageHide() {
  handleAppHidden();
}

function handleWindowPageShow() {
  scheduleViewportMetricsSync();
  scheduleCameraResume("pageshow");
}

function handleWindowFocus() {
  if (document.visibilityState !== "visible") {
    return;
  }

  scheduleViewportMetricsSync();
  scheduleCameraResume("focus");
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
  syncViewportMetrics();
  applyAppSettings(getAppSettings());
  setPreviewExpanded(true);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindMiniOutputEvents();
  zoomUi.bindEvents();
  exposureUi.bindEvents();
  bindRotationEvents();
  swatchSliderUi.bindEvents();
  bindManagedEventListener(window, "beforeunload", handleWindowBeforeUnload);
  bindManagedEventListener(window, "focus", handleWindowFocus);
  bindManagedEventListener(window, "pagehide", handleWindowPageHide);
  bindManagedEventListener(window, "pageshow", handleWindowPageShow);
  bindManagedEventListener(window, "resize", handleWindowResize);
  bindManagedEventListener(window, "orientationchange", handleWindowResize);
  bindManagedEventListener(window.visualViewport, "resize", handleWindowResize);
  bindManagedEventListener(window.visualViewport, "scroll", handleWindowResize);
  bindManagedEventListener(document, "visibilitychange", handleDocumentVisibilityChange);
  unsubscribeFromAppSettings = subscribeAppSettings(applyAppSettings);
  syncCameraFeedOrientation();

  zoomUi.initialize();
  exposureUi.initialize();
  swatchSliderUi.initialize(swatchCount);
  syncCameraActionAvailability();
  clearPhotoOutput();
  renderOutputSwatches(outputPalette, []);

  if (supportsCameraStartup()) {
    void startCameraStream().then(() => {
      isInitialStartupComplete = true;
    });
  } else {
    isInitialStartupComplete = true;
  }
}

function bindCameraPermissionEvents() {
  if (!supportsCameraStartup()) {
    return;
  }

  bindManagedEventListener(allowButton, "click", startCameraStream);
  bindManagedEventListener(allowText, "click", startCameraStream);
}

function bindCaptureEvents() {
  bindManagedEventListener(cameraFeed, "canplay", handleCameraCanPlay);
  bindManagedEventListener(
    captureButton,
    "pointerdown",
    captureMicroInteractions.pulseCaptureButton,
  );
  bindManagedEventListener(captureButton, "click", handleCaptureButtonClick);
}

function getMiniOutputPaletteId() {
  const paletteId = Number(photoOutput?.dataset.paletteId);
  return Number.isFinite(paletteId) ? paletteId : null;
}

function handlePaletteDeleted(event) {
  const deletedPaletteId = Number(event?.detail?.paletteId);
  if (!Number.isFinite(deletedPaletteId) || getMiniOutputPaletteId() !== deletedPaletteId) {
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
  bindManagedEventListener(rotateButton, "click", handleRotateButtonClick);
}

async function startCameraStream() {
  return runCameraStartOperation(() => cameraController.startStream());
}

function handleCameraCanPlay() {
  if (cameraFeed.videoWidth <= 0 || cameraFeed.videoHeight <= 0) {
    return;
  }

  syncCameraViewportLayout();
  if (!updateCachedPreviewDimensions()) {
    return;
  }

  if (!isStreaming) {
    isStreaming = true;
    schedulePreviewRefresh();
  }
}

function refreshPreview(rafTimestamp = 0) {
  if (
    !isStreaming ||
    !analysisContext ||
    (shouldUseCanvasPreview && !frameContext) ||
    !paletteContext
  ) {
    return;
  }

  if (
    cachedPaletteWidth <= 0 ||
    cachedPaletteHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    analysisWidth <= 0 ||
    analysisHeight <= 0 ||
    cameraFeed.videoWidth <= 0 ||
    cameraFeed.videoHeight <= 0
  ) {
    schedulePreviewRefresh();
    return;
  }
  const frameStartTime = performance.now();
  let analysisDurationMs = latestPaletteWorkerDurationMs;
  latestPaletteWorkerDurationMs = null;

  if (shouldUseCanvasPreview) {
    drawFrameToCanvas({
      context: frameContext,
      cameraFeed,
      width: frameWidth,
      height: frameHeight,
      facingMode: cameraController.getFacingMode(),
      shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
      sourceRect: getCameraFrameSourceRect(),
    });
  }

  if (isCaptureSavePending) {
    visualEffects.setCaptureGlowActive(false);
  } else if (currentCaptureMode === "ral") {
    const analysisStartTime = performance.now();
    if (!shouldUseCanvasPreview) {
      drawCurrentFrameToAnalysisCanvas();
    }

    readCurrentRalMatch(
      shouldUseCanvasPreview ? frameContext : analysisContext,
      shouldUseCanvasPreview ? frameWidth : analysisWidth,
      shouldUseCanvasPreview ? frameHeight : analysisHeight,
    );
    analysisDurationMs = performance.now() - analysisStartTime;
  } else {
    extractionFrame += 1;
    if (extractionFrame % EXTRACTION_INTERVAL === 1 || !lastExtractedColors) {
      const analysisStartTime = performance.now();
      const analysisFrameReady = shouldUseCanvasPreview
        ? copyVisibleFrameToAnalysisCanvas()
        : drawCurrentFrameToAnalysisCanvas();

      if (analysisFrameReady) {
        const frameImageData = analysisContext.getImageData(
          0,
          0,
          analysisWidth,
          analysisHeight,
        ).data;
        const extractionDelegatedToWorker = paletteExtractionWorker.requestExtraction({
          imageData: frameImageData,
          width: analysisWidth,
          height: analysisHeight,
          swatchCount: getEffectiveSwatchCount(),
          options: getPaletteExtractionOptions(),
        });

        if (!extractionDelegatedToWorker) {
          const result = extractPaletteColors(
            frameImageData,
            analysisWidth,
            analysisHeight,
            getEffectiveSwatchCount(),
            getPaletteExtractionOptions(),
          );

          lastExtractedColors = result.colors;
          analysisDurationMs = performance.now() - analysisStartTime;
        }
      }
    }

    if (!lastExtractedColors || lastExtractedColors.length === 0) {
      schedulePreviewRefresh();
      return;
    }

    const smoothedColors = smoothColors(lastExtractedColors, PREVIEW_SMOOTHING_FACTOR);
    const displayColors = oneMoreColor ? removeDarkestColor(smoothedColors) : smoothedColors;
    lastVisiblePaletteColors = clonePaletteColors(displayColors);
    const dominantColor = getDominantColor(displayColors);

    renderPaletteBars(paletteContext, displayColors, paletteCanvas.width, paletteCanvas.height);

    if (dominantColor) {
      visualEffects.setCaptureButtonGlowColor(dominantColor);
      visualEffects.setCaptureGlowActive(true);
    } else {
      visualEffects.setCaptureGlowActive(false);
    }
  }

  const cameraTrackSettings = getCameraTrackSettings();
  performanceHud.recordFrame({
    analysisDurationMs,
    analysisHeight:
      currentCaptureMode === "ral" && shouldUseCanvasPreview ? frameHeight : analysisHeight,
    analysisWidth:
      currentCaptureMode === "ral" && shouldUseCanvasPreview ? frameWidth : analysisWidth,
    cameraFps: Number(cameraTrackSettings?.frameRate) || null,
    captureMode: currentCaptureMode,
    extractionInterval: currentCaptureMode === "ral" ? 1 : EXTRACTION_INTERVAL,
    rafTimestamp,
    refreshDurationMs: performance.now() - frameStartTime,
    sourceHeight: cameraFeed.videoHeight,
    sourceWidth: cameraFeed.videoWidth,
    streaming: isStreaming,
  });
  schedulePreviewRefresh();
}

async function captureCurrentFrame() {
  if (!frameContext || frameWidth <= 0 || frameHeight <= 0 || isCaptureSavePending) {
    return;
  }

  captureMicroInteractions.triggerCaptureFlash();

  const facingMode = cameraController.getFacingMode();
  const shouldMirrorUserFacing = shouldMirrorUserFacingCamera();
  const captureSourceWidth = cameraFeed.videoWidth || frameWidth;
  const captureSourceHeight = cameraFeed.videoHeight || frameHeight;
  const captureSourceRect = getCenteredAspectCropRect(captureSourceWidth, captureSourceHeight);
  const captureCropRect = toNormalizedCropRect(
    captureSourceRect,
    captureSourceWidth,
    captureSourceHeight,
  );

  const captureModeSnapshot = currentCaptureMode;

  frameCanvas.width = frameWidth;
  frameCanvas.height = frameHeight;

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode,
    shouldMirrorUserFacing,
    sourceRect: captureSourceRect,
  });

  let paletteColors;
  let ralMatchData = null;

  if (captureModeSnapshot === "ral") {
    const currentRalMatch = currentLiveRalPreview?.match ?? readCurrentRalMatch();
    if (currentRalMatch) {
      paletteColors = [
        { r: currentRalMatch.ral.r, g: currentRalMatch.ral.g, b: currentRalMatch.ral.b },
      ];
      ralMatchData = {
        code: currentRalMatch.ral.code,
        name: currentRalMatch.ral.name,
        r: currentRalMatch.ral.r,
        g: currentRalMatch.ral.g,
        b: currentRalMatch.ral.b,
        deltaE: currentRalMatch.deltaE,
      };
    } else {
      paletteColors = [];
    }
  } else {
    paletteColors = getCapturePaletteColors();
    if (paletteColors.length === 0) {
      const imageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;
      const { colors: extractedPaletteColors } = extractPaletteColors(
        imageData,
        frameWidth,
        frameHeight,
        getEffectiveSwatchCount(),
        getPaletteExtractionOptions(),
      );
      paletteColors = clonePaletteColors(
        oneMoreColor ? removeDarkestColor(extractedPaletteColors) : extractedPaletteColors
      );
    }
  }

  renderOutputSwatches(outputPalette, paletteColors);
  photoOutput?.removeAttribute("data-palette-id");

  isCaptureSavePending = true;
  try {
    await waitForNextAnimationFrame();
    const masterPhotoBlob = await exportPhotoBlob({
      fallbackCanvas: frameCanvas,
      fallbackWidth: frameWidth,
      fallbackHeight: frameHeight,
      cameraFeed,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: null,
    });

    setPhotoOutputBlob(masterPhotoBlob);

    if (paletteColors.length > 0) {
      const savedPalette = await savePalette(paletteColors, {
        photoBlob: masterPhotoBlob,
        captureAspectRatio: CAMERA_FRAME_ASPECT_RATIO_LABEL,
        captureCropRect,
        captureMode: captureModeSnapshot,
        ralMatch: ralMatchData,
      });
      trackCaptureStatAsync();
      if (savedPalette?.id !== undefined && savedPalette?.id !== null) {
        photoOutput.dataset.paletteId = String(savedPalette.id);
      } else {
        photoOutput.removeAttribute("data-palette-id");
      }
    }
  } catch (error) {
    photoOutput?.removeAttribute("data-palette-id");
    reportAppError(error, {
      logMessage: "Failed to save palette.",
    });
    showToast(
      "Sauvegarde échouée.",
      createErrorToastOptions(error, {
        variant: "error",
        duration: 2500,
      }),
    );
  } finally {
    isCaptureSavePending = false;
  }
}

function createPhotoExportCanvas({
  fallbackCanvas,
  fallbackWidth,
  fallbackHeight,
  cameraFeed,
  facingMode,
  shouldMirrorUserFacing,
  sourceRect = undefined,
}) {
  const photoCanvas = document.createElement("canvas");
  const photoContext = photoCanvas.getContext("2d");

  if (!photoContext) {
    return null;
  }

  const hasNativeVideoFrame = Boolean(
    cameraFeed && cameraFeed.videoWidth > 0 && cameraFeed.videoHeight > 0,
  );
  const sourceWidth = hasNativeVideoFrame ? cameraFeed.videoWidth : fallbackWidth;
  const sourceHeight = hasNativeVideoFrame ? cameraFeed.videoHeight : fallbackHeight;
  const defaultSourceRect = hasNativeVideoFrame
    ? getCenteredAspectCropRect(sourceWidth, sourceHeight)
    : null;
  const effectiveSourceRect = sourceRect === undefined ? defaultSourceRect : sourceRect;
  const exportSourceWidth = effectiveSourceRect?.width ?? sourceWidth;
  const exportSourceHeight = effectiveSourceRect?.height ?? sourceHeight;

  if (exportSourceWidth <= 0 || exportSourceHeight <= 0) {
    return null;
  }

  const photoWidth = Math.min(exportSourceWidth, PHOTO_EXPORT_MAX_WIDTH);
  const photoHeight = Math.max(
    1,
    Math.round((exportSourceHeight / exportSourceWidth) * photoWidth),
  );

  photoCanvas.width = photoWidth;
  photoCanvas.height = photoHeight;
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = "high";

  if (hasNativeVideoFrame) {
    drawFrameToCanvas({
      context: photoContext,
      cameraFeed,
      width: photoWidth,
      height: photoHeight,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: effectiveSourceRect,
    });
  } else {
    photoContext.drawImage(
      fallbackCanvas,
      0,
      0,
      fallbackWidth,
      fallbackHeight,
      0,
      0,
      photoWidth,
      photoHeight,
    );
  }

  return photoCanvas;
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, photoExportQuality);
  });
}

async function exportPhotoBlob({
  fallbackCanvas,
  fallbackWidth,
  fallbackHeight,
  cameraFeed,
  facingMode,
  shouldMirrorUserFacing,
  sourceRect = undefined,
}) {
  const photoCanvas = createPhotoExportCanvas({
    fallbackCanvas,
    fallbackWidth,
    fallbackHeight,
    cameraFeed,
    facingMode,
    shouldMirrorUserFacing,
    sourceRect,
  });

  if (!photoCanvas) {
    return canvasToBlob(fallbackCanvas, "image/jpeg");
  }

  const webpBlob = await canvasToBlob(photoCanvas, "image/webp");
  if (webpBlob?.type === "image/webp") {
    return webpBlob;
  }

  return canvasToBlob(photoCanvas, "image/jpeg");
}

function stopCurrentStream({ preserveResumeIntent = shouldResumeCameraOnForeground } = {}) {
  shouldResumeCameraOnForeground = preserveResumeIntent;
  invalidateCameraResumeChecks();
  cancelScheduledCameraResume();
  pauseCameraPreview();
  cameraController.stopStream();
}

function destroyApp() {
  if (isAppDestroyed) {
    return;
  }

  isAppDestroyed = true;
  clearScheduledViewportHeightSync();
  stopCurrentStream({ preserveResumeIntent: false });
  swatchSliderUi.destroy?.();
  zoomUi?.destroy?.();
  exposureUi?.destroy?.();
  cameraController.destroy?.();
  paletteExtractionWorker.destroy();
  performanceHud.destroy?.();
  unsubscribeFromAppSettings();
  unsubscribeFromAppSettings = () => {};
  clearManagedEventListeners();
  clearPhotoOutput();
}

initializeApp();
