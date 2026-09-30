import { subscribeLocaleChange, t } from "../i18n.js";
import { clampValue, createScrubberValue } from "./camera-scrubber-value.js";

const DEFAULT_ZOOM_STEP = 0.1;
const ACTIVE_FEEDBACK_HIDE_DELAY_MS = 240;
/** After a pinch the ruler lingers this long, so the landing value can be read. */
const PINCH_RULER_HOLD_MS = 900;
/** A press on the readout that moves less than this is a tap: next preset. */
const READOUT_TAP_SLOP_PX = 4;
/** Zoom farther than this from 1x keeps the readout on the feed at rest. */
const ZOOMED_EPSILON = 0.05;
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
 * Zoom: pinch the preview with two fingers, or drag the readout sideways. At
 * rest the feed shows only the readout, and only while zoomed away from 1x; the
 * ruler appears while a finger drives the zoom and lingers briefly after.
 *
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
  /** Touches on the preview, tracked to detect and drive a pinch. */
  const touchPoints = new Map();
  let pinch = null;
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
      overlayLayer.classList.toggle("is-zoomed", Math.abs(nextZoom - 1) > ZOOMED_EPSILON);
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

  function pulseScrubberActive(holdMs = ACTIVE_FEEDBACK_HIDE_DELAY_MS) {
    if (!isEnabled || activePointerId !== null) {
      return;
    }

    setScrubberActive(true);
    clearActiveFeedbackTimer();
    activeFeedbackTimeoutId = window.setTimeout(() => {
      activeFeedbackTimeoutId = 0;
      setScrubberActive(false);
    }, holdMs);
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
    const isTap =
      event.pointerId === activePointerId &&
      Math.abs(event.clientX - gestureStartClientX) < READOUT_TAP_SLOP_PX;
    finishGesture(event.pointerId);
    if (isTap && hasCapabilities) {
      stepToNextPreset();
    }
  }

  /** A tap on the readout jumps to the next preset, wrapping to the widest. */
  function stepToNextPreset() {
    const tolerance = getSelectionTolerance() / 2;
    const nextZoom =
      presetValues.find((presetValue) => presetValue > zoomValue.value + tolerance) ??
      presetValues[0];
    if (nextZoom === undefined) {
      return;
    }
    pulseScrubberActive(PINCH_RULER_HOLD_MS);
    void zoomValue.apply(nextZoom);
  }

  function getTouchSpread() {
    const [first, second] = [...touchPoints.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  /* Pinch listeners sit on the whole preview, so they also see the touches the
     metering layer captures (exposure-ui.js hands off on the second finger). */
  function handlePreviewPointerDown(event) {
    if (event.pointerType !== "touch") {
      return;
    }

    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size !== 2 || !isEnabled || !hasCapabilities) {
      return;
    }

    pinch = { spread: Math.max(1, getTouchSpread()), zoom: zoomValue.value };
    clearActiveFeedbackTimer();
    setScrubberActive(true);
  }

  function handlePreviewPointerMove(event) {
    const point = touchPoints.get(event.pointerId);
    if (!point) {
      return;
    }

    point.x = event.clientX;
    point.y = event.clientY;
    if (!pinch || touchPoints.size < 2) {
      return;
    }

    void zoomValue.apply(pinch.zoom * (getTouchSpread() / pinch.spread));
    event.preventDefault();
  }

  function handlePreviewPointerEnd(event) {
    if (!touchPoints.delete(event.pointerId) || !pinch || touchPoints.size >= 2) {
      return;
    }

    pinch = null;
    setScrubberActive(false);
    pulseScrubberActive(PINCH_RULER_HOLD_MS);
  }

  /** iOS Safari fires its own gesture events for a pinch; the page must not zoom. */
  function handleGestureStart(event) {
    event.preventDefault();
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
    overlayHost.addEventListener("pointerdown", handlePreviewPointerDown);
    overlayHost.addEventListener("pointermove", handlePreviewPointerMove);
    overlayHost.addEventListener("pointerup", handlePreviewPointerEnd);
    overlayHost.addEventListener("pointercancel", handlePreviewPointerEnd);
    overlayHost.addEventListener("gesturestart", handleGestureStart);
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
      overlayHost.removeEventListener("pointerdown", handlePreviewPointerDown);
      overlayHost.removeEventListener("pointermove", handlePreviewPointerMove);
      overlayHost.removeEventListener("pointerup", handlePreviewPointerEnd);
      overlayHost.removeEventListener("pointercancel", handlePreviewPointerEnd);
      overlayHost.removeEventListener("gesturestart", handleGestureStart);
      isBound = false;
    }

    clearActiveFeedbackTimer();
    unsubscribeLocaleChange();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    touchPoints.clear();
    pinch = null;
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
