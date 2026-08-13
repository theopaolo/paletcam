import { subscribeLocaleChange, t } from "../i18n.js";
import { clampValue, createScrubberValue } from "./camera-scrubber-value.js";

const DEFAULT_EXPOSURE_STEP = 0.1;
const DEFAULT_HIDE_DELAY_MS = 1800;
/* A drag across this share of the preview height covers the whole EV range. */
const DRAG_SPAN_RATIO = 0.6;
/* Under this travel the gesture is still a tap, so the EV readout stays out. */
const DRAG_DEAD_ZONE_PX = 6;

function formatExposureValue(value) {
  if (!Number.isFinite(value)) {
    return "0.0";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

/**
 * Tap the preview to meter there, then slide up or down without lifting to
 * trade exposure, the way a stock camera app behaves. A fresh tap re-meters
 * and drops the offset back to zero.
 *
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
  overlayLayer.className = "camera-meter-layer";
  overlayLayer.setAttribute("aria-label", t("camera.exposure.label"));

  const reticle = document.createElement("div");
  reticle.className = "camera-meter-reticle";
  reticle.setAttribute("aria-hidden", "true");

  const evReadout = document.createElement("div");
  evReadout.className = "camera-meter-ev";
  evReadout.textContent = formatExposureValue(0);

  reticle.appendChild(evReadout);
  overlayLayer.appendChild(reticle);
  overlayHost.appendChild(overlayLayer);

  let isBound = false;
  let canAdjustExposure = false;
  let canMeter = false;
  let activePointerId = null;
  let dragStartY = 0;
  let hasLeftDeadZone = false;
  let hideTimeoutId = 0;

  const unsubscribeLocaleChange = subscribeLocaleChange(() => {
    overlayLayer.setAttribute("aria-label", t("camera.exposure.label"));
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
      evReadout.textContent = formatExposureValue(nextExposure);
      reticle.classList.toggle("is-offset", Math.abs(nextExposure) >= exposureValue.getStep() / 2);
    },
  });

  function clearHideTimer() {
    if (!hideTimeoutId) {
      return;
    }

    window.clearTimeout(hideTimeoutId);
    hideTimeoutId = 0;
  }

  function hideReticle() {
    clearHideTimer();
    reticle.classList.remove("is-visible");
    reticle.classList.remove("is-adjusting");
  }

  function scheduleHide() {
    clearHideTimer();

    if (activePointerId !== null) {
      return;
    }

    hideTimeoutId = window.setTimeout(() => {
      hideTimeoutId = 0;
      hideReticle();
    }, hideDelayMs);
  }

  function getNormalizedPoint(event) {
    const layerBounds = overlayLayer.getBoundingClientRect();
    if (layerBounds.width <= 0 || layerBounds.height <= 0) {
      return null;
    }

    return {
      x: (event.clientX - layerBounds.left) / layerBounds.width,
      y: (event.clientY - layerBounds.top) / layerBounds.height,
    };
  }

  /* Keep the whole square inside the preview even when the tap lands on an
     edge; the metering point itself still uses the untouched coordinates. */
  function getReticleAnchor(point) {
    const layerBounds = overlayLayer.getBoundingClientRect();
    const halfWidth = (reticle.offsetWidth || 0) / 2;
    const halfHeight = (reticle.offsetHeight || 0) / 2;

    if (layerBounds.width <= 0 || layerBounds.height <= 0) {
      return point;
    }

    return {
      x: clampValue(point.x, halfWidth / layerBounds.width, 1 - halfWidth / layerBounds.width),
      y: clampValue(point.y, halfHeight / layerBounds.height, 1 - halfHeight / layerBounds.height),
    };
  }

  function placeReticle(point) {
    const anchor = getReticleAnchor(point);
    reticle.style.left = `${anchor.x * 100}%`;
    reticle.style.top = `${anchor.y * 100}%`;
    // Near the right edge the readout would run off the frame, so it swaps
    // to the other side of the square.
    reticle.classList.toggle("is-readout-flipped", anchor.x > 0.7);
    reticle.classList.add("is-visible");
    reticle.classList.remove("is-adjusting");
  }

  function handlePointerDown(event) {
    if (!canMeter && !canAdjustExposure) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const point = getNormalizedPoint(event);
    if (!point) {
      return;
    }

    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    hasLeftDeadZone = false;
    clearHideTimer();
    placeReticle(point);

    if (canMeter) {
      void cameraController?.setMeteringPoint?.(point);
    }

    // Re-metering invalidates the previous offset, so the drag starts at zero.
    if (canAdjustExposure) {
      void exposureValue.apply(0);
    }

    overlayLayer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (event.pointerId !== activePointerId || !canAdjustExposure) {
      return;
    }

    const travel = dragStartY - event.clientY;
    if (!hasLeftDeadZone && Math.abs(travel) < DRAG_DEAD_ZONE_PX) {
      return;
    }

    hasLeftDeadZone = true;
    reticle.classList.add("is-adjusting");

    const { min, max } = exposureValue.getRange();
    const layerHeight = overlayLayer.getBoundingClientRect().height;
    const dragSpan = (layerHeight || 1) * DRAG_SPAN_RATIO;

    void exposureValue.apply((travel / dragSpan) * (max - min));
    event.preventDefault();
  }

  function finishGesture(pointerId) {
    if (pointerId !== null && pointerId !== activePointerId) {
      return;
    }

    activePointerId = null;
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

  function bindEvents() {
    if (isBound) {
      return;
    }

    overlayLayer.addEventListener("pointerdown", handlePointerDown);
    overlayLayer.addEventListener("pointermove", handlePointerMove);
    overlayLayer.addEventListener("pointerup", handlePointerUp);
    overlayLayer.addEventListener("pointercancel", handlePointerCancel);
    overlayLayer.addEventListener("lostpointercapture", handleLostPointerCapture);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      overlayLayer.removeEventListener("pointerdown", handlePointerDown);
      overlayLayer.removeEventListener("pointermove", handlePointerMove);
      overlayLayer.removeEventListener("pointerup", handlePointerUp);
      overlayLayer.removeEventListener("pointercancel", handlePointerCancel);
      overlayLayer.removeEventListener("lostpointercapture", handleLostPointerCapture);
      isBound = false;
    }

    clearHideTimer();
    unsubscribeLocaleChange();
    overlayLayer.remove();
  }

  function setDisabled() {
    canAdjustExposure = false;
    canMeter = false;
    activePointerId = null;
    overlayLayer.classList.add("is-inert");
    hideReticle();
    exposureValue.reset();
  }

  function syncCapabilities() {
    const exposureCapabilities = cameraController?.getExposureCapabilities?.();
    const minExposure = Number(exposureCapabilities?.min);
    const maxExposure = Number(exposureCapabilities?.max);
    canAdjustExposure =
      Number.isFinite(minExposure) && Number.isFinite(maxExposure) && maxExposure > minExposure;
    canMeter = cameraController?.supportsMeteringPointSelection?.() === true;

    if (!canAdjustExposure) {
      exposureValue.setCapabilities(null);
    } else {
      exposureValue.setCapabilities({
        min: minExposure,
        max: maxExposure,
        step: Number(exposureCapabilities?.step) || DEFAULT_EXPOSURE_STEP,
      });
      exposureValue.confirm(cameraController?.getCurrentExposureCompensation?.() ?? 0);
    }

    // Nothing to drive means nothing to tap, so the layer stops swallowing
    // pointers over the preview.
    overlayLayer.classList.toggle("is-inert", !canMeter && !canAdjustExposure);
  }

  function handleExposureChange(nextExposure) {
    if (!Number.isFinite(nextExposure)) {
      return;
    }

    exposureValue.confirm(nextExposure);
  }

  function initialize() {
    hideReticle();
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
