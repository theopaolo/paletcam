import { getAppSettings, subscribeAppSettings } from './app-settings.js';
import { openCollectionPanel } from './collection-ui.js';
import { createCameraController } from './modules/camera-controller.js';
import {
  drawFrameToCanvas,
  renderOutputSwatches,
  setCaptureState,
} from './modules/camera-ui.js';
import { createCaptureMicroInteractions } from './modules/micro-interactions.js';
import {
  extractPaletteColors,
  getDominantColor,
  getPaletteExtractionAlgorithm,
  PALETTE_EXTRACTION_ALGORITHMS,
  renderPaletteBars,
  setPaletteExtractionAlgorithm,
  smoothColors,
} from './modules/palette-extraction.js';
import { createSampleGridOverlayController } from './modules/sample-grid-overlay.js';
import { createSwatchSliderUiController } from './modules/swatch-slider-ui.js';
import { createVisualEffects } from './modules/visual-effects.js';
import { createZoomUiController } from './modules/zoom-ui.js';
import { savePalette } from './palette-storage.js';

const PHOTO_EXPORT_MAX_WIDTH = 1440;
const CAMERA_FRAME_ASPECT_RATIO = 4 / 3;
const CAMERA_FRAME_ASPECT_RATIO_LABEL = '4:3';

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function supportsCameraTrackZoomConstraint() {
  return Boolean(navigator.mediaDevices?.getSupportedConstraints?.().zoom);
}

const colorscatcher = document.querySelector('.colorscatcher');
const cameraFeed = document.querySelector('.camera-feed');
const captureButton = document.querySelector('.btn-capture');
const allowButton = document.querySelector('.btn-allow-media');
const allowText = document.querySelector('.allow-container span');
const captureContainer = document.querySelector('.capture');
const capturePaletteStage = document.querySelector('.capture-palette-stage');
const captureCameraStage = document.querySelector('.capture-camera-stage');
const cameraStageMount = document.getElementById('cameraStageMount');
const cameraPreviewDock = document.getElementById('cameraPreviewDock');
const photoOutput = document.getElementById('photo');
const outputPalette = document.getElementById('outputPalette');
const frameCanvas = document.getElementById('canvas');
const paletteCanvas = document.getElementById('canvas-palette');
const zoomWheel = document.querySelector('.zoom-wheel');
const zoomWheelContainer = document.querySelector('.wheel-range');
const zoomPanel = document.querySelector('.zoom-btns');
const zoomDisplay = document.querySelector('.zoom-display');
const zoomMinDisplay = document.querySelector('.zoom-scale-min');
const zoomMaxDisplay = document.querySelector('.zoom-scale-max');
const rotateButton = document.querySelector('.btn-rotate');
const swatchSlider = document.querySelector('.swatch-slider input[type="range"]');
const btnOn = document.querySelector('.btn-on');
const btnShoot = document.querySelector('.btn-shoot');
const sampleRowOverlay = document.getElementById('sampleRowOverlay');
const cameraViewportFrame = document.createElement('div');
const cameraSourceMount = document.createElement('div');
const isIOS = isIOSDevice();
const shouldUseCanvasPreview = isIOS;
const cameraPreviewSurface = shouldUseCanvasPreview ? frameCanvas : cameraFeed;
const shouldHideZoomUi = isIOS || !supportsCameraTrackZoomConstraint();

if (shouldHideZoomUi) {
  document.documentElement.classList.add('hide-zoom-ui');
}

if (shouldUseCanvasPreview) {
  document.documentElement.classList.add('use-canvas-camera-preview');
  cameraSourceMount.className = 'camera-source-mount';
  cameraPreviewSurface?.classList.add('camera-feed-canvas');
  cameraPreviewSurface?.setAttribute('aria-label', 'Aperçu caméra');
  cameraPreviewSurface?.setAttribute('role', 'img');
  cameraFeed?.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cameraSourceMount);
  if (cameraFeed) {
    cameraSourceMount.appendChild(cameraFeed);
  }
}

