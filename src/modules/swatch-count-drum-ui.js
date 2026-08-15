import { t } from "../i18n.js";
import { boundaryFeedback, detentFeedback, unlockUiFeedback } from "./ui-feedback.js";

/** Finger travel that crosses one detent (value step). */
const DETENT_PX = 28;
/** Track row height in px; finger travel maps to track travel by this ratio. */
const TRACK_ROW_PX = 24;
const FINGER_TO_TRACK_RATIO = TRACK_ROW_PX / DETENT_PX;
/** Damping applied to drag travel past the min/max end stops. */
const RUBBER_BAND_FACTOR = 0.25;
/** Damped overtravel beyond which the end-stop thunk fires. */
const BOUNDARY_FEEDBACK_PX = 6;
const TAP_SLOP_PX = 4;
/** Must cover the CSS roll/settle transition, plus a small buffer. */
const ROLL_DURATION_MS = 280;
/** Track centering lives in CSS (--drum-center); JS only offsets from it. */
const CENTERED_TRACK_TRANSFORM = "translate3d(0, var(--drum-center, -33.3333%), 0)";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readNumericValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* Capture calls can throw InvalidPointerId when the browser already released
   the pointer (cancel races); the gesture logic must survive that. */
function capturePointer(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    /* noop */
  }
}

function releasePointer(element, pointerId) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    /* noop */
  }
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
    swatchCountDrum?.classList.remove("is-rolling", "is-settling");
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
    track.style.transform = `translate3d(0, calc(var(--drum-center, -33.3333%) ${direction > 0 ? "-" : "+"} 33.3333%), 0)`;

    rollTimeout = globalThis.window?.setTimeout(finishRoll, ROLL_DURATION_MS) ?? 0;
  }

  function settleToCenter() {
    if (!track || prefersReducedMotion()) {
      finishRoll();
      return;
    }

    swatchCountDrum?.classList.add("is-settling");
    track.style.transition = "";
    track.style.transform = CENTERED_TRACK_TRANSFORM;
    rollTimeout = globalThis.window?.setTimeout(finishRoll, ROLL_DURATION_MS) ?? 0;
  }

  /** Commit a value reached mid-drag: numbers rebase, no roll animation. */
  function applyValue(nextValue) {
    currentValue = nextValue;
    renderTrack();
    syncAccessibleValue();
    onSwatchCountChange?.(currentValue);
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
    detentFeedback();

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

  function endPointerGesture(event, { cancelled = false } = {}) {
    if (!activePointer || event.pointerId !== activePointer.id) {
      return;
    }

    const gesture = activePointer;
    activePointer = null;
    swatchCountDrum?.classList.remove("is-dragging");
    releasePointer(swatchCountDrum, event.pointerId);

    if (!cancelled && !gesture.moved) {
      const bounds = swatchCountDrum?.getBoundingClientRect();
      const midpoint = bounds ? bounds.top + bounds.height / 2 : gesture.startY;
      step(event.clientY <= midpoint ? 1 : -1);
      return;
    }

    settleToCenter();
  }

  function handlePointerDown(event) {
    if (!swatchCountDrum || event.button !== 0 || activePointer) {
      return;
    }

    unlockUiFeedback();
    finishRoll();
    activePointer = {
      committedSteps: 0,
      hitBoundary: false,
      id: event.pointerId,
      moved: false,
      startY: event.clientY,
    };
    swatchCountDrum.classList.add("is-dragging");
    capturePointer(swatchCountDrum, event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!activePointer || event.pointerId !== activePointer.id) {
      return;
    }

    const gesture = activePointer;
    // Upward-positive travel: dragging up rolls higher numbers into view.
    const travel = gesture.startY - event.clientY;
    gesture.moved ||= Math.abs(travel) > TAP_SLOP_PX;

    const baseValue = clamp(currentValue - gesture.committedSteps, min, max);
    const rawSteps = Math.round(travel / DETENT_PX);
    const targetValue = clamp(baseValue + rawSteps, min, max);
    const steps = targetValue - baseValue;
    if (steps !== gesture.committedSteps) {
      gesture.committedSteps = steps;
      applyValue(targetValue);
      detentFeedback();
    }

    if (!track) {
      return;
    }

    let remainder = travel - steps * DETENT_PX;
    const pastUpperStop = currentValue >= max && remainder > 0;
    const pastLowerStop = currentValue <= min && remainder < 0;
    if (pastUpperStop || pastLowerStop) {
      remainder *= RUBBER_BAND_FACTOR;
      if (!gesture.hitBoundary && Math.abs(remainder) > BOUNDARY_FEEDBACK_PX) {
        gesture.hitBoundary = true;
        boundaryFeedback();
      }
    } else {
      gesture.hitBoundary = false;
    }

    const trackOffsetPx = -remainder * FINGER_TO_TRACK_RATIO;
    track.style.transition = "none";
    track.style.transform = `translate3d(0, calc(var(--drum-center, -33.3333%) + ${trackOffsetPx}px), 0)`;
  }

  function handlePointerUp(event) {
    endPointerGesture(event);
  }

  function handlePointerCancel(event) {
    endPointerGesture(event, { cancelled: true });
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
