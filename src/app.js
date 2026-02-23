import { createCameraController } from './modules/camera-controller.js';
import {
  drawFrameToCanvas,
  renderOutputSwatches,
  setCaptureState,
  updateSliderTooltip,
  updateZoomText,
} from './modules/camera-ui.js';
import {
  extractPaletteColors,
  renderPaletteBars,
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_ROW_COUNT,
  smoothColors,
} from './modules/palette-extraction.js';
import { savePalette } from './palette-storage.js';

const PHOTO_EXPORT_WIDTH = 200;
const PHOTO_PIXEL_DENSITY = 3;

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

const SWATCH_ACTIVE_PULSE_MS = 170;
const CAPTURE_POP_MS = 170;
const CAPTURE_FLASH_MS = 120;
const DOMINANT_COLOR_CLUSTER_DISTANCE = 30;
const CAPTURE_KEYBOARD_KEYS = new Set(['Enter', ' ', 'Spacebar']);
const PREVIEW_TOGGLE_KEYS = new Set(['Enter', ' ', 'Spacebar']);
const SWATCH_KEYBOARD_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const frameContext = frameCanvas?.getContext('2d', { willReadFrequently: true }) ?? frameCanvas?.getContext('2d');
const paletteContext = paletteCanvas?.getContext('2d');

let frameWidth = 0;
let frameHeight = 0;
let isStreaming = false;
let swatchCount = Number(swatchSlider?.value) || 4;
let captureFlashElement = null;
let capturePopTimeout = 0;
let captureFlashTimeout = 0;
let lastCaptureGlowRgb = '';
let lastNameColor = '';
let isPreviewExpanded = false;
let extractionFrame = 0;
let lastExtractedColors = null;
let lastChosenIndices = [];
const EXTRACTION_INTERVAL = 10;

function toRgbToken(color) {
  return `${color.r}, ${color.g}, ${color.b}`;
}

function getColorDistanceSquared(firstColor, secondColor) {
  const deltaR = firstColor.r - secondColor.r;
  const deltaG = firstColor.g - secondColor.g;
  const deltaB = firstColor.b - secondColor.b;

  return (deltaR * deltaR) + (deltaG * deltaG) + (deltaB * deltaB);
}

function getColorLuma(color) {
  return (0.2126 * color.r) + (0.7152 * color.g) + (0.0722 * color.b);
}

function getDominantColor(colors) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return null;
  }

  const clusterDistanceSquared = DOMINANT_COLOR_CLUSTER_DISTANCE ** 2;
  const colorClusters = [];

  colors.forEach((color) => {
    let matchingCluster = null;

    for (const cluster of colorClusters) {
      if (getColorDistanceSquared(color, cluster) <= clusterDistanceSquared) {
        matchingCluster = cluster;
        break;
      }
    }

    if (!matchingCluster) {
      colorClusters.push({
        r: color.r,
        g: color.g,
        b: color.b,
        totalR: color.r,
        totalG: color.g,
        totalB: color.b,
        count: 1,
      });
      return;
    }

    matchingCluster.totalR += color.r;
    matchingCluster.totalG += color.g;
    matchingCluster.totalB += color.b;
    matchingCluster.count += 1;
    matchingCluster.r = Math.round(matchingCluster.totalR / matchingCluster.count);
    matchingCluster.g = Math.round(matchingCluster.totalG / matchingCluster.count);
    matchingCluster.b = Math.round(matchingCluster.totalB / matchingCluster.count);
  });

  colorClusters.sort((firstCluster, secondCluster) => {
    if (secondCluster.count !== firstCluster.count) {
      return secondCluster.count - firstCluster.count;
    }

    return getColorLuma(secondCluster) - getColorLuma(firstCluster);
  });

  return colorClusters[0];
}

function setNameColor(color){
  if( !colorscatcher || !color) { return; }
  const rgbToken = toRgbToken(color);

  if (rgbToken === lastNameColor) { return; }

  colorscatcher.style.setProperty('--name-rgba', rgbToken);
  lastNameColor = rgbToken;
}

function setCaptureButtonGlowColor(color) {
  if (!captureButton || !color) {
    return;
  }

  const rgbToken = toRgbToken(color);
  if (rgbToken === lastCaptureGlowRgb) {
    return;
  }

  captureButton.style.setProperty('--capture-glow-rgb', rgbToken);
  lastCaptureGlowRgb = rgbToken;
}

function setCaptureGlowActive(isActive) {
  captureButton?.classList.toggle('is-catching', isActive);
}

