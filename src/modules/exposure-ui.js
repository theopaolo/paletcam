import { subscribeLocaleChange, t } from "../i18n.js";
import { clampValue, createScrubberValue } from "./camera-scrubber-value.js";

const DEFAULT_EXPOSURE_STEP = 0.1;
const DEFAULT_HIDE_DELAY_MS = 1800;
const OVERLAY_RAIL_HEIGHT_PX = 146;
const OVERLAY_RAIL_PADDING_PX = 12;

function formatExposureValue(value) {
  if (!Number.isFinite(value)) {
    return "0.0";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
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
  resetButton.setAttribute("aria-label", t("camera.exposure.reset"));

  const passiveIndicator = document.createElement("button");
  passiveIndicator.className = "camera-ev-indicator";
  passiveIndicator.type = "button";
  passiveIndicator.hidden = true;
  passiveIndicator.textContent = "EV 0.0";
  passiveIndicator.setAttribute("aria-label", t("camera.exposure.label"));

  rail.append(zeroLine, thumb);
  overlayPanel.append(valueBadge, rail, resetButton);
  dock.append(overlayPanel, passiveIndicator);
  overlayLayer.appendChild(dock);
  overlayHost.appendChild(overlayLayer);

  let isBound = false;
  let isEnabled = false;
  let hasCapabilities = false;
  let activePointerId = null;
  let hideTimeoutId = 0;
  const unsubscribeLocaleChange = subscribeLocaleChange(() => {
    resetButton.setAttribute("aria-label", t("camera.exposure.reset"));
    passiveIndicator.setAttribute("aria-label", t("camera.exposure.label"));
  });

  const exposureValue = createScrubberValue({
    defaultStep: DEFAULT_EXPOSURE_STEP,
    getDefaultValue: () => 0,
    getBoundaryKey: (value, step) => {
      if (Math.abs(value) <= step / 2) {
        return "0";
      }

      const nearestWholeStop = Math.round(value);
      return Math.abs(value - nearestWholeStop) <= step / 2 ? String(nearestWholeStop) : null;
    },
    applyToCamera: (nextExposure) => cameraController?.applyExposureCompensation?.(nextExposure),
    onDisplay: (nextExposure) => {
      valueBadge.textContent = formatExposureValue(nextExposure);
      updateThumbPosition(nextExposure);
      updateResetButtonState(nextExposure);
      syncPassiveIndicator();
    },
  });

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

  function updateThumbPosition(currentExposure) {
    const { min, max } = exposureValue.getRange();
    const range = max - min;
    const usableHeight = OVERLAY_RAIL_HEIGHT_PX - OVERLAY_RAIL_PADDING_PX * 2;
    const normalizedValue = range > 0 ? (currentExposure - min) / range : 0.5;
    const nextTop = OVERLAY_RAIL_PADDING_PX + (1 - normalizedValue) * usableHeight;
    thumb.style.top = `${nextTop}px`;
  }

  function updateResetButtonState(currentExposure) {
    const isZeroExposure = Math.abs(currentExposure) < exposureValue.getStep() / 2;
    resetButton.hidden = false;
    resetButton.disabled = isZeroExposure;
    resetButton.classList.toggle("is-zero", isZeroExposure);
    resetButton.classList.toggle("is-active", !isZeroExposure);
  }

  function syncPassiveIndicator() {
    passiveIndicator.hidden = !isEnabled;
    passiveIndicator.classList.toggle("is-visible", isEnabled);
    passiveIndicator.classList.toggle(
      "is-offset",
      Math.abs(exposureValue.value) >= exposureValue.getStep() / 2,
    );
    passiveIndicator.classList.toggle("is-open", overlayLayer.classList.contains("is-visible"));
    passiveIndicator.textContent = `EV ${formatExposureValue(exposureValue.value)}`;
  }

  function resetActiveGesture() {
    activePointerId = null;
  }

  function getExposureValueForPointer(event) {
    const { min, max } = exposureValue.getRange();
    const railBounds = rail.getBoundingClientRect();
    const railHeight = railBounds.height || OVERLAY_RAIL_HEIGHT_PX;

    if (railHeight <= 0 || max <= min) {
      return exposureValue.value;
    }

    const normalizedPosition = clampValue((event.clientY - railBounds.top) / railHeight, 0, 1);
    return max - normalizedPosition * (max - min);
  }

  function handleIndicatorPointerDown(event) {
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
    if (!isEnabled || !hasCapabilities || event.button !== 0) {
      return;
    }

    activePointerId = event.pointerId;
    clearHideTimer();
    setVisible(true);
    void exposureValue.apply(getExposureValueForPointer(event));
    rail.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleRailPointerMove(event) {
    if (event.pointerId !== activePointerId || !hasCapabilities) {
      return;
    }

    void exposureValue.apply(getExposureValueForPointer(event));
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
    void exposureValue.apply(0);
    scheduleHide();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    passiveIndicator.addEventListener("pointerdown", handleIndicatorPointerDown);
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
      passiveIndicator.removeEventListener("pointerdown", handleIndicatorPointerDown);
      rail.removeEventListener("pointerdown", handleRailPointerDown);
      rail.removeEventListener("pointermove", handleRailPointerMove);
      rail.removeEventListener("pointerup", handleRailPointerUp);
      rail.removeEventListener("pointercancel", handleRailPointerCancel);
      rail.removeEventListener("lostpointercapture", handleRailLostPointerCapture);
      resetButton.removeEventListener("click", handleResetClick);
      isBound = false;
    }

    clearHideTimer();
    unsubscribeLocaleChange();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    overlayLayer.classList.remove("is-visible");
    resetActiveGesture();
    clearHideTimer();
    exposureValue.reset();
    resetButton.disabled = true;
    resetButton.classList.add("is-zero");
    resetButton.classList.remove("is-active");
    passiveIndicator.hidden = true;
    passiveIndicator.classList.remove("is-visible");
    passiveIndicator.classList.remove("is-offset");
    passiveIndicator.classList.remove("is-open");
  }

  function syncCapabilities() {
    const exposureCapabilities = cameraController?.getExposureCapabilities?.();
    const minExposure = Number(exposureCapabilities?.min);
    const maxExposure = Number(exposureCapabilities?.max);
    hasCapabilities =
      Number.isFinite(minExposure) && Number.isFinite(maxExposure) && maxExposure > minExposure;

    if (!hasCapabilities) {
      exposureValue.setCapabilities(null);
      setDisabled();
      return;
    }

    exposureValue.setCapabilities({
      min: minExposure,
      max: maxExposure,
      step: Number(exposureCapabilities?.step) || DEFAULT_EXPOSURE_STEP,
    });
    isEnabled = true;
    exposureValue.confirm(cameraController?.getCurrentExposureCompensation?.() ?? 0);
  }

  function handleExposureChange(nextExposure) {
    if (!Number.isFinite(nextExposure)) {
      return;
    }

    exposureValue.confirm(nextExposure);
  }

  function initialize() {
    overlayLayer.classList.remove("is-visible");
    resetButton.hidden = false;
    exposureValue.confirm(cameraController?.getCurrentExposureCompensation?.() ?? 0);
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
