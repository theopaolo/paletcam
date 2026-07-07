import { subscribeLocaleChange, t } from "../i18n.js";
import { clampValue, createScrubberValue } from "./camera-scrubber-value.js";

const DEFAULT_ZOOM_STEP = 0.1;
const ACTIVE_FEEDBACK_HIDE_DELAY_MS = 240;
const SCRUB_RANGE_PX = 220;
const CANONICAL_ZOOM_PRESETS = [0.5, 1, 2, 3, 5];

function formatZoomNumber(value) {
  if (!Number.isFinite(value)) {
    return "1";
  }

  const absoluteValue = Math.abs(value);
  return Number.isInteger(absoluteValue) ? String(absoluteValue) : absoluteValue.toFixed(1);
}

function formatZoomToken(value) {
  if (!Number.isFinite(value)) {
    return "1";
  }

  const absoluteValue = Math.abs(value);
  const zoomLabel = formatZoomNumber(absoluteValue);
  return absoluteValue < 1 ? zoomLabel.replace(/^0/, "") : zoomLabel.replace(/\.0$/, "");
}

function formatZoomReadout(value) {
  return `${formatZoomToken(value)}x`;
}

/**
 * @param {object} [options]
 * @param {CameraController | null} [options.cameraController]
 * @param {HTMLElement | null} [options.overlayHost]
 * @returns {ZoomUiController}
 */