const frameContext = frameCanvas?.getContext('2d', { willReadFrequently: true }) ?? frameCanvas?.getContext('2d');
const paletteContext = paletteCanvas?.getContext('2d');

let frameWidth = 0;
let frameHeight = 0;
let isStreaming = false;
let _testImageMode = false;
let swatchCount = Number(swatchSlider?.value) || 4;
let _isPreviewExpanded = false;
let extractionFrame = 0;
let lastExtractedColors = null;
let lastChosenIndices = [];
let photoExportQuality = getAppSettings().photoExportQuality;
let gridExtractionSettings = { ...getAppSettings().grid };
let medianCutExtractionSettings = { ...getAppSettings().medianCut };
let paletteScoringSettings = { ...getAppSettings().paletteScoring };
const EXTRACTION_INTERVAL = 10;
let lastCameraViewportLayout = null;
let cachedPaletteWidth = 0;
let cachedPaletteHeight = 0;
let previewFrameRequestId = 0;
let unsubscribeFromAppSettings = () => {};
const appEventCleanups = [];
let isAppDestroyed = false;

cameraViewportFrame.className = 'camera-feed-frame';
const captureMicroInteractions = createCaptureMicroInteractions({
  captureButton,
  captureContainer,
});
const visualEffects = createVisualEffects({
  captureButton,
  nameElement: colorscatcher,
});
const sampleGridOverlay = createSampleGridOverlayController({
  overlayElement: sampleRowOverlay,
  cameraFeed,
});
const swatchSliderUi = createSwatchSliderUiController({
  swatchSlider,
  onSwatchCountChange: (nextSwatchCount) => {
    swatchCount = nextSwatchCount;
  },
});

function shouldMirrorUserFacingCamera() {
  if (cameraController.getFacingMode() !== 'user') {
    return false;
  }

  // Keep mirror behavior for touch-first devices, but disable it on desktop.
  return window.matchMedia?.('(any-pointer: coarse)').matches ?? false;
}

function syncCameraFeedOrientation() {
  if (shouldUseCanvasPreview || !cameraFeed) {
    return;
  }

  cameraFeed.style.transform = shouldMirrorUserFacingCamera() ? 'scaleX(-1)' : 'scaleX(1)';
}

function getPaletteViewportSize() {
  const paletteViewport = capturePaletteStage ?? captureContainer;

  return {
    width: paletteViewport?.clientWidth ?? 0,
    height: paletteViewport?.clientHeight ?? 0,
  };
}

function bindManagedEventListener(target, eventName, listener, options) {
  if (!target || typeof target.addEventListener !== 'function') {
    return;
  }

  target.addEventListener(eventName, listener, options);
  appEventCleanups.push(() => {
    target.removeEventListener(eventName, listener, options);
  });
}

