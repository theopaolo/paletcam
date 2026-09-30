/**
 * Motion of the tuning tray. config-panel-controller.js owns whether the tray is
 * open (the bubble is its toggle button); this module owns the tray's height:
 *
 * - a tap on the bubble toggles through the button's own click;
 * - a drag on the bubble moves the tray with the finger, then settles open or
 *   closed from where it was let go and how fast it was moving;
 * - any open or close (tap, drag, Escape, a tap outside) animates the height,
 *   and the bubble bloops.
 */
const DRAG_SLOP_PX = 6;
const RUBBER_BAND = 0.25;
/** A flick faster than this (px/ms) decides the direction whatever the position. */
const FLICK_SPEED = 0.35;
/** Share of the tray's height a slow drag must cover to change its state. */
const SWITCH_SHARE = 1 / 3;
/** The browser may still fire a click after a drag; it must not toggle again. */
const CLICK_SUPPRESS_MS = 350;

/** @param {{ tray: HTMLElement | null }} options @returns {() => void} cleanup */
export function bindTuneTray({ tray }) {
  const bubble = /** @type {HTMLElement | null} */ (tray?.querySelector(".tune-bubble") ?? null);
  const clip = /** @type {HTMLElement | null} */ (tray?.querySelector(".tune-tray-clip") ?? null);
  const body = /** @type {HTMLElement | null} */ (tray?.querySelector(".tune-tray-body") ?? null);
  if (!tray || !bubble || !clip || !body) {
    return () => {};
  }

  let isOpen = bubble.getAttribute("aria-expanded") === "true";
  let gesture = null;
  let suppressClickUntil = 0;

  const currentHeight = () => clip.getBoundingClientRect().height;

  function finishSettle() {
    clip.classList.remove("is-settling");
    // Open, the tray takes its content's height, so panels can change size.
    clip.style.height = isOpen ? "auto" : "";
  }

  function settle() {
    const from = currentHeight();
    const to = isOpen ? body.scrollHeight : 0;
    tray.classList.remove("is-dragging");
    if (Math.abs(from - to) < 1) {
      finishSettle();
      return;
    }
    clip.style.height = `${from}px`;
    void clip.offsetHeight;
    clip.classList.add("is-settling");
    clip.style.height = `${to}px`;
  }

  function bloop() {
    bubble.classList.remove("is-blooping");
    void bubble.offsetWidth;
    bubble.classList.add("is-blooping");
  }

  function handleDrawerChange(event) {
    const nextOpen = Boolean(event?.detail?.isOpen);
    if (nextOpen === isOpen) {
      return;
    }
    isOpen = nextOpen;
    bloop();
    if (!gesture?.moved) {
      settle();
    }
  }

  function handleTransitionEnd(event) {
    if (event.target === clip && event.propertyName === "height") {
      finishSettle();
    }
  }

  function handlePointerDown(event) {
    if (gesture) {
      return;
    }
    gesture = {
      id: event.pointerId,
      startY: event.clientY,
      startHeight: currentHeight(),
      lastY: event.clientY,
      lastTime: event.timeStamp,
      speed: 0,
      moved: false,
    };
    bubble.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const travel = gesture.startY - event.clientY;
    if (!gesture.moved) {
      if (Math.abs(travel) < DRAG_SLOP_PX) {
        return;
      }
      gesture.moved = true;
      clip.classList.remove("is-settling");
      tray.classList.add("is-dragging");
    }

    const full = body.scrollHeight;
    let height = gesture.startHeight + travel;
    if (height > full) height = full + (height - full) * RUBBER_BAND;
    clip.style.height = `${Math.max(0, height)}px`;

    const elapsed = event.timeStamp - gesture.lastTime;
    if (elapsed > 0) {
      gesture.speed = (gesture.lastY - event.clientY) / elapsed;
    }
    gesture.lastY = event.clientY;
    gesture.lastTime = event.timeStamp;
  }

  function handlePointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { moved, speed } = gesture;
    gesture = null;
    if (!moved) {
      // A tap: the button's click toggles the tray.
      return;
    }

    suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
    const openShare = currentHeight() / body.scrollHeight;
    const shouldOpen =
      Math.abs(speed) > FLICK_SPEED
        ? speed > 0
        : isOpen
          ? openShare > 1 - SWITCH_SHARE
          : openShare > SWITCH_SHARE;
    if (shouldOpen !== isOpen) {
      // The controller flips its state; handleDrawerChange settles from here.
      bubble.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } else {
      settle();
    }
  }

  function handleClickCapture(event) {
    if (event.isTrusted && performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleAnimationEnd() {
    bubble.classList.remove("is-blooping");
  }

  bubble.addEventListener("pointerdown", handlePointerDown);
  bubble.addEventListener("pointermove", handlePointerMove);
  bubble.addEventListener("pointerup", handlePointerEnd);
  bubble.addEventListener("pointercancel", handlePointerEnd);
  bubble.addEventListener("click", handleClickCapture, true);
  bubble.addEventListener("animationend", handleAnimationEnd);
  clip.addEventListener("transitionend", handleTransitionEnd);
  document.addEventListener("config-drawer-change", handleDrawerChange);

  return () => {
    bubble.removeEventListener("pointerdown", handlePointerDown);
    bubble.removeEventListener("pointermove", handlePointerMove);
    bubble.removeEventListener("pointerup", handlePointerEnd);
    bubble.removeEventListener("pointercancel", handlePointerEnd);
    bubble.removeEventListener("click", handleClickCapture, true);
    bubble.removeEventListener("animationend", handleAnimationEnd);
    clip.removeEventListener("transitionend", handleTransitionEnd);
    document.removeEventListener("config-drawer-change", handleDrawerChange);
  };
}
