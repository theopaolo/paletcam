import { getAppSettings, subscribeAppSettings } from './app-settings.js';
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
import { openCollectionPanel } from './collection-ui.js';
import { savePalette } from './palette-storage.js';

const PHOTO_EXPORT_MAX_WIDTH = 1440;

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
  if (!cameraFeed) {
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
  if (!cameraFeed || !targetElement || cameraFeed.parentElement === targetElement) {
    return;
  }

  targetElement.appendChild(cameraFeed);

  if (sampleRowOverlay) {
    targetElement.appendChild(sampleRowOverlay);
  }
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
  cameraFeed?.setAttribute('aria-expanded', String(nextExpandedState));

  mountCameraFeed(nextExpandedState ? cameraStageMount : cameraPreviewDock);
  syncCameraFeedOrientation();
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

  applyAppSettings(getAppSettings());
  setPreviewExpanded(true);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindMiniOutputEvents();
  zoomUi.bindEvents();
  bindRotationEvents();
  swatchSliderUi.bindEvents();
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

  allowButton?.addEventListener('click', startCameraStream);
  allowText?.addEventListener('click', startCameraStream);
}

function bindCaptureEvents() {
  cameraFeed.addEventListener('canplay', handleCameraCanPlay);

  captureButton.addEventListener('pointerdown', captureMicroInteractions.pulseCaptureButton);

  captureButton.addEventListener('click', (event) => {
    event.preventDefault();

    if (!isStreaming || frameWidth <= 0 || frameHeight <= 0) {
      void startCameraStream();
      return;
    }

    void captureCurrentFrame();
  });
}

function getMiniOutputPaletteId() {
  const paletteId = Number(photoOutput?.dataset.paletteId);
  return Number.isFinite(paletteId) ? paletteId : null;
}

function bindMiniOutputEvents() {
  if (!photoOutput) {
    return;
  }

  photoOutput.addEventListener('click', () => {
    if (!photoOutput.getAttribute('src')) {
      return;
    }

    void openCollectionPanel({
      paletteId: getMiniOutputPaletteId(),
      openPaletteViewer: Boolean(getMiniOutputPaletteId()),
    });
  });
}

function bindRotationEvents() {
  rotateButton?.addEventListener('click', async () => {
    isStreaming = false;
    await cameraController.toggleFacingMode();
  });
}

async function startCameraStream() {
  if (_testImageMode) {
    return;
  }

  isStreaming = false;
  const started = await cameraController.startStream();

  // loadTestImage may have activated test mode while we were awaiting the stream
  if (_testImageMode) {
    cameraController.stopStream();
    return;
  }

  if (started) {
    zoomUi.syncCapabilities();
  }
}

function handleCameraCanPlay() {
  if (_testImageMode) {
    return;
  }

  const { width: nextFrameWidth } = getPaletteViewportSize();
  if (nextFrameWidth <= 0 || cameraFeed.videoWidth <= 0 || cameraFeed.videoHeight <= 0) {
    return;
  }

  frameWidth = nextFrameWidth;
  const aspectRatio = cameraFeed.videoHeight / cameraFeed.videoWidth;
  frameHeight = Math.floor(frameWidth * aspectRatio);

  cameraFeed.setAttribute('width', String(frameWidth));
  cameraFeed.setAttribute('height', String(frameHeight));
  frameCanvas.setAttribute('width', String(frameWidth));
  frameCanvas.setAttribute('height', String(frameHeight));

  if (!isStreaming) {
    isStreaming = true;
    requestAnimationFrame(refreshPreview);
  }
}

function refreshPreview() {
  if (!isStreaming || !frameContext || !paletteContext) {
    return;
  }

  const { width: paletteWidth, height: paletteHeight } = getPaletteViewportSize();
  if (paletteWidth <= 0 || paletteHeight <= 0 || cameraFeed.videoWidth <= 0 || cameraFeed.videoHeight <= 0) {
    requestAnimationFrame(refreshPreview);
    return;
  }

  frameWidth = paletteWidth;
  const aspectRatio = cameraFeed.videoHeight / cameraFeed.videoWidth;
  frameHeight = Math.floor(frameWidth * aspectRatio);

  const nextCanvasWidth = frameWidth;
  const nextCanvasHeight = frameHeight;

  if (frameCanvas.width !== nextCanvasWidth || frameCanvas.height !== nextCanvasHeight) {
    frameCanvas.width = nextCanvasWidth;
    frameCanvas.height = nextCanvasHeight;
  }

  if (
    paletteCanvas.width !== nextCanvasWidth ||
    paletteCanvas.height !== paletteHeight
  ) {
    paletteCanvas.width = nextCanvasWidth;
    paletteCanvas.height = paletteHeight;
  }

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode: cameraController.getFacingMode(),
    shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
  });

  const isGridMode = isGridExtractionMode();

  if (isGridMode) {
    sampleGridOverlay.setVisible(true);
    sampleGridOverlay.ensureBuilt();
    sampleGridOverlay.updatePointSizes();
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
    requestAnimationFrame(refreshPreview);
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

  requestAnimationFrame(refreshPreview);
}

async function captureCurrentFrame() {
  if (!frameContext || frameWidth <= 0 || frameHeight <= 0) {
    return;
  }

  captureMicroInteractions.triggerCaptureFlash();

  frameCanvas.width = frameWidth;
  frameCanvas.height = frameHeight;

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode: cameraController.getFacingMode(),
    shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
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
    facingMode: cameraController.getFacingMode(),
    shouldMirrorUserFacing: shouldMirrorUserFacingCamera(),
  });

  photoOutput.setAttribute('src', photoData);
  renderOutputSwatches(outputPalette, paletteColors);

  if (paletteColors.length > 0) {
    try {
      const savedPalette = await savePalette(paletteColors, photoData);
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

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return fallbackCanvas.toDataURL('image/webp', photoExportQuality);
  }

  const photoWidth = Math.min(sourceWidth, PHOTO_EXPORT_MAX_WIDTH);
  const photoHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * photoWidth));

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
  visualEffects.setCaptureGlowActive(false);
  captureMicroInteractions.cleanup();

  cameraController.stopStream();
}

window.addEventListener('beforeunload', stopCurrentStream);
subscribeAppSettings(applyAppSettings);

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