function clearManagedEventListeners() {
  while (appEventCleanups.length > 0) {
    const cleanup = appEventCleanups.pop();
    cleanup?.();
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

  previewFrameRequestId = window.requestAnimationFrame(() => {
    previewFrameRequestId = 0;
    refreshPreview();
  });
}

function updateCachedPreviewDimensions() {
  const { width: nextPaletteWidth, height: nextPaletteHeight } = getPaletteViewportSize();
  if (nextPaletteWidth <= 0 || nextPaletteHeight <= 0) {
    cachedPaletteWidth = 0;
    cachedPaletteHeight = 0;
    frameWidth = 0;
    frameHeight = 0;
    return false;
  }

  cachedPaletteWidth = nextPaletteWidth;
  cachedPaletteHeight = nextPaletteHeight;
  frameWidth = nextPaletteWidth;
  frameHeight = getTargetFrameHeight(frameWidth);

  if (!cameraFeed || !frameCanvas || !paletteCanvas || frameWidth <= 0 || frameHeight <= 0) {
    return false;
  }

  cameraFeed.setAttribute('width', String(frameWidth));
  cameraFeed.setAttribute('height', String(frameHeight));

  if (frameCanvas.width !== frameWidth || frameCanvas.height !== frameHeight) {
    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;
  }

  if (paletteCanvas.width !== frameWidth || paletteCanvas.height !== cachedPaletteHeight) {
    paletteCanvas.width = frameWidth;
    paletteCanvas.height = cachedPaletteHeight;
  }

  sampleGridOverlay.updatePointSizes();
  return true;
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

function getCenteredAspectCropRect(sourceWidth, sourceHeight, targetAspectRatio = CAMERA_FRAME_ASPECT_RATIO) {
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
  return getCenteredAspectCropRect(
    cameraFeed?.videoWidth ?? 0,
    cameraFeed?.videoHeight ?? 0
  );
}

function roundNormalizedCropValue(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toNormalizedCropRect(sourceRect, sourceWidth, sourceHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const safeRect = (
    sourceRect &&
    sourceRect.width > 0 &&
    sourceRect.height > 0
  )
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
    CAMERA_FRAME_ASPECT_RATIO
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

function isGridExtractionMode() {
  return getPaletteExtractionAlgorithm() === PALETTE_EXTRACTION_ALGORITHMS.GRID;
}

function getPaletteExtractionOptions() {
  return {
    algorithm: getPaletteExtractionAlgorithm(),
    grid: { ...gridExtractionSettings },
    medianCut: { ...medianCutExtractionSettings },
    scoring: { ...paletteScoringSettings },
  };
}

function applyAppSettings({
  photoExportQuality: nextPhotoExportQuality,
  paletteExtractionAlgorithm,
  grid,
  medianCut,
  paletteScoring,
}) {
  photoExportQuality = nextPhotoExportQuality;
  gridExtractionSettings = { ...grid };
  medianCutExtractionSettings = { ...medianCut };
  paletteScoringSettings = { ...paletteScoring };
  setPaletteExtractionAlgorithm(paletteExtractionAlgorithm);
  sampleGridOverlay.configureGrid({
    sampleColCount: gridExtractionSettings.sampleColCount,
    sampleRowCount: gridExtractionSettings.sampleRowCount,
    sampleDiameter: (gridExtractionSettings.sampleRadius * 2) + 1,
  });
  sampleGridOverlay.setVisible(isGridExtractionMode());
  extractionFrame = 0;
  lastExtractedColors = null;
  lastChosenIndices = [];
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

  if (sampleRowOverlay && sampleRowOverlay.parentElement !== cameraViewportFrame) {
    cameraViewportFrame.appendChild(sampleRowOverlay);
  }

  syncCameraViewportLayout();
}

function setPreviewExpanded(shouldExpand) {
  if (!captureContainer || !cameraStageMount || !cameraPreviewDock) {
    return;
  }

  const nextExpandedState = Boolean(shouldExpand);
  _isPreviewExpanded = nextExpandedState;

  captureContainer.classList.toggle('is-preview-expanded', nextExpandedState);
  document.body.classList.toggle('is-preview-expanded', nextExpandedState);
  captureCameraStage?.setAttribute('aria-hidden', String(!nextExpandedState));
  cameraPreviewSurface?.setAttribute('aria-expanded', String(nextExpandedState));

  mountCameraFeed(nextExpandedState ? cameraStageMount : cameraPreviewDock);
  syncCameraFeedOrientation();
  syncCameraViewportLayout();
  updateCachedPreviewDimensions();
}

let zoomUi = null;

const cameraController = createCameraController({
  cameraFeed,
  onCameraActiveChange: (isCameraActive) => {
    syncCameraFeedOrientation();
    setCaptureState({ btnOn, btnShoot, isCameraActive });

    if (!isCameraActive) {
      zoomUi?.setDisabled();
      visualEffects.setCaptureGlowActive(false);
    } else {
      zoomUi?.syncCapabilities();
    }

    if (!isCameraActive) {
      isStreaming = false;
    }
  },
  onZoomChange: (zoomValue) => {
    zoomUi?.handleZoomChange(zoomValue);
  },
});

zoomUi = createZoomUiController({
  cameraController,
  zoomWheel,
  zoomWheelContainer,
  zoomPanel,
  zoomDisplay,
  zoomMinDisplay,
  zoomMaxDisplay,
});

function handleCaptureButtonClick(event) {
  event.preventDefault();

  if (!isStreaming || frameWidth <= 0 || frameHeight <= 0) {
    void startCameraStream();
    return;
  }

  void captureCurrentFrame();
}

function handleMiniOutputClick() {
  if (!photoOutput?.getAttribute('src')) {
    return;
  }

  void openCollectionPanel({
    paletteId: getMiniOutputPaletteId(),
    openPaletteViewer: Boolean(getMiniOutputPaletteId()),
    closeCollectionOnViewerClose: Boolean(getMiniOutputPaletteId()),
  });
}

async function handleRotateButtonClick() {
  if (_testImageMode) {
    return;
  }

  stopCurrentStream();
  await cameraController.toggleFacingMode();
}

function handleWindowResize() {
  syncCameraViewportLayout();
  updateCachedPreviewDimensions();
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
    console.error('Missing required DOM elements for camera app initialization.');
    return;
  }

  isAppDestroyed = false;
  applyAppSettings(getAppSettings());
  setPreviewExpanded(true);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindMiniOutputEvents();
  zoomUi.bindEvents();
  bindRotationEvents();
  swatchSliderUi.bindEvents();
  bindManagedEventListener(window, 'beforeunload', handleWindowBeforeUnload);
  bindManagedEventListener(window, 'resize', handleWindowResize);
  unsubscribeFromAppSettings = subscribeAppSettings(applyAppSettings);
  syncCameraFeedOrientation();

  zoomUi.initialize();
  swatchSliderUi.initialize(swatchCount);
  setCaptureState({ btnOn, btnShoot, isCameraActive: false });
  photoOutput?.removeAttribute('src');
  renderOutputSwatches(outputPalette, []);
  photoOutput?.removeAttribute('data-palette-id');

  if (navigator.mediaDevices?.getUserMedia) {
    void startCameraStream();
  }
}

function bindCameraPermissionEvents() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  bindManagedEventListener(allowButton, 'click', startCameraStream);
  bindManagedEventListener(allowText, 'click', startCameraStream);
}

function bindCaptureEvents() {
  bindManagedEventListener(cameraFeed, 'canplay', handleCameraCanPlay);
  bindManagedEventListener(captureButton, 'pointerdown', captureMicroInteractions.pulseCaptureButton);
  bindManagedEventListener(captureButton, 'click', handleCaptureButtonClick);
}

function getMiniOutputPaletteId() {
  const paletteId = Number(photoOutput?.dataset.paletteId);
  return Number.isFinite(paletteId) ? paletteId : null;
}

function bindMiniOutputEvents() {
  if (!photoOutput) {
    return;
  }

  bindManagedEventListener(photoOutput, 'click', handleMiniOutputClick);
}

function bindRotationEvents() {
  bindManagedEventListener(rotateButton, 'click', handleRotateButtonClick);
}

async function startCameraStream() {
  if (_testImageMode) {
    return;
  }

  isStreaming = false;
  cancelPreviewRefresh();
  const started = await cameraController.startStream();

  // loadTestImage may have activated test mode while we were awaiting the stream
  if (_testImageMode) {
    stopCurrentStream();
    return;
  }

  if (started) {
    syncCameraViewportLayout();
    updateCachedPreviewDimensions();
    zoomUi.syncCapabilities();
  }
}

function handleCameraCanPlay() {
  if (_testImageMode) {
    return;
  }

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

function refreshPreview() {
  if (!isStreaming || !frameContext || !paletteContext) {
    return;
  }

  if (
    cachedPaletteWidth <= 0 ||
    cachedPaletteHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    cameraFeed.videoWidth <= 0 ||
    cameraFeed.videoHeight <= 0
  ) {
    schedulePreviewRefresh();
    return;
  }

  const nextCanvasWidth = frameWidth;
  const nextCanvasHeight = frameHeight;

  if (frameCanvas.width !== nextCanvasWidth || frameCanvas.height !== nextCanvasHeight) {
    frameCanvas.width = nextCanvasWidth;
    frameCanvas.height = nextCanvasHeight;
  }

  if (
    paletteCanvas.width !== nextCanvasWidth ||
    paletteCanvas.height !== cachedPaletteHeight
  ) {
    paletteCanvas.width = nextCanvasWidth;
    paletteCanvas.height = cachedPaletteHeight;
  }

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode: cameraController.getFacingMode(),
    shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
    sourceRect: getCameraFrameSourceRect(),
  });

  const isGridMode = isGridExtractionMode();

  if (isGridMode) {
    sampleGridOverlay.setVisible(true);
    sampleGridOverlay.ensureBuilt();
  } else {
    sampleGridOverlay.setVisible(false);
  }

  extractionFrame += 1;
  if (extractionFrame % EXTRACTION_INTERVAL === 1 || !lastExtractedColors) {
    const frameImageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;

    const result = extractPaletteColors(
      frameImageData,
      frameWidth,
      frameHeight,
      swatchCount,
      getPaletteExtractionOptions()
    );

    lastExtractedColors = result.colors;
    lastChosenIndices = result.chosenIndices;
    if (isGridMode) {
      sampleGridOverlay.markChosenSquares(lastChosenIndices);
    }
  }

  if (!lastExtractedColors || lastExtractedColors.length === 0) {
    schedulePreviewRefresh();
    return;
  }

  const smoothedColors = smoothColors(lastExtractedColors, 0.1);
  const dominantColor = getDominantColor(smoothedColors);

  renderPaletteBars(
    paletteContext,
    smoothedColors,
    paletteCanvas.width,
    paletteCanvas.height
  );

  if (dominantColor) {
    visualEffects.setCaptureButtonGlowColor(dominantColor);
    visualEffects.setNameColor(dominantColor);
    visualEffects.setCaptureGlowActive(true);
  } else {
    visualEffects.setCaptureGlowActive(false);
  }

  schedulePreviewRefresh();
}

async function captureCurrentFrame() {
  if (!frameContext || frameWidth <= 0 || frameHeight <= 0) {
    return;
  }

  captureMicroInteractions.triggerCaptureFlash();

  const facingMode = cameraController.getFacingMode();
  const shouldMirrorUserFacing = shouldMirrorUserFacingCamera();
  const captureSourceWidth = cameraFeed.videoWidth || frameWidth;
  const captureSourceHeight = cameraFeed.videoHeight || frameHeight;
  const captureSourceRect = getCenteredAspectCropRect(
    captureSourceWidth,
    captureSourceHeight
  );
  const captureCropRect = toNormalizedCropRect(
    captureSourceRect,
    captureSourceWidth,
    captureSourceHeight
  );

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

  const imageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;
  const { colors: paletteColors } = extractPaletteColors(
    imageData,
    frameWidth,
    frameHeight,
    swatchCount,
    getPaletteExtractionOptions()
  );

  const photoData = exportPhotoData({
    fallbackCanvas: frameCanvas,
    fallbackWidth: frameWidth,
    fallbackHeight: frameHeight,
    cameraFeed,
    facingMode,
    shouldMirrorUserFacing,
    sourceRect: captureSourceRect,
  });

  photoOutput.setAttribute('src', photoData);
  renderOutputSwatches(outputPalette, paletteColors);

  if (paletteColors.length > 0) {
    try {
      const masterPhotoData = exportPhotoData({
        fallbackCanvas: frameCanvas,
        fallbackWidth: frameWidth,
        fallbackHeight: frameHeight,
        cameraFeed,
        facingMode,
        shouldMirrorUserFacing,
        sourceRect: null,
      });

      const savedPalette = await savePalette(paletteColors, {
        photoDataUrl: masterPhotoData,
        captureAspectRatio: CAMERA_FRAME_ASPECT_RATIO_LABEL,
        captureCropRect,
      });
      if (savedPalette?.id !== undefined && savedPalette?.id !== null) {
        photoOutput.dataset.paletteId = String(savedPalette.id);
      } else {
        photoOutput.removeAttribute('data-palette-id');
      }
    } catch (error) {
      photoOutput.removeAttribute('data-palette-id');
      console.error('Failed to save palette:', error);
    }
  }
}

function exportPhotoData({
  fallbackCanvas,
  fallbackWidth,
  fallbackHeight,
  cameraFeed,
  facingMode,
  shouldMirrorUserFacing,
  sourceRect = undefined,
}) {
  const photoCanvas = document.createElement('canvas');
  const photoContext = photoCanvas.getContext('2d');

  if (!photoContext) {
    return fallbackCanvas.toDataURL('image/webp', photoExportQuality);
  }

  const hasNativeVideoFrame = Boolean(
    cameraFeed &&
    cameraFeed.videoWidth > 0 &&
    cameraFeed.videoHeight > 0
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
    return fallbackCanvas.toDataURL('image/webp', photoExportQuality);
  }

  const photoWidth = Math.min(exportSourceWidth, PHOTO_EXPORT_MAX_WIDTH);
  const photoHeight = Math.max(1, Math.round((exportSourceHeight / exportSourceWidth) * photoWidth));

  photoCanvas.width = photoWidth;
  photoCanvas.height = photoHeight;
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = 'high';

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
      photoHeight
    );
  }

  return photoCanvas.toDataURL('image/webp', photoExportQuality);
}