function pulseCaptureButton() {
  if (!captureButton) {
    return;
  }

  captureButton.classList.remove('is-pop');
  void captureButton.offsetWidth;
  captureButton.classList.add('is-pop');

  if (capturePopTimeout) {
    window.clearTimeout(capturePopTimeout);
  }

  capturePopTimeout = window.setTimeout(() => {
    captureButton.classList.remove('is-pop');
    capturePopTimeout = 0;
  }, CAPTURE_POP_MS);

}

function ensureCaptureFlashElement() {
  if (!captureContainer) {
    return null;
  }

  if (captureFlashElement?.isConnected) {
    return captureFlashElement;
  }

  const nextFlashElement = document.createElement('div');
  nextFlashElement.className = 'capture-flash';
  captureContainer.appendChild(nextFlashElement);
  captureFlashElement = nextFlashElement;
  return captureFlashElement;
}

function triggerCaptureFlash() {
  const flashElement = ensureCaptureFlashElement();
  if (!flashElement) {
    return;
  }

  flashElement.classList.remove('is-active');
  void flashElement.offsetWidth;
  flashElement.classList.add('is-active');

  if (captureFlashTimeout) {
    window.clearTimeout(captureFlashTimeout);
  }

  captureFlashTimeout = window.setTimeout(() => {
    flashElement.classList.remove('is-active');
    captureFlashTimeout = 0;
  }, CAPTURE_FLASH_MS);
}

function formatZoomScaleValue(value) {
  return `${value.toFixed(1)}x`;
}

function updateZoomScaleBounds(minValue, maxValue) {
  const safeMin = Number.isFinite(minValue) ? minValue : 1;
  const safeMax = Number.isFinite(maxValue) ? maxValue : safeMin;

  if (zoomMinDisplay) {
    zoomMinDisplay.textContent = formatZoomScaleValue(safeMin);
  }

  if (zoomMaxDisplay) {
    zoomMaxDisplay.textContent = formatZoomScaleValue(safeMax);
  }
}

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

let overlayBuilt = false;

function buildSampleGrid() {
  if (!sampleRowOverlay || overlayBuilt) {
    return;
  }
  overlayBuilt = true;

  for (let row = 0; row < SAMPLE_ROW_COUNT; row++) {
    const rowPercent = ((row + 1) / (SAMPLE_ROW_COUNT + 1)) * 100;

    const line = document.createElement('div');
    line.className = 'sample-row-line';
    line.style.top = `${rowPercent}%`;
    sampleRowOverlay.appendChild(line);

    for (let col = 0; col < SAMPLE_COL_COUNT; col++) {
      const square = document.createElement('div');
      square.className = 'sample-row-point';
      square.dataset.gridIndex = String(col * SAMPLE_ROW_COUNT + row);
      square.style.left = `${((col + 0.5) / SAMPLE_COL_COUNT) * 100}%`;
      square.style.top = `${rowPercent}%`;
      sampleRowOverlay.appendChild(square);
    }
  }

  updateSamplePointSizes();
}

function markChosenSquares(chosenIndices) {
  if (!sampleRowOverlay) return;

  const chosenSet = new Set(chosenIndices.map(String));
  sampleRowOverlay.querySelectorAll('.sample-row-point').forEach((el) => {
    el.classList.toggle('is-chosen', chosenSet.has(el.dataset.gridIndex));
  });
}

function updateSamplePointSizes() {
  if (!sampleRowOverlay || !cameraFeed) {
    return;
  }

  const videoWidth = cameraFeed.videoWidth;
  if (videoWidth <= 0) {
    return;
  }

  const displayWidth = sampleRowOverlay.offsetWidth;
  const scale = displayWidth / videoWidth;
  const size = Math.max(2, Math.round(SAMPLE_DIAMETER * scale));

  sampleRowOverlay.style.setProperty('--sample-size', `${size}px`);
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
  isPreviewExpanded = nextExpandedState;

  captureContainer.classList.toggle('is-preview-expanded', nextExpandedState);
  document.body.classList.toggle('is-preview-expanded', nextExpandedState);
  captureCameraStage?.setAttribute('aria-hidden', String(!nextExpandedState));
  cameraFeed?.setAttribute('aria-expanded', String(nextExpandedState));

  mountCameraFeed(nextExpandedState ? cameraStageMount : cameraPreviewDock);
  syncCameraFeedOrientation();
}

function togglePreviewExpanded() {
  setPreviewExpanded(!isPreviewExpanded);
}

