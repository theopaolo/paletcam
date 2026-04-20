const DEFAULT_ZOOM_STEP = 0.1;
const ACTIVE_FEEDBACK_HIDE_DELAY_MS = 240;
const HAPTIC_DURATION_MS = 10;
const SCRUB_RANGE_PX = 220;
const CANONICAL_ZOOM_PRESETS = [0.5, 1, 2, 3, 5];

function clampValue(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

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
  scrubber.setAttribute("aria-label", "Zoom");
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
  let currentCapabilities = null;
  let presetValues = [];
  let currentZoom = 1;
  let lastAppliedZoom = null;
  let pendingZoom = null;
  let lastBoundaryKey = null;
  let activePointerId = null;
  let activeFeedbackTimeoutId = 0;

  function getStepValue() {
    const stepValue = Number(currentCapabilities?.step);
    return Number.isFinite(stepValue) && stepValue > 0 ? stepValue : DEFAULT_ZOOM_STEP;
  }

  function getZoomRange() {
    const minValue = Number(currentCapabilities?.min);
    const maxValue = Number(currentCapabilities?.max);

    return {
      max: Number.isFinite(maxValue) ? maxValue : 1,
      min: Number.isFinite(minValue) ? minValue : 1,
    };
  }

  function getSelectionTolerance() {
    return Math.max(getStepValue() * 2, 0.12);
  }

  function getDefaultZoomValue() {
    const { min, max } = getZoomRange();
    return clampValue(1, min, max);
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

  function clampToCapabilities(zoomValue) {
    const { min, max } = getZoomRange();
    return clampValue(zoomValue, min, max);
  }

  function quantizeZoom(zoomValue) {
    const { min } = getZoomRange();
    const stepValue = getStepValue();
    const roundedValue = min + Math.round((zoomValue - min) / stepValue) * stepValue;
    return clampToCapabilities(roundedValue);
  }

  function emitBoundaryHaptic(zoomValue) {
    const tolerance = getSelectionTolerance() / 2;
    const nearestWholeZoom = Math.round(zoomValue);
    const wholeZoomKey =
      Math.abs(zoomValue - nearestWholeZoom) <= tolerance ? `whole:${nearestWholeZoom}` : null;
    const presetZoom = presetValues.find(
      (presetValue) => Math.abs(presetValue - zoomValue) <= tolerance,
    );
    const boundaryKey = presetZoom !== undefined ? `preset:${presetZoom}` : wholeZoomKey;

    if (!boundaryKey) {
      lastBoundaryKey = null;
      return;
    }

    if (boundaryKey === lastBoundaryKey) {
      return;
    }

    lastBoundaryKey = boundaryKey;
    globalThis.navigator?.vibrate?.(HAPTIC_DURATION_MS);
  }

  function buildPresetValues() {
    const { min, max } = getZoomRange();
    const minimumGap = Math.max(getStepValue() * 3, 0.18);
    const nextValues = [];

    const pushValue = (zoomValue) => {
      const clampedValue = quantizeZoom(zoomValue);
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

  function getZoomFromClientX(clientX) {
    const { min, max } = getZoomRange();
    const trackRect = scrubberTrack.getBoundingClientRect?.();
    const trackWidth = Number(trackRect?.width) > 0 ? Number(trackRect.width) : SCRUB_RANGE_PX;
    const trackLeft = Number.isFinite(Number(trackRect?.left))
      ? Number(trackRect.left)
      : clientX - trackWidth / 2;
    const normalizedValue = clampValue((clientX - trackLeft) / trackWidth, 0, 1);
    return min + normalizedValue * (max - min);
  }

  function updateScrubberA11y(zoomValue) {
    const { min, max } = getZoomRange();
    scrubber.tabIndex = isEnabled ? 0 : -1;
    scrubber.setAttribute("aria-disabled", String(!isEnabled));
    scrubber.setAttribute("aria-valuemin", formatZoomNumber(min));
    scrubber.setAttribute("aria-valuemax", formatZoomNumber(max));
    scrubber.setAttribute("aria-valuenow", formatZoomNumber(zoomValue));
    scrubber.setAttribute("aria-valuetext", `Zoom ${formatZoomReadout(zoomValue)}`);
  }

  function updateScrubberProgress(zoomValue) {
    const { min, max } = getZoomRange();
    const normalizedValue = max > min ? (zoomValue - min) / (max - min) : 0.495;
    scrubberTrack.style.setProperty("--zoom-progress", String(clampValue(normalizedValue, 0, 1)));
    updateScrubberA11y(zoomValue);
  }

  function updateZoomDisplay(zoomValue, { isConfirmed = false } = {}) {
    currentZoom = clampToCapabilities(zoomValue);

    if (isConfirmed) {
      lastAppliedZoom = currentZoom;
      pendingZoom = null;
    }

    readout.textContent = formatZoomReadout(currentZoom);
    updateScrubberProgress(currentZoom);
  }

  async function applyZoomValue(zoomValue) {
    const nextZoom = quantizeZoom(zoomValue);

    if (nextZoom === pendingZoom) {
      updateZoomDisplay(nextZoom);
      return;
    }

    if (pendingZoom === null && nextZoom === lastAppliedZoom) {
      updateZoomDisplay(nextZoom, { isConfirmed: true });
      return;
    }

    updateZoomDisplay(nextZoom);
    emitBoundaryHaptic(nextZoom);
    pendingZoom = nextZoom;
    let applySucceeded = false;

    try {
      applySucceeded = (await cameraController?.applyZoom?.(nextZoom)) === true;
    } catch {
      applySucceeded = false;
    }

    if (!applySucceeded && pendingZoom === nextZoom) {
      updateZoomDisplay(lastAppliedZoom ?? getDefaultZoomValue(), { isConfirmed: true });
    }
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
    clearActiveFeedbackTimer();
    setScrubberActive(true);
    scrubber.setPointerCapture?.(event.pointerId);
    void applyZoomValue(getZoomFromClientX(event.clientX));
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (event.pointerId !== activePointerId || !currentCapabilities) {
      return;
    }

    void applyZoomValue(getZoomFromClientX(event.clientX));
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
    if (!isEnabled || !currentCapabilities) {
      return;
    }

    const dominantDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : 0;

    if (Math.abs(dominantDelta) < 2) {
      return;
    }

    pulseScrubberActive();

    const { min, max } = getZoomRange();
    const zoomRange = max - min;
    const nextZoom = currentZoom + (dominantDelta / SCRUB_RANGE_PX) * zoomRange;
    void applyZoomValue(nextZoom);
    event.preventDefault();
  }

  function handleKeyDown(event) {
    if (!isEnabled || !currentCapabilities) {
      return;
    }

    const fineStep = getStepValue();
    const coarseStep = fineStep * 5;
    let nextZoom = null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextZoom = currentZoom - fineStep;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextZoom = currentZoom + fineStep;
        break;
      case "PageDown":
        nextZoom = currentZoom - coarseStep;
        break;
      case "PageUp":
        nextZoom = currentZoom + coarseStep;
        break;
      case "Home":
        nextZoom = getZoomRange().min;
        break;
      case "End":
        nextZoom = getZoomRange().max;
        break;
      default:
        return;
    }

    pulseScrubberActive();
    void applyZoomValue(nextZoom);
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
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    overlayLayer.hidden = true;
    setScrubberActive(false);
    clearActiveFeedbackTimer();
    resetGestureState();
    pendingZoom = null;
    presetValues = [];
    updateScrubberA11y(currentZoom);
  }

  function syncCapabilities() {
    const zoomCapabilities = cameraController?.getZoomCapabilities?.();
    const minZoom = Number(zoomCapabilities?.min);
    const maxZoom = Number(zoomCapabilities?.max);
    const hasZoomCapabilities =
      Number.isFinite(minZoom) && Number.isFinite(maxZoom) && maxZoom > minZoom;

    if (!hasZoomCapabilities) {
      currentCapabilities = null;
      setDisabled();
      return;
    }

    currentCapabilities = {
      max: maxZoom,
      min: minZoom,
      step: Number(zoomCapabilities?.step) || DEFAULT_ZOOM_STEP,
    };
    presetValues = buildPresetValues();
    isEnabled = true;
    overlayLayer.hidden = false;
    updateZoomDisplay(cameraController?.getCurrentZoom?.() ?? getDefaultZoomValue(), {
      isConfirmed: true,
    });
  }

  function handleZoomChange(zoomValue) {
    if (!Number.isFinite(zoomValue)) {
      return;
    }

    updateZoomDisplay(zoomValue, { isConfirmed: true });
  }

  function initialize() {
    overlayLayer.hidden = true;
    setScrubberActive(false);
    updateZoomDisplay(cameraController?.getCurrentZoom?.() ?? 1, { isConfirmed: true });
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
