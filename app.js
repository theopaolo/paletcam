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
  smoothColors
} from './modules/palette-extraction.js';
import { savePalette } from './palette-storage.js';

const PHOTO_EXPORT_WIDTH = 200;
const PHOTO_PIXEL_DENSITY = 3;

const cameraFeed = document.querySelector('.camera-feed');
const captureButton = document.querySelector('.btn-capture');
const allowButton = document.querySelector('.btn-allow-media');
const allowText = document.querySelector('.allow-container span');
const captureContainer = document.querySelector('.capture');
const photoOutput = document.getElementById('photo');
const outputPalette = document.getElementById('outputPalette');
const frameCanvas = document.getElementById('canvas');
const paletteCanvas = document.getElementById('canvas-palette');
const zoomWheel = document.querySelector('.zoom-wheel');
const zoomWheelContainer = document.querySelector('.wheel-range');
const zoomDisplay = document.querySelector('.zoom-display');
const rotateButton = document.querySelector('.btn-rotate');
const swatchSlider = document.querySelector('.swatch-slider input[type="range"]');
const btnOn = document.querySelector('.btn-on');
const btnShoot = document.querySelector('.btn-shoot');

const frameContext = frameCanvas?.getContext('2d', { willReadFrequently: true })
  ?? frameCanvas?.getContext('2d');
const paletteContext = paletteCanvas?.getContext('2d');

let frameWidth = 0;
let frameHeight = 0;
let isStreaming = false;
let swatchCount = Number(swatchSlider?.value) || 4;

const cameraController = createCameraController({
  cameraFeed,
  onCameraActiveChange: (isCameraActive) => {
    setCaptureState({ btnOn, btnShoot, isCameraActive });

    if (!isCameraActive) {
      setZoomWheelDisabled();
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
  if (!cameraFeed || !captureButton || !captureContainer || !frameCanvas || !paletteCanvas) {
    console.error('Missing required DOM elements for camera app initialization.');
    return;
  }

  bindCameraPermissionEvents();
  bindCaptureEvents();
  bindZoomEvents();
  bindRotationEvents();
  bindSwatchEvents();

  updateZoomText(zoomDisplay, cameraController.getCurrentZoom());
  setZoomWheelDisabled();
  updateSliderTooltip(swatchSlider, swatchCount);
  setCaptureState({ btnOn, btnShoot, isCameraActive: false });
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

  captureButton.addEventListener('click', (event) => {
    event.preventDefault();

    if (!isStreaming || frameWidth <= 0 || frameHeight <= 0) {
      void startCameraStream();
      return;
    }

    void captureCurrentFrame();
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
}

function setZoomWheelDisabled() {
  if (!zoomWheel) {
    return;
  }

  zoomWheel.setAttribute('disabled', '');
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
  syncZoomTickMarks();
}

function bindRotationEvents() {
  rotateButton?.addEventListener('click', async () => {
    isStreaming = false;
    await cameraController.toggleFacingMode();
  });
}

function bindSwatchEvents() {
  swatchSlider?.addEventListener('input', (event) => {
    const nextSwatchCount = Number(event.target.value);

    if (!Number.isFinite(nextSwatchCount) || nextSwatchCount < 1) {
      return;
    }

    swatchCount = nextSwatchCount;
    updateSliderTooltip(swatchSlider, swatchCount);
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
  frameWidth = captureContainer.clientWidth;
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

  const nextCanvasWidth = captureContainer.clientWidth;
  const nextCanvasHeight = cameraFeed.videoHeight;

  if (frameCanvas.width !== nextCanvasWidth || frameCanvas.height !== nextCanvasHeight) {
    frameCanvas.width = nextCanvasWidth;
    frameCanvas.height = nextCanvasHeight;
  }

  if (
    paletteCanvas.width !== nextCanvasWidth ||
    paletteCanvas.height !== captureContainer.clientHeight
  ) {
    paletteCanvas.width = nextCanvasWidth;
    paletteCanvas.height = captureContainer.clientHeight;
  }

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode: cameraController.getFacingMode(),
  });

  const frameImageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;

  const paletteColors = extractPaletteColors(
    frameImageData,
    frameWidth,
    frameHeight,
    swatchCount
  );


  const smoothedColors = smoothColors(paletteColors, 0.1);

  renderPaletteBars(
    paletteContext,
    smoothedColors,
    paletteCanvas.width,
    paletteCanvas.height
  );

  requestAnimationFrame(refreshPreview);
}

async function captureCurrentFrame() {
  if (!frameContext || frameWidth <= 0 || frameHeight <= 0) {
    return;
  }

  frameCanvas.width = frameWidth;
  frameCanvas.height = frameHeight;

  drawFrameToCanvas({
    context: frameContext,
    cameraFeed,
    width: frameWidth,
    height: frameHeight,
    facingMode: cameraController.getFacingMode(),
  });

  const imageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;
  const paletteColors = extractPaletteColors(imageData, frameWidth, frameHeight, swatchCount);

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
  cameraController.stopStream();
}

window.addEventListener('beforeunload', stopCurrentStream);

initializeApp();
