const DEFAULT_EXPOSURE_STEP = 0.1;
const DEFAULT_HIDE_DELAY_MS = 1800;
const HAPTIC_DURATION_MS = 10;
const OVERLAY_RAIL_HEIGHT_PX = 146;
const OVERLAY_RAIL_PADDING_PX = 12;

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

  const dock = document.createElement("div");
  dock.className = "camera-ev-dock";

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

  const passiveIndicator = document.createElement("button");
  passiveIndicator.className = "camera-ev-indicator";
  passiveIndicator.type = "button";
  passiveIndicator.hidden = true;
  passiveIndicator.textContent = "EV 0.0";
  passiveIndicator.setAttribute("aria-label", "Réglage de l'exposition");

  rail.append(zeroLine, thumb);
  overlayPanel.append(valueBadge, rail, resetButton);
  dock.append(overlayPanel, passiveIndicator);
  overlayLayer.appendChild(dock);
  overlayHost.appendChild(overlayLayer);

  let isBound = false;
  let isEnabled = false;
  let activePointerId = null;
  let currentExposure = 0;
  let currentCapabilities = null;
  let hideTimeoutId = 0;
  let lastBoundaryKey = null;
  let lastAppliedExposure = null;
  let pendingExposure = null;

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
      syncPassiveIndicator();
    }, hideDelayMs);
  }

  function setVisible(isVisible) {
    overlayLayer.classList.toggle("is-visible", isVisible && isEnabled);
    syncPassiveIndicator();

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

  function syncPassiveIndicator() {
    passiveIndicator.hidden = !isEnabled;
    passiveIndicator.classList.toggle("is-visible", isEnabled);
    passiveIndicator.classList.toggle("is-offset", Math.abs(currentExposure) >= getStepValue() / 2);
    passiveIndicator.classList.toggle("is-open", overlayLayer.classList.contains("is-visible"));
    passiveIndicator.textContent = `EV ${formatExposureValue(currentExposure)}`;
  }

  function updateExposureDisplay(exposureValue, { isConfirmed = false } = {}) {
    currentExposure = clampToCapabilities(exposureValue);
    if (isConfirmed) {
      lastAppliedExposure = currentExposure;
      pendingExposure = null;
    }
    valueBadge.textContent = formatExposureValue(currentExposure);
    updateThumbPosition(currentExposure);
    updateResetVisibility(currentExposure);
    syncPassiveIndicator();
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

  async function applyExposureValue(exposureValue) {
    const nextExposure = quantizeExposure(exposureValue);

    if (nextExposure === pendingExposure) {
      updateExposureDisplay(nextExposure);
      return;
    }

    if (pendingExposure === null && nextExposure === lastAppliedExposure) {
      updateExposureDisplay(nextExposure, { isConfirmed: true });
      return;
    }

    updateExposureDisplay(nextExposure);
    emitBoundaryHaptic(nextExposure);
    pendingExposure = nextExposure;
    let applySucceeded = false;

    try {
      applySucceeded = (await cameraController?.applyExposureCompensation?.(nextExposure)) === true;
    } catch {
      applySucceeded = false;
    }

    if (!applySucceeded && pendingExposure === nextExposure) {
      updateExposureDisplay(lastAppliedExposure ?? 0, { isConfirmed: true });
    }
  }

  function resetActiveGesture() {
    activePointerId = null;
  }

  function getExposureValueForPointer(event) {
    const { min, max } = getExposureRange();
    const railBounds = rail.getBoundingClientRect();
    const railHeight = railBounds.height || OVERLAY_RAIL_HEIGHT_PX;

    if (railHeight <= 0 || max <= min) {
      return currentExposure;
    }

    const normalizedPosition = clampValue((event.clientY - railBounds.top) / railHeight, 0, 1);
    return max - normalizedPosition * (max - min);
  }

  function handleIndicatorClick(event) {
    if (!isEnabled) {
      return;
    }

    event.preventDefault();

    if (overlayLayer.classList.contains("is-visible")) {
      overlayLayer.classList.remove("is-visible");
      syncPassiveIndicator();
      clearHideTimer();
      return;
    }

    setVisible(true);
    scheduleHide();
  }

  function handleRailPointerDown(event) {
    if (!isEnabled || !currentCapabilities || event.button !== 0) {
      return;
    }

    activePointerId = event.pointerId;
    clearHideTimer();
    setVisible(true);
    void applyExposureValue(getExposureValueForPointer(event));
    rail.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleRailPointerMove(event) {
    if (event.pointerId !== activePointerId || !currentCapabilities) {
      return;
    }

    void applyExposureValue(getExposureValueForPointer(event));
    event.preventDefault();
  }

  function finishGesture(pointerId) {
    if (pointerId !== null && pointerId !== activePointerId) {
      return;
    }

    resetActiveGesture();
    scheduleHide();
  }

  function handleRailPointerUp(event) {
    finishGesture(event.pointerId);
  }

  function handleRailPointerCancel(event) {
    finishGesture(event.pointerId);
  }

  function handleRailLostPointerCapture() {
    finishGesture(null);
  }

  function handleResetClick(event) {
    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    setVisible(true);
    void applyExposureValue(0);
    scheduleHide();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    passiveIndicator.addEventListener("click", handleIndicatorClick);
    rail.addEventListener("pointerdown", handleRailPointerDown);
    rail.addEventListener("pointermove", handleRailPointerMove);
    rail.addEventListener("pointerup", handleRailPointerUp);
    rail.addEventListener("pointercancel", handleRailPointerCancel);
    rail.addEventListener("lostpointercapture", handleRailLostPointerCapture);
    resetButton.addEventListener("click", handleResetClick);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      passiveIndicator.removeEventListener("click", handleIndicatorClick);
      rail.removeEventListener("pointerdown", handleRailPointerDown);
      rail.removeEventListener("pointermove", handleRailPointerMove);
      rail.removeEventListener("pointerup", handleRailPointerUp);
      rail.removeEventListener("pointercancel", handleRailPointerCancel);
      rail.removeEventListener("lostpointercapture", handleRailLostPointerCapture);
      resetButton.removeEventListener("click", handleResetClick);
      isBound = false;
    }

    clearHideTimer();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    overlayLayer.classList.remove("is-visible");
    resetActiveGesture();
    clearHideTimer();
    pendingExposure = null;
    passiveIndicator.hidden = true;
    passiveIndicator.classList.remove("is-visible");
    passiveIndicator.classList.remove("is-offset");
    passiveIndicator.classList.remove("is-open");
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
    updateExposureDisplay(cameraController?.getCurrentExposureCompensation?.() ?? 0, {
      isConfirmed: true,
    });
  }

  function handleExposureChange(exposureValue) {
    if (!Number.isFinite(exposureValue)) {
      return;
    }

    updateExposureDisplay(exposureValue, { isConfirmed: true });
  }

  function initialize() {
    overlayLayer.classList.remove("is-visible");
    resetButton.hidden = true;
    updateExposureDisplay(cameraController?.getCurrentExposureCompensation?.() ?? 0, {
      isConfirmed: true,
    });
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
