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

/** Position of `count` among `values`, or of the nearest one. */
function positionOf(values, count) {
  let best = 0;
  values.forEach((value, index) => {
    if (Math.abs(value - count) < Math.abs(values[best] - count)) {
      best = index;
    }
  });
  return best;
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
 * @param {number[]} [options.values] counts the drum rolls through, in order (defaults to data-min..data-max)
 * @param {((count: number) => void) | null} [options.onSwatchCountChange]
 * @returns {SwatchCountDrumUiController}
 */
export function createSwatchCountDrumUiController({
  swatchCountDrum,
  values: valuesOption,
  onSwatchCountChange,
} = {}) {
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
  const values = valuesOption ?? Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const last = values.length - 1;
  const cleanups = [];
  /** Position among `values`, not the count. */
  let position = positionOf(
    values,
    readNumericValue(
      swatchCountDrum?.dataset.value ?? swatchCountDrum?.getAttribute("aria-valuenow"),
      4,
    ),
  );
  let activePointer = null;
  let rollTimeout = 0;
  let isBound = false;

  function prefersReducedMotion() {
    return globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function renderTrack() {
    if (previousNumber) {
      previousNumber.textContent = position > 0 ? String(values[position - 1]) : "";
    }
    if (currentNumber) {
      currentNumber.textContent = String(values[position]);
    }
    if (nextNumber) {
      nextNumber.textContent = position < last ? String(values[position + 1]) : "";
    }
  }

  function syncAccessibleValue() {
    if (!swatchCountDrum) {
      return;
    }

    const count = values[position];
    swatchCountDrum.dataset.value = String(count);
    swatchCountDrum.setAttribute("aria-label", t("slider.colorCountAria"));
    swatchCountDrum.setAttribute("aria-valuemin", String(values[0]));
    swatchCountDrum.setAttribute("aria-valuemax", String(values[last]));
    swatchCountDrum.setAttribute("aria-valuenow", String(count));
    swatchCountDrum.setAttribute("aria-valuetext", t("slider.colorCount", { count }));

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

  /** Commit a position reached mid-drag: numbers rebase, no roll animation. */
  function applyPosition(nextPosition) {
    position = nextPosition;
    renderTrack();
    syncAccessibleValue();
    onSwatchCountChange?.(values[position]);
  }

  function setPosition(nextPosition, { animate = true } = {}) {
    const normalizedPosition = clamp(Math.round(nextPosition), 0, last);
    if (normalizedPosition === position) {
      finishRoll();
      return false;
    }

    finishRoll();
    const direction = normalizedPosition > position ? 1 : -1;
    position = normalizedPosition;
    syncAccessibleValue();
    onSwatchCountChange?.(values[position]);
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
    return setPosition(position + direction, options);
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

    const basePosition = clamp(position - gesture.committedSteps, 0, last);
    const rawSteps = Math.round(travel / DETENT_PX);
    const targetPosition = clamp(basePosition + rawSteps, 0, last);
    const steps = targetPosition - basePosition;
    if (steps !== gesture.committedSteps) {
      gesture.committedSteps = steps;
      applyPosition(targetPosition);
      detentFeedback();
    }

    if (!track) {
      return;
    }

    let remainder = travel - steps * DETENT_PX;
    const pastUpperStop = position >= last && remainder > 0;
    const pastLowerStop = position <= 0 && remainder < 0;
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
    position = positionOf(values, readNumericValue(swatchCount, values[position]));
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
    getValue: () => values[position],
    initialize,
  };
}
