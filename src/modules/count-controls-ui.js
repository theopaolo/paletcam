import { t } from "../i18n.js";
import { boundaryFeedback, detentFeedback, unlockUiFeedback } from "./ui-feedback.js";

/** Same feel as the swatch drum: finger travel per detent, tap slop, end-stop damping. */
const DETENT_PX = 28;
const TAP_SLOP_PX = 4;
const RUBBER_BAND_FACTOR = 0.25;
const BOUNDARY_FEEDBACK_PX = 6;
/** Degrees the dial ring turns per value. */
const DIAL_STEP_DEG = 40;
/** How long the number stays in the dial's center after a turn. */
const DIAL_VALUE_HOLD_MS = 700;
/** ADJ lever: push past this to step once; hold to repeat. */
const LEVER_TRIGGER_PX = 16;
const LEVER_REARM_PX = 6;
const LEVER_REPEAT_DELAY_MS = 450;
const LEVER_REPEAT_MS = 240;
/** A click right after a turn must not open the catches. */
const CLICK_SUPPRESS_MS = 350;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* Capture calls can throw InvalidPointerId when the browser already released
   the pointer (cancel races); the gesture logic must survive that. */
function capturePointer(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* noop */
  }
}

function releasePointer(element, pointerId) {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    /* noop */
  }
}

/**
 * @typedef {object} CountControlOptions
 * @property {number} min
 * @property {number} max
 * @property {number} value
 * @property {(value: number) => void} onChange
 */

/**
 * @typedef {object} CountControl
 * @property {(value: number) => void} sync
 * @property {() => void} destroy
 */

/**
 * Rear dial wrapped around the catches button, after the rear dial and center
 * button of a camera body. Turn the ring for colors; a tap still reaches the
 * button in the center. By default the ring shows ticks only, and the number
 * appears in the center while turning. `numbered` engraves the counts on the
 * ring instead, read against the index.
 *
 * @param {CountControlOptions & { button: HTMLElement | null, numbered?: boolean }} options
 * @returns {CountControl}
 */
export function createCountDialUi({ button, min, max, value, onChange, numbered = false }) {
  if (!button?.parentElement) {
    return { sync() {}, destroy() {} };
  }

  const dial = document.createElement("div");
  dial.className = numbered ? "count-dial is-numbered" : "count-dial";
  dial.setAttribute("role", "group");
  dial.innerHTML =
    '<span class="count-dial-index" aria-hidden="true"></span><span class="count-dial-ring" aria-hidden="true"><span class="count-dial-face"></span></span><span class="count-dial-value" aria-hidden="true"></span>';
  const ring = /** @type {HTMLElement} */ (dial.querySelector(".count-dial-ring"));
  const face = /** @type {HTMLElement} */ (dial.querySelector(".count-dial-face"));
  const valueLabel = /** @type {HTMLElement} */ (dial.querySelector(".count-dial-value"));
  for (let tickValue = min; tickValue <= max; tickValue++) {
    const tick = document.createElement(numbered ? "b" : "i");
    tick.textContent = numbered ? String(tickValue) : "";
    tick.style.setProperty("--tick-angle", `${-(tickValue - min) * DIAL_STEP_DEG}deg`);
    face.append(tick);
  }
  button.before(dial);
  dial.append(button);

  let current = clamp(value, min, max);
  let gesture = null;
  let hideTimer = 0;
  let suppressClickUntil = 0;

  function paint(rawOffset = current - min) {
    ring.style.transform = `rotate(${(rawOffset * DIAL_STEP_DEG).toFixed(1)}deg)`;
    [...face.children].forEach((tick, index) => {
      tick.classList.toggle("is-on", index === current - min);
    });
    valueLabel.textContent = String(current);
    dial.setAttribute(
      "aria-label",
      `${t("slider.colorCountAria")}: ${t("slider.colorCount", { count: current })}`,
    );
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || gesture) {
      return;
    }
    unlockUiFeedback();
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: current,
      turning: false,
      cancelled: false,
      hitBoundary: false,
    };
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id || gesture.cancelled) {
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.turning) {
      if (Math.abs(dy) > TAP_SLOP_PX * 2 && Math.abs(dy) > Math.abs(dx)) {
        // A vertical swipe is neither a turn nor a tap.
        gesture.cancelled = true;
        return;
      }
      if (Math.abs(dx) <= TAP_SLOP_PX) {
        return;
      }
      gesture.turning = true;
      capturePointer(dial, event.pointerId);
      window.clearTimeout(hideTimer);
      dial.classList.add("is-turning", "is-dragging");
    }

    const span = max - min;
    let raw = gesture.start - min + dx / DETENT_PX;
    if (raw < 0 || raw > span) {
      const overshoot = raw < 0 ? raw : raw - span;
      raw = (raw < 0 ? 0 : span) + overshoot * RUBBER_BAND_FACTOR;
      if (
        !gesture.hitBoundary &&
        Math.abs(overshoot * DETENT_PX * RUBBER_BAND_FACTOR) > BOUNDARY_FEEDBACK_PX
      ) {
        gesture.hitBoundary = true;
        boundaryFeedback();
      }
    } else {
      gesture.hitBoundary = false;
    }

    const next = clamp(Math.round(raw) + min, min, max);
    if (next !== current) {
      current = next;
      detentFeedback();
      onChange(current);
    }
    paint(raw);
  }

  function handlePointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { turning, cancelled } = gesture;
    gesture = null;
    releasePointer(dial, event.pointerId);
    if (turning || cancelled) {
      suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
    }
    if (!turning) {
      return;
    }
    dial.classList.remove("is-dragging");
    paint();
    hideTimer = window.setTimeout(() => dial.classList.remove("is-turning"), DIAL_VALUE_HOLD_MS);
  }

  function handleClickCapture(event) {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  dial.addEventListener("pointerdown", handlePointerDown);
  dial.addEventListener("pointermove", handlePointerMove);
  dial.addEventListener("pointerup", handlePointerEnd);
  dial.addEventListener("pointercancel", handlePointerEnd);
  dial.addEventListener("click", handleClickCapture, true);
  paint();

  return {
    sync(nextValue) {
      current = clamp(nextValue, min, max);
      if (!gesture?.turning) {
        paint();
      }
    },
    destroy() {
      window.clearTimeout(hideTimer);
      dial.before(button);
      dial.remove();
    },
  };
}