function stopCurrentStream() {
  isStreaming = false;
  cancelPreviewRefresh();
  visualEffects.setCaptureGlowActive(false);
  captureMicroInteractions.cleanup();

  cameraController.stopStream();
}

function destroyApp() {
  if (isAppDestroyed) {
    return;
  }

  isAppDestroyed = true;
  stopCurrentStream();
  swatchSliderUi.destroy?.();
  zoomUi?.destroy?.();
  cameraController.destroy?.();
  unsubscribeFromAppSettings();
  unsubscribeFromAppSettings = () => {};
  clearManagedEventListeners();
}

initializeApp();

// DEV: test palette extraction with a static image instead of the camera feed
function _loadTestImage(src) {
  if (!frameContext || !paletteContext || !frameCanvas || !paletteCanvas) {
    return;
  }

  // Prevent the camera from starting (or restarting) while testing with a static image
  _testImageMode = true;
  stopCurrentStream();
  cameraFeed?.removeEventListener('canplay', handleCameraCanPlay);

  const img = new Image();
  img.src = src;

  img.onload = () => {
    const { width: paletteWidth, height: paletteHeight } = getPaletteViewportSize();

    frameWidth = img.naturalWidth;
    frameHeight = img.naturalHeight;

    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;
    paletteCanvas.width = paletteWidth;
    paletteCanvas.height = paletteHeight;

    frameContext.drawImage(img, 0, 0, frameWidth, frameHeight);

    const imageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;

    const isGridMode = isGridExtractionMode();

    if (isGridMode) {
      sampleGridOverlay.setVisible(true);
      sampleGridOverlay.ensureBuilt();
      sampleGridOverlay.updatePointSizes();
    } else {
      sampleGridOverlay.setVisible(false);
    }

    const { colors, chosenIndices } = extractPaletteColors(
      imageData,
      frameWidth,
      frameHeight,
      swatchCount,
      getPaletteExtractionOptions()
    );

    if (isGridMode) {
      sampleGridOverlay.markChosenSquares(chosenIndices);
    }
    renderPaletteBars(paletteContext, colors, paletteCanvas.width, paletteCanvas.height);
    renderOutputSwatches(outputPalette, colors);

    // Show the test image in the camera preview and output photo
    cameraFeed.setAttribute('poster', src);
    cameraFeed.style.objectFit = 'cover';
    photoOutput.setAttribute('src', exportPhotoData({
      fallbackCanvas: frameCanvas,
      fallbackWidth: frameWidth,
      fallbackHeight: frameHeight,
      cameraFeed,
      facingMode: cameraController.getFacingMode(),
      shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
    }));

    console.log('Test image palette:', colors);
  };
}

// loadTestImage('assets/img/test-img.webp');