const cameraController = createCameraController({
  cameraFeed,
  onCameraActiveChange: (isCameraActive) => {
    syncCameraFeedOrientation();
    setCaptureState({ btnOn, btnShoot, isCameraActive });

    if (!isCameraActive) {
      setZoomWheelDisabled();
      setCaptureGlowActive(false);
    } else {
      syncZoomWheelCapabilities();
    }

    if (!isCameraActive) {
      isStreaming = false;
    }
  },
  onZoomChange: (zoomValue) => {
    updateZoomText(zoomDisplay, zoomValue);

    if (zoomWheel) {
      zoomWheel.value = String(zoomValue);
    }
  },
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

  setPreviewExpanded(false);
  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindPreviewEvents();
  bindZoomEvents();
  bindRotationEvents();
  bindSwatchEvents();
  syncCameraFeedOrientation();

  updateZoomText(zoomDisplay, cameraController.getCurrentZoom());
  updateZoomScaleBounds(Number(zoomWheel?.min), Number(zoomWheel?.max));
  setZoomWheelDisabled();
  updateSliderTooltip(swatchSlider, swatchCount);
  setCaptureState({ btnOn, btnShoot, isCameraActive: false });
  photoOutput?.removeAttribute('src');
  renderOutputSwatches(outputPalette, []);
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

  captureButton.addEventListener('pointerdown', pulseCaptureButton);
  captureButton.addEventListener('keydown', (event) => {
    if (CAPTURE_KEYBOARD_KEYS.has(event.key)) {
      pulseCaptureButton();
    }
  });

  captureButton.addEventListener('click', (event) => {
    event.preventDefault();

    if (!isStreaming || frameWidth <= 0 || frameHeight <= 0) {
      void startCameraStream();
      return;
    }

    void captureCurrentFrame();
  });
}

function bindPreviewEvents() {
  if (!cameraFeed) {
    return;
  }

  cameraFeed.addEventListener('click', (event) => {
    event.preventDefault();
    togglePreviewExpanded();
  });

  cameraFeed.addEventListener('keydown', (event) => {
    if (!PREVIEW_TOGGLE_KEYS.has(event.key)) {
      return;
    }

    event.preventDefault();
    togglePreviewExpanded();
  });
}

function bindZoomEvents() {
  if (!zoomWheel) {
    return;
  }

  zoomWheel.addEventListener('input', (event) => {
    const nextZoom = Number(event.target.value);
    if (!Number.isFinite(nextZoom)) {
      return;
    }

    updateZoomText(zoomDisplay, nextZoom);
    void cameraController.applyZoom(nextZoom);
  });
}

function syncZoomTickMarks() {
  if (!zoomWheel) {
    return;
  }

  const min = Number(zoomWheel.min);
  const max = Number(zoomWheel.max);
  const step = Number(zoomWheel.step);

  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) {
    return;
  }

  const intervals = Math.max(1, Math.floor(((max - min) / step) + Number.EPSILON));
  zoomWheel.style.setProperty('--zoom-intervals', String(intervals));
  zoomWheelContainer?.style.setProperty('--zoom-intervals', String(intervals));
  zoomPanel?.style.setProperty('--zoom-intervals', String(intervals));
}

function setZoomWheelDisabled() {
  if (!zoomWheel) {
    return;
  }

  zoomWheel.setAttribute('disabled', '');
  updateZoomScaleBounds(Number(zoomWheel.min), Number(zoomWheel.max));
}

function syncZoomWheelCapabilities() {
  if (!zoomWheel) {
    return;
  }

  const zoomCapabilities = cameraController.getZoomCapabilities?.();
  const minZoom = Number(zoomCapabilities?.min);
  const maxZoom = Number(zoomCapabilities?.max);
  const stepZoom = Number(zoomCapabilities?.step);
  const hasZoomCapabilities = Number.isFinite(minZoom)
    && Number.isFinite(maxZoom)
    && maxZoom > minZoom;

  if (!hasZoomCapabilities) {
    setZoomWheelDisabled();
    return;
  }

  const safeStep = Number.isFinite(stepZoom) && stepZoom > 0 ? stepZoom : 0.1;
  const currentZoom = cameraController.getCurrentZoom();
  const clampedZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom));

  zoomWheel.min = String(minZoom);
  zoomWheel.max = String(maxZoom);
  zoomWheel.step = String(safeStep);
  zoomWheel.value = String(clampedZoom);
  zoomWheel.removeAttribute('disabled');
  updateZoomScaleBounds(minZoom, maxZoom);
  syncZoomTickMarks();
}

function bindRotationEvents() {
  rotateButton?.addEventListener('click', async () => {
    isStreaming = false;
    await cameraController.toggleFacingMode();
  });
}