/**
 * ADJ lever, after the Ricoh GR: a small spring-return rocker beside a counter
 * window. Push it right for more colors, left for fewer, hold to repeat. A tap
 * on either half steps toward that side.
 *
 * @param {CountControlOptions & { host: HTMLElement | null }} options
 * @returns {CountControl}
 */
export function createAdjLeverUi({ host, min, max, value, onChange }) {
  if (!host) {
    return { sync() {}, destroy() {} };
  }

  const control = document.createElement("div");
  control.className = "adj-control";
  control.setAttribute("role", "group");
  control.innerHTML =
    '<span class="adj-window" aria-hidden="true"></span><span class="adj-slot"><span class="adj-lever"></span></span>';
  const windowLabel = /** @type {HTMLElement} */ (control.querySelector(".adj-window"));
  const slot = /** @type {HTMLElement} */ (control.querySelector(".adj-slot"));
  const lever = /** @type {HTMLElement} */ (control.querySelector(".adj-lever"));
  host.append(control);

  let current = clamp(value, min, max);
  let gesture = null;
  let repeatTimer = 0;

  function paintWindow(direction = 0) {
    const roll = direction > 0 ? "is-rolling-up" : direction < 0 ? "is-rolling-down" : "";
    windowLabel.innerHTML = `<span class="${roll}">${current}</span>`;
    control.setAttribute(
      "aria-label",
      `${t("slider.colorCountAria")}: ${t("slider.colorCount", { count: current })}`,
    );
  }

  function nudge(direction) {
    const next = clamp(current + direction, min, max);
    if (next === current) {
      boundaryFeedback();
      return;
    }
    current = next;
    detentFeedback();
    paintWindow(direction);
    onChange(current);
  }

  function stopRepeat() {
    window.clearTimeout(repeatTimer);
  }

  function startRepeat(direction) {
    stopRepeat();
    const again = () => {
      nudge(direction);
      repeatTimer = window.setTimeout(again, LEVER_REPEAT_MS);
    };
    repeatTimer = window.setTimeout(again, LEVER_REPEAT_DELAY_MS);
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || gesture) {
      return;
    }
    unlockUiFeedback();
    gesture = { id: event.pointerId, x: event.clientX, fired: 0, moved: false };
    capturePointer(slot, event.pointerId);
    lever.classList.add("is-held");
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const dx = event.clientX - gesture.x;
    gesture.moved ||= Math.abs(dx) > TAP_SLOP_PX;
    lever.style.transform = `translateX(${(clamp(dx, -20, 20) * 0.4).toFixed(1)}px)`;
    const direction = dx > LEVER_TRIGGER_PX ? 1 : dx < -LEVER_TRIGGER_PX ? -1 : 0;
    if (direction && direction !== gesture.fired) {
      gesture.fired = direction;
      nudge(direction);
      startRepeat(direction);
    } else if (!direction && gesture.fired && Math.abs(dx) < LEVER_REARM_PX) {
      gesture.fired = 0;
      stopRepeat();
    }
  }

  function handlePointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { moved } = gesture;
    gesture = null;
    stopRepeat();
    releasePointer(slot, event.pointerId);
    lever.classList.remove("is-held");
    lever.style.transform = "";
    if (moved || event.type !== "pointerup") {
      return;
    }
    const bounds = slot.getBoundingClientRect();
    const direction = event.clientX < bounds.left + bounds.width / 2 ? -1 : 1;
    nudge(direction);
    lever.animate?.(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(${direction * 6}px)` },
        { transform: "translateX(0)" },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }

  slot.addEventListener("pointerdown", handlePointerDown);
  slot.addEventListener("pointermove", handlePointerMove);
  slot.addEventListener("pointerup", handlePointerEnd);
  slot.addEventListener("pointercancel", handlePointerEnd);
  paintWindow();

  return {
    sync(nextValue) {
      const next = clamp(nextValue, min, max);
      if (next !== current) {
        const direction = Math.sign(next - current);
        current = next;
        paintWindow(direction);
      }
    },
    destroy() {
      stopRepeat();
      control.remove();
    },
  };
}

/**
 * Shutter slide, after study F: slide sideways across the shutter for colors,
 * one detent per DETENT_PX, with the count shown in the shutter's center.
 * Swipe up or down and the tuning tray takes the finger. The first direction
 * the finger moves decides; a tap still catches.
 *
 * @param {CountControlOptions & {
 *   button: HTMLElement | null,
 *   onVerticalDrag: (event: PointerEvent, startY: number) => void,
 * }} options
 * @returns {CountControl}
 */
export function createShutterSlideUi({ button, min, max, value, onChange, onVerticalDrag }) {
  const host = button?.parentElement;
  if (!button || !host) {
    return { sync() {}, destroy() {} };
  }

  const readout = document.createElement("span");
  readout.className = "shutter-count";
  readout.setAttribute("aria-hidden", "true");
  button.append(readout);

  let current = clamp(value, min, max);
  let gesture = null;
  let hideTimer = 0;
  // Set once the finger travels, cleared on the next press: a drag never catches.
  let blockClick = false;

  function paint() {
    readout.textContent = String(current);
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || gesture) {
      return;
    }
    unlockUiFeedback();
    blockClick = false;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: current,
      sliding: false,
      hitBoundary: false,
    };
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.sliding) {
      if (Math.hypot(dx, dy) <= TAP_SLOP_PX * 2) {
        return;
      }
      blockClick = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        const startY = gesture.y;
        gesture = null;
        onVerticalDrag(event, startY);
        return;
      }
      gesture.sliding = true;
      capturePointer(button, event.pointerId);
      window.clearTimeout(hideTimer);
      button.classList.add("is-sliding");
    }

    const raw = gesture.start + dx / DETENT_PX;
    // Past an end stop: one bump at the same finger travel as the dial's.
    const overshootPx = Math.max(min - raw, raw - max, 0) * DETENT_PX;
    if (overshootPx * RUBBER_BAND_FACTOR > BOUNDARY_FEEDBACK_PX) {
      if (!gesture.hitBoundary) {
        gesture.hitBoundary = true;
        boundaryFeedback();
      }
    } else if (overshootPx === 0) {
      gesture.hitBoundary = false;
    }
    const next = clamp(Math.round(raw), min, max);
    if (next !== current) {
      current = next;
      detentFeedback();
      paint();
      onChange(current);
    }
  }

  function handlePointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { sliding } = gesture;
    gesture = null;
    releasePointer(button, event.pointerId);
    if (sliding) {
      hideTimer = window.setTimeout(
        () => button.classList.remove("is-sliding"),
        DIAL_VALUE_HOLD_MS,
      );
    }
  }

  // On the parent, in the capture phase, so it runs before the button's own click.
  function handleClickCapture(event) {
    if (blockClick && event.target instanceof Node && button.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  button.addEventListener("pointerdown", handlePointerDown);
  button.addEventListener("pointermove", handlePointerMove);
  button.addEventListener("pointerup", handlePointerEnd);
  button.addEventListener("pointercancel", handlePointerEnd);
  host.addEventListener("click", handleClickCapture, true);
  paint();

  return {
    sync(nextValue) {
      current = clamp(nextValue, min, max);
      paint();
    },
    destroy() {
      window.clearTimeout(hideTimer);
      button.removeEventListener("pointerdown", handlePointerDown);
      button.removeEventListener("pointermove", handlePointerMove);
      button.removeEventListener("pointerup", handlePointerEnd);
      button.removeEventListener("pointercancel", handlePointerEnd);
      host.removeEventListener("click", handleClickCapture, true);
      button.classList.remove("is-sliding");
      readout.remove();
    },
  };
}
