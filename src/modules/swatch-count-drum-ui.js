import { t } from "../i18n.js";

const DRAG_COMMIT_THRESHOLD_PX = 12;
const DRAG_PREVIEW_LIMIT_PX = 24;
const TAP_SLOP_PX = 4;
const ROLL_DURATION_MS = 200;
const CENTERED_TRACK_TRANSFORM = "translate3d(0, -33.3333%, 0)";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readNumericValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.swatchCountDrum]
 * @param {((count: number) => void) | null} [options.onSwatchCountChange]
 * @returns {SwatchCountDrumUiController}
 */
export function createSwatchCountDrumUiController({ swatchCountDrum, onSwatchCountChange } = {}) {
  const track = /** @type {HTMLElement | null} */ (
    swatchCountDrum?.querySelector(".swatch-drum-track") ?? null
  );
  const previousNumber = swatchCountDrum?.querySelector(".swatch-drum-previous") ?? null;
  const currentNumber = swatchCountDrum?.querySelector(".swatch-drum-current") ?? null;
  const nextNumber = swatchCountDrum?.querySelector(".swatch-drum-next") ?? null;
  const countLabel =
    swatchCountDrum?.closest(".swatch-count-control")?.querySelector(".swatch-count-label") ?? null;
  const min = readNumericValue(
    swatchCountDrum?.dataset.min ?? swatchCountDrum?.getAttribute("aria-valuemin"),
    3,
  );
  const max = readNumericValue(
    swatchCountDrum?.dataset.max ?? swatchCountDrum?.getAttribute("aria-valuemax"),
    7,
  );
  const cleanups = [];
  let currentValue = clamp(
    readNumericValue(
      swatchCountDrum?.dataset.value ?? swatchCountDrum?.getAttribute("aria-valuenow"),
      4,
    ),
    min,
    max,
  );
  let activePointer = null;
  let rollTimeout = 0;
  let isBound = false;

  function prefersReducedMotion() {
    return globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function renderTrack() {
    if (previousNumber) {
      previousNumber.textContent = currentValue > min ? String(currentValue - 1) : "";
    }
    if (currentNumber) {
      currentNumber.textContent = String(currentValue);
    }
    if (nextNumber) {
      nextNumber.textContent = currentValue < max ? String(currentValue + 1) : "";
    }
  }

  function syncAccessibleValue() {
    if (!swatchCountDrum) {
      return;
    }

    swatchCountDrum.dataset.value = String(currentValue);
    swatchCountDrum.setAttribute("aria-label", t("slider.colorCountAria"));
    swatchCountDrum.setAttribute("aria-valuemin", String(min));
    swatchCountDrum.setAttribute("aria-valuemax", String(max));
    swatchCountDrum.setAttribute("aria-valuenow", String(currentValue));
    swatchCountDrum.setAttribute("aria-valuetext", t("slider.colorCount", { count: currentValue }));

    if (countLabel) {
      countLabel.textContent = t("slider.colorCountLabel");
    }
  }

  function resetTrackPosition() {
    if (!track) {
      return;
    }
    track.style.transition = "none";
    track.style.transform = CENTERED_TRACK_TRANSFORM;
  }

  function finishRoll() {
    if (rollTimeout) {
      globalThis.window?.clearTimeout(rollTimeout);
      rollTimeout = 0;
    }
    swatchCountDrum?.classList.remove("is-rolling");
    renderTrack();
    resetTrackPosition();
  }

  function animateRoll(direction) {
    if (!track || prefersReducedMotion()) {
      renderTrack();
      resetTrackPosition();
      return;
    }

    swatchCountDrum?.classList.add("is-rolling");
    track.style.transition = "";
    void track.offsetHeight;
    track.style.transform = direction > 0 ? "translate3d(0, -66.6667%, 0)" : "translate3d(0, 0, 0)";

    rollTimeout = globalThis.window?.setTimeout(finishRoll, ROLL_DURATION_MS) ?? 0;
  }

  function setValue(nextValue, { animate = true } = {}) {
    const normalizedValue = clamp(Math.round(nextValue), min, max);
    if (normalizedValue === currentValue) {
      finishRoll();
      return false;
    }

    finishRoll();
    const direction = normalizedValue > currentValue ? 1 : -1;
    currentValue = normalizedValue;
    syncAccessibleValue();
    onSwatchCountChange?.(currentValue);

    if (animate) {
      animateRoll(direction);
    } else {
      renderTrack();
      resetTrackPosition();
    }
    return true;
  }

  function step(direction, options) {
    return setValue(currentValue + direction, options);
  }

  function setDragPreview(deltaY) {
    if (!track) {
      return;
    }

    let dampedDelta = clamp(deltaY, -DRAG_PREVIEW_LIMIT_PX, DRAG_PREVIEW_LIMIT_PX);
    const isPastUpperBoundary = currentValue >= max && dampedDelta < 0;
    const isPastLowerBoundary = currentValue <= min && dampedDelta > 0;
    if (isPastUpperBoundary || isPastLowerBoundary) {
      dampedDelta *= 0.25;
    }

    track.style.transition = "none";
    track.style.transform = `translate3d(0, calc(-33.3333% + ${dampedDelta}px), 0)`;
  }

  function endPointerGesture(event, { cancelled = false } = {}) {
    if (!activePointer || event.pointerId !== activePointer.id) {
      return;
    }

    const gesture = activePointer;
    activePointer = null;
    swatchCountDrum?.classList.remove("is-dragging");
    swatchCountDrum?.releasePointerCapture?.(event.pointerId);

    if (cancelled) {
      resetTrackPosition();
      return;
    }

    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaY) >= DRAG_COMMIT_THRESHOLD_PX) {
      step(deltaY < 0 ? 1 : -1);
      return;
    }

    if (!gesture.moved) {
      const bounds = swatchCountDrum?.getBoundingClientRect();
      const midpoint = bounds ? bounds.top + bounds.height / 2 : gesture.startY;
      step(event.clientY <= midpoint ? 1 : -1);
      return;
    }

    resetTrackPosition();
  }

  function handlePointerDown(event) {
    if (!swatchCountDrum || event.button !== 0 || activePointer) {
      return;
    }

    finishRoll();
    activePointer = {
      id: event.pointerId,
      moved: false,
      startY: event.clientY,
    };
    swatchCountDrum.classList.add("is-dragging");
    swatchCountDrum.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!activePointer || event.pointerId !== activePointer.id) {
      return;
    }

    const deltaY = event.clientY - activePointer.startY;
    activePointer.moved ||= Math.abs(deltaY) > TAP_SLOP_PX;
    setDragPreview(deltaY);
  }

  function handlePointerUp(event) {
    endPointerGesture(event);
  }

  function handlePointerCancel(event) {
    endPointerGesture(event, { cancelled: true });
  }

  function handleKeyDown(event) {
    const stepByKey = {
      ArrowDown: -1,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -1,
      PageUp: 1,
    }[event.key];

    if (stepByKey) {
      event.preventDefault();
      step(stepByKey, { animate: false });
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setValue(event.key === "Home" ? min : max, { animate: false });
    }
  }

  function on(element, eventName, handler) {
    element?.addEventListener(eventName, handler);
    cleanups.push(() => element?.removeEventListener(eventName, handler));
  }

  function bindEvents() {
    if (!swatchCountDrum || isBound) {
      return;
    }

    on(swatchCountDrum, "pointerdown", handlePointerDown);
    on(swatchCountDrum, "pointermove", handlePointerMove);
    on(swatchCountDrum, "pointerup", handlePointerUp);
    on(swatchCountDrum, "pointercancel", handlePointerCancel);
    on(swatchCountDrum, "keydown", handleKeyDown);
    isBound = true;
  }

  function initialize(swatchCount) {
    currentValue = clamp(Math.round(readNumericValue(swatchCount, currentValue)), min, max);
    finishRoll();
    syncAccessibleValue();
  }

  function cleanup() {
    activePointer = null;
    swatchCountDrum?.classList.remove("is-dragging");
    finishRoll();
  }

  function destroy() {
    cleanup();
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    isBound = false;
  }

  return {
    bindEvents,
    cleanup,
    destroy,
    getValue: () => currentValue,
    initialize,
  };
}
