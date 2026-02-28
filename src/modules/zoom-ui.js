import { updateZoomText } from './camera-ui.js';

const DEFAULT_ZOOM_STEP = 0.1;

function formatZoomScaleValue(value) {
  return `${value.toFixed(1)}x`;
}

export function createZoomUiController({
  cameraController,
  zoomWheel,
  zoomWheelContainer,
  zoomPanel,
  zoomDisplay,
  zoomMinDisplay,
  zoomMaxDisplay,
} = {}) {
  let isBound = false;

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

  function handleZoomChange(zoomValue) {
    if (Number.isFinite(zoomValue)) {
      updateZoomText(zoomDisplay, zoomValue);
    }

    if (zoomWheel && Number.isFinite(zoomValue)) {
      zoomWheel.value = String(zoomValue);
    }
  }

  function handleZoomWheelInput(event) {
    const nextZoom = Number(event.target.value);
    if (!Number.isFinite(nextZoom)) {
      return;
    }

    updateZoomText(zoomDisplay, nextZoom);
    void cameraController?.applyZoom?.(nextZoom);
  }

  function bindEvents() {
    if (!zoomWheel || isBound) {
      return;
    }

    zoomWheel.addEventListener('input', handleZoomWheelInput);
    isBound = true;
  }

  function destroy() {
    if (!zoomWheel || !isBound) {
      return;
    }

    zoomWheel.removeEventListener('input', handleZoomWheelInput);
    isBound = false;
  }

  function setDisabled() {
    if (!zoomWheel) {
      return;
    }

    zoomWheel.setAttribute('disabled', '');
    updateZoomScaleBounds(Number(zoomWheel.min), Number(zoomWheel.max));
  }

  function syncCapabilities() {
    if (!zoomWheel) {
      return;
    }

    const zoomCapabilities = cameraController?.getZoomCapabilities?.();
    const minZoom = Number(zoomCapabilities?.min);
    const maxZoom = Number(zoomCapabilities?.max);
    const stepZoom = Number(zoomCapabilities?.step);
    const hasZoomCapabilities = Number.isFinite(minZoom)
      && Number.isFinite(maxZoom)
      && maxZoom > minZoom;

    if (!hasZoomCapabilities) {
      setDisabled();
      return;
    }

    const safeStep = Number.isFinite(stepZoom) && stepZoom > 0 ? stepZoom : DEFAULT_ZOOM_STEP;
    const currentZoom = cameraController?.getCurrentZoom?.() ?? minZoom;
    const clampedZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom));

    zoomWheel.min = String(minZoom);
    zoomWheel.max = String(maxZoom);
    zoomWheel.step = String(safeStep);
    zoomWheel.value = String(clampedZoom);
    zoomWheel.removeAttribute('disabled');
    updateZoomScaleBounds(minZoom, maxZoom);
    syncZoomTickMarks();
  }

  function initialize() {
    handleZoomChange(cameraController?.getCurrentZoom?.() ?? 1);
    setDisabled();
  }

  return {
    bindEvents,
    destroy,
    handleZoomChange,
    initialize,
    setDisabled,
    syncCapabilities,
  };
}
