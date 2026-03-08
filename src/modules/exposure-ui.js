const DEFAULT_EXPOSURE_STEP = 0.1;
const DEFAULT_HIDE_DELAY_MS = 1800;
const DRAG_THRESHOLD_PX = 8;
const HAPTIC_DURATION_MS = 10;
const OVERLAY_EDGE_OFFSET_PX = 14;
const OVERLAY_VERTICAL_MARGIN_PX = 28;
const OVERLAY_RAIL_HEIGHT_PX = 154;
const OVERLAY_RAIL_PADDING_PX = 14;

function formatExposureValue(value) {
  if (!Number.isFinite(value)) {
    return "0.0";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function clampValue(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

/**
 * @param {object} [options]
 * @param {CameraController | null} [options.cameraController]
 * @param {HTMLElement | null} [options.overlayHost]
 * @param {number} [options.hideDelayMs]
 * @returns {ExposureUiController}
 */
export function createExposureUiController({
  cameraController,
  overlayHost,
  hideDelayMs = DEFAULT_HIDE_DELAY_MS,
} = {}) {
  if (!overlayHost) {
    return {
      bindEvents() {},
      destroy() {},
      handleExposureChange() {},
      initialize() {},
      setDisabled() {},
      syncCapabilities() {},
    };
  }

  const overlayLayer = document.createElement("div");
  overlayLayer.className = "camera-exposure-layer";

  const interactionLayer = document.createElement("div");
  interactionLayer.className = "camera-exposure-hit-area";
  interactionLayer.setAttribute("aria-hidden", "true");

  const meterPoint = document.createElement("div");
  meterPoint.className = "camera-meter-point";
  meterPoint.setAttribute("aria-hidden", "true");

  const overlayPanel = document.createElement("div");
  overlayPanel.className = "camera-ev-overlay";
  overlayPanel.setAttribute("aria-hidden", "true");

  const valueBadge = document.createElement("div");
  valueBadge.className = "camera-ev-value";
  valueBadge.textContent = "0.0";

  const rail = document.createElement("div");
  rail.className = "camera-ev-rail";

  const zeroLine = document.createElement("div");
  zeroLine.className = "camera-ev-zero-line";

  const thumb = document.createElement("div");
  thumb.className = "camera-ev-thumb";

  const resetButton = document.createElement("button");
  resetButton.className = "camera-ev-reset";
  resetButton.type = "button";
  resetButton.textContent = "0";
  resetButton.setAttribute("aria-label", "Réinitialiser l'exposition");

  rail.append(zeroLine, thumb);
  overlayPanel.append(valueBadge, rail, resetButton);
  overlayLayer.append(interactionLayer, meterPoint, overlayPanel);
  overlayHost.appendChild(overlayLayer);

  let isBound = false;
  let isEnabled = false;
  let activePointerId = null;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartExposure = 0;
  let currentExposure = 0;
  let currentCapabilities = null;
  let hideTimeoutId = 0;
  let lastBoundaryKey = null;
  let lastAppliedExposure = null;

  function getVisibleOverlayBounds() {
    const overlayBounds = overlayHost.getBoundingClientRect();
    const parentBounds = overlayHost.parentElement?.getBoundingClientRect();

    return {
      width: Math.min(overlayBounds.width, parentBounds?.width ?? overlayBounds.width),
      height: Math.min(overlayBounds.height, parentBounds?.height ?? overlayBounds.height),
    };
  }

  function getStepValue() {
    const stepValue = Number(currentCapabilities?.step);
    return Number.isFinite(stepValue) && stepValue > 0 ? stepValue : DEFAULT_EXPOSURE_STEP;
  }

  function getExposureRange() {
    const minValue = Number(currentCapabilities?.min);
    const maxValue = Number(currentCapabilities?.max);

    return {
      min: Number.isFinite(minValue) ? minValue : 0,
      max: Number.isFinite(maxValue) ? maxValue : 0,
    };
  }

  function clearHideTimer() {
    if (!hideTimeoutId) {
      return;
    }

    window.clearTimeout(hideTimeoutId);
    hideTimeoutId = 0;
  }

  function scheduleHide() {
    clearHideTimer();

    if (!isEnabled || activePointerId !== null) {
      return;
    }

    hideTimeoutId = window.setTimeout(() => {
      hideTimeoutId = 0;
      overlayLayer.classList.remove("is-visible");
    }, hideDelayMs);
  }

  function setVisible(isVisible) {
    overlayLayer.classList.toggle("is-visible", isVisible && isEnabled);

    if (isVisible) {
      clearHideTimer();
    }
  }

  function clampToCapabilities(exposureValue) {
    const { min, max } = getExposureRange();
    return clampValue(exposureValue, min, max);
  }

  function quantizeExposure(exposureValue) {
    const { min } = getExposureRange();
    const stepValue = getStepValue();
    const roundedValue = min + Math.round((exposureValue - min) / stepValue) * stepValue;
    return clampToCapabilities(roundedValue);
  }

  function updateThumbPosition(exposureValue) {
    const { min, max } = getExposureRange();
    const range = max - min;
    const usableHeight = OVERLAY_RAIL_HEIGHT_PX - OVERLAY_RAIL_PADDING_PX * 2;
    const normalizedValue = range > 0 ? (exposureValue - min) / range : 0.5;
    const nextTop = OVERLAY_RAIL_PADDING_PX + (1 - normalizedValue) * usableHeight;
    thumb.style.top = `${nextTop}px`;
  }

  function updateResetVisibility(exposureValue) {
    resetButton.hidden = Math.abs(exposureValue) < getStepValue() / 2;
  }

  function updateExposureDisplay(exposureValue) {
    currentExposure = clampToCapabilities(exposureValue);
    lastAppliedExposure = currentExposure;
    valueBadge.textContent = formatExposureValue(currentExposure);
    updateThumbPosition(currentExposure);
    updateResetVisibility(currentExposure);
  }

  function positionOverlay(localX, localY) {
    const bounds = getVisibleOverlayBounds();
    const clampedY = clampValue(
      localY,
      OVERLAY_VERTICAL_MARGIN_PX + OVERLAY_RAIL_HEIGHT_PX / 2,
      Math.max(
        OVERLAY_VERTICAL_MARGIN_PX + OVERLAY_RAIL_HEIGHT_PX / 2,
        bounds.height - OVERLAY_VERTICAL_MARGIN_PX - OVERLAY_RAIL_HEIGHT_PX / 2,
      ),
    );
    const clampedX = clampValue(localX, 18, Math.max(18, bounds.width - 18));
    const overlayLeft = Math.max(
      OVERLAY_EDGE_OFFSET_PX,
      bounds.width - 46 - OVERLAY_EDGE_OFFSET_PX,
    );

    meterPoint.style.left = `${clampedX}px`;
    meterPoint.style.top = `${clampedY}px`;
    overlayPanel.style.top = `${clampedY}px`;
    overlayPanel.style.left = `${overlayLeft}px`;
    overlayPanel.style.right = "auto";
  }

  function getLocalPointerPosition(event) {
    const overlayBounds = overlayHost.getBoundingClientRect();
    const visibleBounds = getVisibleOverlayBounds();

    return {
      x: clampValue(event.clientX - overlayBounds.left, 0, visibleBounds.width),
      y: clampValue(event.clientY - overlayBounds.top, 0, visibleBounds.height),
      width: visibleBounds.width,
      height: visibleBounds.height,
    };
  }

  function emitBoundaryHaptic(exposureValue) {
    const stepValue = getStepValue();
    const isZeroBoundary = Math.abs(exposureValue) <= stepValue / 2;
    const nearestWholeStop = Math.round(exposureValue);
    const isWholeStopBoundary = Math.abs(exposureValue - nearestWholeStop) <= stepValue / 2;
    const boundaryKey = isZeroBoundary
      ? "0"
      : isWholeStopBoundary
        ? String(nearestWholeStop)
        : null;

    if (!boundaryKey) {
      lastBoundaryKey = null;
      return;
    }

    if (boundaryKey === lastBoundaryKey) {
      return;
    }

    lastBoundaryKey = boundaryKey;
    navigator.vibrate?.(HAPTIC_DURATION_MS);
  }

  function applyExposureValue(exposureValue) {
    const nextExposure = quantizeExposure(exposureValue);

    if (nextExposure === lastAppliedExposure) {
      updateExposureDisplay(nextExposure);
      return;
    }

    updateExposureDisplay(nextExposure);
    emitBoundaryHaptic(nextExposure);
    void cameraController?.applyExposureCompensation?.(nextExposure);
  }

  async function updateMeteringPoint(event) {
    const nextPoint = getLocalPointerPosition(event);
    positionOverlay(nextPoint.x, nextPoint.y);
    setVisible(true);
    void cameraController?.setMeteringPoint?.({
      x: nextPoint.width > 0 ? nextPoint.x / nextPoint.width : 0.5,
      y: nextPoint.height > 0 ? nextPoint.y / nextPoint.height : 0.5,
    });
  }

  function resetActiveGesture() {
    activePointerId = null;
    isDragging = false;
    dragStartY = 0;
    dragStartExposure = currentExposure;
  }

  function handlePointerDown(event) {
    if (!isEnabled || event.button !== 0) {
      return;
    }

    activePointerId = event.pointerId;
    isDragging = false;
    dragStartY = event.clientY;
    dragStartExposure = cameraController?.getCurrentExposureCompensation?.() ?? currentExposure;
    clearHideTimer();
    void updateMeteringPoint(event);
    interactionLayer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (event.pointerId !== activePointerId || !currentCapabilities) {
      return;
    }

    const deltaY = dragStartY - event.clientY;
    if (!isDragging && Math.abs(deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }

    isDragging = true;
    const { min, max } = getExposureRange();
    const exposureRange = max - min;
    const nextExposure = dragStartExposure + (deltaY / OVERLAY_RAIL_HEIGHT_PX) * exposureRange;
    applyExposureValue(nextExposure);
    event.preventDefault();
  }

  function finishGesture(pointerId) {
    if (pointerId !== null && pointerId !== activePointerId) {
      return;
    }

    resetActiveGesture();
    scheduleHide();
  }

  function handlePointerUp(event) {
    finishGesture(event.pointerId);
  }

  function handlePointerCancel(event) {
    finishGesture(event.pointerId);
  }

  function handleLostPointerCapture() {
    finishGesture(null);
  }

  function handleResetClick(event) {
    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    setVisible(true);
    applyExposureValue(0);
    scheduleHide();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    interactionLayer.addEventListener("pointerdown", handlePointerDown);
    interactionLayer.addEventListener("pointermove", handlePointerMove);
    interactionLayer.addEventListener("pointerup", handlePointerUp);
    interactionLayer.addEventListener("pointercancel", handlePointerCancel);
    interactionLayer.addEventListener("lostpointercapture", handleLostPointerCapture);
    resetButton.addEventListener("click", handleResetClick);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      interactionLayer.removeEventListener("pointerdown", handlePointerDown);
      interactionLayer.removeEventListener("pointermove", handlePointerMove);
      interactionLayer.removeEventListener("pointerup", handlePointerUp);
      interactionLayer.removeEventListener("pointercancel", handlePointerCancel);
      interactionLayer.removeEventListener("lostpointercapture", handleLostPointerCapture);
      resetButton.removeEventListener("click", handleResetClick);
      isBound = false;
    }

    clearHideTimer();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    interactionLayer.hidden = true;
    overlayLayer.classList.remove("is-visible");
    resetActiveGesture();
    clearHideTimer();
  }

  function syncCapabilities() {
    const exposureCapabilities = cameraController?.getExposureCapabilities?.();
    const minExposure = Number(exposureCapabilities?.min);
    const maxExposure = Number(exposureCapabilities?.max);
    const hasExposureCapabilities =
      Number.isFinite(minExposure) && Number.isFinite(maxExposure) && maxExposure > minExposure;

    if (!hasExposureCapabilities) {
      currentCapabilities = null;
      setDisabled();
      return;
    }

    currentCapabilities = {
      min: minExposure,
      max: maxExposure,
      step: Number(exposureCapabilities?.step) || DEFAULT_EXPOSURE_STEP,
    };
    isEnabled = true;
    interactionLayer.hidden = false;
    updateExposureDisplay(cameraController?.getCurrentExposureCompensation?.() ?? 0);
  }

  function handleExposureChange(exposureValue) {
    if (!Number.isFinite(exposureValue)) {
      return;
    }

    updateExposureDisplay(exposureValue);
  }

  function initialize() {
    interactionLayer.hidden = true;
    resetButton.hidden = true;
    updateExposureDisplay(cameraController?.getCurrentExposureCompensation?.() ?? 0);
  }

  return {
    bindEvents,
    destroy,
    handleExposureChange,
    initialize,
    setDisabled,
    syncCapabilities,
  };
}