function bindSwatchEvents() {
  if (!swatchSlider) {
    return;
  }

  const sliderPanel = swatchSlider.closest('.swatch-slider');
  let activePulseTimeout = 0;

  const setDragState = (isDragging) => {
    sliderPanel?.classList.toggle('is-dragging', isDragging);
  };

  const pulseActiveIndicator = () => {
    if (!sliderPanel) {
      return;
    }

    sliderPanel.classList.add('is-active');

    if (activePulseTimeout) {
      window.clearTimeout(activePulseTimeout);
    }

    activePulseTimeout = window.setTimeout(() => {
      sliderPanel.classList.remove('is-active');
      activePulseTimeout = 0;
    }, SWATCH_ACTIVE_PULSE_MS);
  };

  swatchSlider.addEventListener('pointerdown', () => {
    setDragState(true);
    pulseActiveIndicator();
    window.addEventListener('pointerup', () => setDragState(false), { once: true });
  });

  swatchSlider.addEventListener('pointercancel', () => setDragState(false));
  swatchSlider.addEventListener('blur', () => setDragState(false));
  swatchSlider.addEventListener('keydown', (event) => {
    if (SWATCH_KEYBOARD_KEYS.has(event.key)) {
      pulseActiveIndicator();
    }
  });

  swatchSlider.addEventListener('input', (event) => {
    const nextSwatchCount = Number(event.target.value);

    if (!Number.isFinite(nextSwatchCount) || nextSwatchCount < 1) {
      return;
    }

    swatchCount = nextSwatchCount;
    updateSliderTooltip(swatchSlider, swatchCount);
    pulseActiveIndicator();
  });
}

async function startCameraStream() {
  isStreaming = false;
  const started = await cameraController.startStream();

  if (started) {
    syncZoomWheelCapabilities();
  }
}

function handleCameraCanPlay() {
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

  buildSampleGrid();
  updateSamplePointSizes();

  extractionFrame += 1;
  if (extractionFrame % EXTRACTION_INTERVAL === 1 || !lastExtractedColors) {
    const frameImageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;

    const result = extractPaletteColors(
      frameImageData,
      frameWidth,
      frameHeight,
      swatchCount
    );

    lastExtractedColors = result.colors;
    lastChosenIndices = result.chosenIndices;
    markChosenSquares(lastChosenIndices);
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
    setCaptureButtonGlowColor(dominantColor);
    setNameColor(dominantColor)
    setCaptureGlowActive(true);
  } else {
    setCaptureGlowActive(false);
  }

  requestAnimationFrame(refreshPreview);
}

async function captureCurrentFrame() {
  if (!frameContext || frameWidth <= 0 || frameHeight <= 0) {
    return;
  }

  triggerCaptureFlash();

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
  const { colors: paletteColors } = extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount);

  const photoData = exportPhotoData(frameCanvas, frameWidth, frameHeight);

  photoOutput.setAttribute('src', photoData);
  renderOutputSwatches(outputPalette, paletteColors);

  if (paletteColors.length > 0) {
    try {
      await savePalette(paletteColors, photoData);
    } catch (error) {
      console.error('Failed to save palette:', error);
    }
  }
}

function exportPhotoData(sourceCanvas, sourceWidth, sourceHeight) {
  const photoCanvas = document.createElement('canvas');
  const photoContext = photoCanvas.getContext('2d');

  if (!photoContext) {
    return sourceCanvas.toDataURL('image/webp', 0.9);
  }

  const photoHeight = (sourceHeight / sourceWidth) * PHOTO_EXPORT_WIDTH;

  photoCanvas.width = PHOTO_EXPORT_WIDTH * PHOTO_PIXEL_DENSITY;
  photoCanvas.height = photoHeight * PHOTO_PIXEL_DENSITY;

  photoContext.drawImage(
    sourceCanvas,
    0,
    0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    photoCanvas.width,
    photoCanvas.height
  );

  return photoCanvas.toDataURL('image/webp', 0.9);
}

function stopCurrentStream() {
  isStreaming = false;
  setCaptureGlowActive(false);

  if (captureFlashTimeout) {
    window.clearTimeout(captureFlashTimeout);
    captureFlashTimeout = 0;
  }

  cameraController.stopStream();
}

window.addEventListener('beforeunload', stopCurrentStream);

initializeApp();

// DEV: test palette extraction with a static image instead of the camera feed
function _loadTestImage(src) {
  if (!frameContext || !paletteContext || !frameCanvas || !paletteCanvas) {
    return;
  }

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

    buildSampleGrid();
    updateSamplePointSizes();

    const { colors, chosenIndices } = extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount);

    markChosenSquares(chosenIndices);
    renderPaletteBars(paletteContext, colors, paletteCanvas.width, paletteCanvas.height);
    renderOutputSwatches(outputPalette, colors);

    // Show the test image in the camera preview and output photo
    cameraFeed.setAttribute('poster', src);
    cameraFeed.style.objectFit = 'cover';
    photoOutput.setAttribute('src', exportPhotoData(frameCanvas, frameWidth, frameHeight));

    console.log('Test image palette:', colors);
  };
}

// loadTestImage('assets/img/test-img.webp');
