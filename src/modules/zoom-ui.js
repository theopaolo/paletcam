const DEFAULT_ZOOM_STEP = 0.1;
const DEFAULT_SCRUB_HIDE_DELAY_MS = 1100;
const DRAG_THRESHOLD_PX = 12;
const HAPTIC_DURATION_MS = 10;
const SCRUB_RANGE_PX = 220;
const MAX_VISIBLE_CHIPS = 3;
const CANONICAL_ZOOM_PRESETS = [0.5, 1, 2, 3, 5];

function clampValue(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function formatZoomToken(value) {
  if (!Number.isFinite(value)) {
    return "1";
  }

  const absoluteValue = Math.abs(value);
  const zoomLabel = Number.isInteger(absoluteValue)
    ? String(absoluteValue)
    : absoluteValue.toFixed(1);
  return absoluteValue < 1 ? zoomLabel.replace(/^0/, "") : zoomLabel.replace(/\.0$/, "");
}

function formatZoomReadout(value) {
  return `${formatZoomToken(value)}x`;
}

function formatZoomChipLabel(value, { isActive = false } = {}) {
  const label = formatZoomToken(value);
  return isActive || value === 1 || (value > 1 && !Number.isInteger(value)) ? `${label}x` : label;
}

/**
 * @param {object} [options]
 * @param {CameraController | null} [options.cameraController]
 * @param {HTMLElement | null} [options.overlayHost]
 * @param {number} [options.scrubHideDelayMs]
 * @returns {ZoomUiController}
 */
export function createZoomUiController({
  cameraController,
  overlayHost,
  scrubHideDelayMs = DEFAULT_SCRUB_HIDE_DELAY_MS,
} = {}) {
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

  const readout = document.createElement("div");
  readout.className = "camera-zoom-readout";
  readout.textContent = "1x";

  const scrubberTrack = document.createElement("div");
  scrubberTrack.className = "camera-zoom-ruler";

  scrubber.append(readout, scrubberTrack);

  const chipRack = document.createElement("div");
  chipRack.className = "camera-zoom-chip-rack";
  chipRack.setAttribute("aria-label", "Sélecteur de zoom");
  chipRack.setAttribute("role", "group");

  overlayDock.append(scrubber, chipRack);
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
  let pointerDownZoom = null;
  let dragStartZoom = 1;
  let dragStartX = 0;
  let didStartOnActiveChip = false;
  let isScrubbing = false;
  let scrubberHideTimeoutId = 0;

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

  function clearScrubberHideTimer() {
    if (!scrubberHideTimeoutId) {
      return;
    }

    window.clearTimeout(scrubberHideTimeoutId);
    scrubberHideTimeoutId = 0;
  }

  function setScrubberVisible(isVisible) {
    const shouldShowScrubber = isVisible && isEnabled;
    overlayDock.classList.toggle("is-scrubbing", shouldShowScrubber);
    scrubber.classList.toggle("is-visible", shouldShowScrubber);

    if (shouldShowScrubber) {
      clearScrubberHideTimer();
    }
  }

  function scheduleScrubberHide() {
    clearScrubberHideTimer();

    if (!isEnabled || activePointerId !== null) {
      return;
    }

    scrubberHideTimeoutId = window.setTimeout(() => {
      scrubberHideTimeoutId = 0;
      setScrubberVisible(false);
    }, scrubHideDelayMs);
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

  function getChipButtonFromTarget(target) {
    let currentNode = target;

    while (currentNode && currentNode !== chipRack) {
      if (currentNode.classList?.contains("camera-zoom-chip")) {
        return currentNode;
      }

      currentNode = currentNode.parentElement ?? null;
    }

    return null;
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

  function getDisplayValues() {
    const tolerance = getSelectionTolerance();
    const displayValues = [...presetValues];

    if (!displayValues.some((zoomValue) => Math.abs(zoomValue - currentZoom) <= tolerance / 2)) {
      displayValues.push(quantizeZoom(currentZoom));
    }

    displayValues.sort((leftValue, rightValue) => leftValue - rightValue);

    if (displayValues.length <= MAX_VISIBLE_CHIPS) {
      return displayValues;
    }

    let activeIndex = 0;
    let smallestDistance = Number.POSITIVE_INFINITY;

    displayValues.forEach((zoomValue, index) => {
      const distance = Math.abs(zoomValue - currentZoom);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        activeIndex = index;
      }
    });

    let startIndex = Math.max(0, activeIndex - 1);
    const endIndex = Math.min(displayValues.length, startIndex + MAX_VISIBLE_CHIPS);
    startIndex = Math.max(0, endIndex - MAX_VISIBLE_CHIPS);

    return displayValues.slice(startIndex, endIndex);
  }

  function updateScrubberProgress(zoomValue) {
    const { min, max } = getZoomRange();
    const normalizedValue = max > min ? (zoomValue - min) / (max - min) : 0.5;
    scrubberTrack.style.setProperty("--zoom-progress", String(clampValue(normalizedValue, 0, 1)));
  }

  function updateChipButtons() {
    const displayValues = getDisplayValues();
    const buttons = [];
    let activeValue = displayValues[0] ?? currentZoom;
    let smallestDistance = Number.POSITIVE_INFINITY;

    displayValues.forEach((zoomValue) => {
      const distance = Math.abs(zoomValue - currentZoom);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        activeValue = zoomValue;
      }
    });

    displayValues.forEach((zoomValue) => {
      const isActive = zoomValue === activeValue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "camera-zoom-chip";
      button.dataset.zoomValue = String(zoomValue);
      button.dataset.active = String(isActive);
      button.textContent = formatZoomChipLabel(zoomValue, { isActive });
      button.setAttribute("aria-label", `Zoom ${formatZoomReadout(zoomValue)}`);
      button.setAttribute("aria-pressed", String(isActive));

      if (isActive) {
        button.classList.add("is-active");
      }

      buttons.push(button);
    });

    chipRack.replaceChildren(...buttons);
  }

  function updateZoomDisplay(zoomValue, { isConfirmed = false } = {}) {
    currentZoom = clampToCapabilities(zoomValue);

    if (isConfirmed) {
      lastAppliedZoom = currentZoom;
      pendingZoom = null;
    }

    readout.textContent = formatZoomReadout(currentZoom);
    updateScrubberProgress(currentZoom);
    updateChipButtons();
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
    pointerDownZoom = null;
    dragStartZoom = currentZoom;
    dragStartX = 0;
    didStartOnActiveChip = false;
    isScrubbing = false;
  }

  function handlePointerDown(event) {
    if (!isEnabled || event.button !== 0) {
      return;
    }

    const chipButton = getChipButtonFromTarget(event.target);
    if (!chipButton) {
      return;
    }

    activePointerId = event.pointerId;
    pointerDownZoom = Number(chipButton.dataset.zoomValue);
    dragStartZoom = currentZoom;
    dragStartX = event.clientX;
    didStartOnActiveChip = chipButton.dataset.active === "true";
    isScrubbing = false;
    clearScrubberHideTimer();
    chipRack.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (event.pointerId !== activePointerId || !currentCapabilities || !didStartOnActiveChip) {
      return;
    }

    const deltaX = event.clientX - dragStartX;
    if (!isScrubbing && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
      return;
    }

    isScrubbing = true;
    setScrubberVisible(true);

    const { min, max } = getZoomRange();
    const zoomRange = max - min;
    const nextZoom = dragStartZoom + (deltaX / SCRUB_RANGE_PX) * zoomRange;
    void applyZoomValue(nextZoom);
    event.preventDefault();
  }

  function finishGesture(pointerId) {
    if (pointerId !== null && pointerId !== activePointerId) {
      return;
    }

    const targetZoom = pointerDownZoom;
    const shouldCommitTap = !isScrubbing && Number.isFinite(targetZoom);

    resetGestureState();

    if (shouldCommitTap) {
      void applyZoomValue(targetZoom);
    }

    if (overlayDock.classList.contains("is-scrubbing")) {
      scheduleScrubberHide();
    }
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

    clearScrubberHideTimer();
    setScrubberVisible(true);

    const { min, max } = getZoomRange();
    const zoomRange = max - min;
    const nextZoom = currentZoom + (dominantDelta / SCRUB_RANGE_PX) * zoomRange;
    void applyZoomValue(nextZoom);
    scheduleScrubberHide();
    event.preventDefault();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    chipRack.addEventListener("pointerdown", handlePointerDown);
    chipRack.addEventListener("pointermove", handlePointerMove);
    chipRack.addEventListener("pointerup", handlePointerUp);
    chipRack.addEventListener("pointercancel", handlePointerCancel);
    chipRack.addEventListener("lostpointercapture", handleLostPointerCapture);
    chipRack.addEventListener("wheel", handleWheel, { passive: false });
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      chipRack.removeEventListener("pointerdown", handlePointerDown);
      chipRack.removeEventListener("pointermove", handlePointerMove);
      chipRack.removeEventListener("pointerup", handlePointerUp);
      chipRack.removeEventListener("pointercancel", handlePointerCancel);
      chipRack.removeEventListener("lostpointercapture", handleLostPointerCapture);
      chipRack.removeEventListener("wheel", handleWheel);
      isBound = false;
    }

    clearScrubberHideTimer();
    overlayLayer.remove();
  }

  function setDisabled() {
    isEnabled = false;
    overlayLayer.hidden = true;
    chipRack.replaceChildren();
    setScrubberVisible(false);
    clearScrubberHideTimer();
    resetGestureState();
    pendingZoom = null;
    presetValues = [];
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
    setScrubberVisible(false);
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