export function createZoomUiController({ cameraController, overlayHost } = {}) {
  if (!overlayHost) {
    return {
      bindEvents() {},
      destroy() {},
      handleZoomChange() {},
      initialize() {},
      setDisabled() {},
      syncCapabilities() {},
    };
  }

  const overlayLayer = document.createElement("div");
  overlayLayer.className = "camera-zoom-layer";
  overlayLayer.hidden = true;

  const overlayDock = document.createElement("div");
  overlayDock.className = "camera-zoom-dock";

  const scrubber = document.createElement("div");
  scrubber.className = "camera-zoom-scrubber";
  scrubber.tabIndex = -1;
  scrubber.setAttribute("aria-disabled", "true");
  scrubber.setAttribute("aria-label", t("camera.zoom.label"));
  scrubber.setAttribute("aria-orientation", "horizontal");
  scrubber.setAttribute("role", "slider");

  const readout = document.createElement("div");
  readout.className = "camera-zoom-readout";
  readout.textContent = "1x";

  const scrubberTrack = document.createElement("div");
  scrubberTrack.className = "camera-zoom-ruler";
  scrubberTrack.setAttribute("aria-hidden", "true");

  scrubber.append(readout, scrubberTrack);
  overlayDock.appendChild(scrubber);
  overlayLayer.appendChild(overlayDock);
  overlayHost.appendChild(overlayLayer);

  let isBound = false;
  let isEnabled = false;
  let hasCapabilities = false;
  let presetValues = [];
  let activePointerId = null;
  let activeFeedbackTimeoutId = 0;
  let gestureStartClientX = 0;
  let gestureStartZoom = 1;
  const unsubscribeLocaleChange = subscribeLocaleChange(() => {
    scrubber.setAttribute("aria-label", t("camera.zoom.label"));
    updateScrubberA11y(zoomValue.value);
  });

  const zoomValue = createScrubberValue({
    defaultStep: DEFAULT_ZOOM_STEP,
    fallbackRange: { min: 1, max: 1 },
    getDefaultValue: ({ min, max }) => clampValue(1, min, max),
    getBoundaryKey: getZoomBoundaryKey,
    applyToCamera: (nextZoom) => cameraController?.applyZoom?.(nextZoom),
    onDisplay: (nextZoom) => {
      readout.textContent = formatZoomReadout(nextZoom);
      updateScrubberProgress(nextZoom);
    },
  });

  function getSelectionTolerance() {
    return Math.max(zoomValue.getStep() * 2, 0.12);
  }

  function getZoomBoundaryKey(value) {
    const tolerance = getSelectionTolerance() / 2;
    const nearestWholeZoom = Math.round(value);
    const wholeZoomKey =
      Math.abs(value - nearestWholeZoom) <= tolerance ? `whole:${nearestWholeZoom}` : null;
    const presetZoom = presetValues.find(
      (presetValue) => Math.abs(presetValue - value) <= tolerance,
    );
    return presetZoom !== undefined ? `preset:${presetZoom}` : wholeZoomKey;
  }

  function clearActiveFeedbackTimer() {
    if (!activeFeedbackTimeoutId) {
      return;
    }

    window.clearTimeout(activeFeedbackTimeoutId);
    activeFeedbackTimeoutId = 0;
  }

  function setScrubberActive(isActive) {
    const shouldShowActiveState = isActive && isEnabled;
    overlayDock.classList.toggle("is-scrubbing", shouldShowActiveState);
    scrubber.classList.toggle("is-active", shouldShowActiveState);
  }

  function pulseScrubberActive() {
    if (!isEnabled || activePointerId !== null) {
      return;
    }

    setScrubberActive(true);
    clearActiveFeedbackTimer();
    activeFeedbackTimeoutId = window.setTimeout(() => {
      activeFeedbackTimeoutId = 0;
      setScrubberActive(false);
    }, ACTIVE_FEEDBACK_HIDE_DELAY_MS);
  }

  function buildPresetValues() {
    const { min, max } = zoomValue.getRange();
    const minimumGap = Math.max(zoomValue.getStep() * 3, 0.18);
    const nextValues = [];

    const pushValue = (candidateZoom) => {
      const clampedValue = zoomValue.quantize(candidateZoom);
      if (!nextValues.some((candidate) => Math.abs(candidate - clampedValue) <= minimumGap / 2)) {
        nextValues.push(clampedValue);
      }
    };

    pushValue(min);
    for (const presetValue of CANONICAL_ZOOM_PRESETS) {
      if (presetValue >= min && presetValue <= max) {
        pushValue(presetValue);
      }
    }
    if (min < 1 && max > 1) {
      pushValue(1);
    }

    nextValues.sort((leftValue, rightValue) => leftValue - rightValue);

    const lastPresetValue = nextValues.at(-1) ?? min;
    if (
      (nextValues.length < 2 && max - min > minimumGap) ||
      (max - lastPresetValue > 0.75 && max > lastPresetValue)
    ) {
      pushValue(max);
      nextValues.sort((leftValue, rightValue) => leftValue - rightValue);
    }

    return nextValues.filter((zoomValue, index) => {
      if (index === 0) {
        return true;
      }

      return Math.abs(zoomValue - nextValues[index - 1]) > minimumGap;
    });
  }

  function getTrackWidth() {
    const trackRect = scrubberTrack.getBoundingClientRect?.();
    return Number(trackRect?.width) > 0 ? Number(trackRect.width) : SCRUB_RANGE_PX;
  }

  function getZoomFromGesture(clientX) {
    const { min, max } = zoomValue.getRange();
    const deltaX = clientX - gestureStartClientX;
    return gestureStartZoom + (deltaX / getTrackWidth()) * (max - min);
  }

  function updateScrubberA11y(currentZoom) {
    const { min, max } = zoomValue.getRange();
    scrubber.tabIndex = isEnabled ? 0 : -1;
    scrubber.setAttribute("aria-disabled", String(!isEnabled));
    scrubber.setAttribute("aria-valuemin", formatZoomNumber(min));
    scrubber.setAttribute("aria-valuemax", formatZoomNumber(max));
    scrubber.setAttribute("aria-valuenow", formatZoomNumber(currentZoom));
    scrubber.setAttribute(
      "aria-valuetext",
      t("camera.zoom.valueText", { value: formatZoomReadout(currentZoom) }),
    );
  }

  function updateScrubberProgress(currentZoom) {
    const { min, max } = zoomValue.getRange();
    const normalizedValue = max > min ? (currentZoom - min) / (max - min) : 0.5;
    scrubberTrack.style.setProperty("--zoom-progress", String(clampValue(normalizedValue, 0, 1)));
    updateScrubberA11y(currentZoom);
  }

  function resetGestureState() {
    activePointerId = null;
    setScrubberActive(false);
  }

  function handlePointerDown(event) {
    if (!isEnabled || event.button !== 0) {
      return;
    }

    activePointerId = event.pointerId;
    gestureStartClientX = event.clientX;
    gestureStartZoom = zoomValue.value;
    clearActiveFeedbackTimer();
    setScrubberActive(true);
    scrubber.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (event.pointerId !== activePointerId || !hasCapabilities) {
      return;
    }

    void zoomValue.apply(getZoomFromGesture(event.clientX));
    event.preventDefault();
  }

  function finishGesture(pointerId) {
    if (pointerId !== null && pointerId !== activePointerId) {
      return;
    }

    resetGestureState();
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

  function handleWheel(event) {
    if (!isEnabled || !hasCapabilities) {
      return;
    }

    const dominantDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : 0;

    if (Math.abs(dominantDelta) < 2) {
      return;
    }

    pulseScrubberActive();

    const { min, max } = zoomValue.getRange();
    const nextZoom = zoomValue.value + (dominantDelta / SCRUB_RANGE_PX) * (max - min);
    void zoomValue.apply(nextZoom);
    event.preventDefault();
  }

  function handleKeyDown(event) {
    if (!isEnabled || !hasCapabilities) {
      return;
    }

    const fineStep = zoomValue.getStep();
    const coarseStep = fineStep * 5;
    let nextZoom = null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextZoom = zoomValue.value - fineStep;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextZoom = zoomValue.value + fineStep;
        break;
      case "PageDown":
        nextZoom = zoomValue.value - coarseStep;
        break;
      case "PageUp":
        nextZoom = zoomValue.value + coarseStep;
        break;
      case "Home":
        nextZoom = zoomValue.getRange().min;
        break;
      case "End":
        nextZoom = zoomValue.getRange().max;
        break;
      default:
        return;
    }

    pulseScrubberActive();
    void zoomValue.apply(nextZoom);
    event.preventDefault();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    scrubber.addEventListener("pointerdown", handlePointerDown);
    scrubber.addEventListener("pointermove", handlePointerMove);
    scrubber.addEventListener("pointerup", handlePointerUp);
    scrubber.addEventListener("pointercancel", handlePointerCancel);
    scrubber.addEventListener("lostpointercapture", handleLostPointerCapture);
    scrubber.addEventListener("wheel", handleWheel, { passive: false });
    scrubber.addEventListener("keydown", handleKeyDown);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      scrubber.removeEventListener("pointerdown", handlePointerDown);
      scrubber.removeEventListener("pointermove", handlePointerMove);
      scrubber.removeEventListener("pointerup", handlePointerUp);
      scrubber.removeEventListener("pointercancel", handlePointerCancel);
      scrubber.removeEventListener("lostpointercapture", handleLostPointerCapture);
      scrubber.removeEventListener("wheel", handleWheel);
      scrubber.removeEventListener("keydown", handleKeyDown);
      isBound = false;
    }

    clearActiveFeedbackTimer();
    unsubscribeLocaleChange();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    overlayLayer.hidden = true;
    setScrubberActive(false);
    clearActiveFeedbackTimer();
    resetGestureState();
    zoomValue.reset();
    presetValues = [];
    updateScrubberA11y(zoomValue.value);
  }

  function syncCapabilities() {
    const zoomCapabilities = cameraController?.getZoomCapabilities?.();
    const minZoom = Number(zoomCapabilities?.min);
    const maxZoom = Number(zoomCapabilities?.max);
    hasCapabilities = Number.isFinite(minZoom) && Number.isFinite(maxZoom) && maxZoom > minZoom;

    if (!hasCapabilities) {
      zoomValue.setCapabilities(null);
      setDisabled();
      return;
    }

    zoomValue.setCapabilities({
      max: maxZoom,
      min: minZoom,
      step: Number(zoomCapabilities?.step) || DEFAULT_ZOOM_STEP,
    });
    presetValues = buildPresetValues();
    isEnabled = true;
    overlayLayer.hidden = false;
    zoomValue.confirm(cameraController?.getCurrentZoom?.() ?? zoomValue.getDefaultValue());
  }

  function handleZoomChange(nextZoom) {
    if (!Number.isFinite(nextZoom)) {
      return;
    }

    zoomValue.confirm(nextZoom);
  }

  function initialize() {
    overlayLayer.hidden = true;
    setScrubberActive(false);
    zoomValue.confirm(cameraController?.getCurrentZoom?.() ?? 1);
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
