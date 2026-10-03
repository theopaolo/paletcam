/**
 * Motion of the tuning tray. config-panel-controller.js owns whether the tray is
 * open (the bubble is its toggle button); this module moves it:
 *
 * - a tap on the bubble toggles through the button's own click;
 * - a drag on the bubble moves the tray with the finger, then settles open or
 *   closed from where it was let go and how fast it was moving;
 * - any open or close (tap, drag, Escape, a tap outside) slides the tray, and
 *   the bubble bloops;
 * - `beginDrag` hands the tray a finger that went down elsewhere (the shutter
 *   slide variant in footer-lab.js), and the drag goes on as if it started on
 *   the bubble.
 *
 * The tray slides over the palette on `transform` only, so a drag or a settle
 * never re-lays out the page and the settle runs on the compositor. The CSS
 * owns the rest positions; while a finger holds the tray, inline transforms
 * do, and dropping them lets the CSS transition carry the tray home.
 */
const DRAG_SLOP_PX = 6;
const RUBBER_BAND = 0.25;
/** A flick faster than this (px/ms) decides the direction whatever the position. */
const FLICK_SPEED = 0.35;
/** Share of the tray's height a slow drag must cover to change its state. */
const SWITCH_SHARE = 1 / 3;
/** The browser may still fire a click after a drag; it must not toggle again. */
const CLICK_SUPPRESS_MS = 350;

/**
 * @param {{ tray: HTMLElement | null }} options
 * @returns {{ beginDrag: (event: PointerEvent, startY: number) => void, destroy: () => void }}
 */
export function bindTuneTray({ tray }) {
  const bubble = /** @type {HTMLElement | null} */ (tray?.querySelector(".tune-bubble") ?? null);
  const body = /** @type {HTMLElement | null} */ (tray?.querySelector(".tune-tray-body") ?? null);
  if (!tray || !bubble || !body) {
    return { beginDrag() {}, destroy() {} };
  }

  let isOpen = bubble.getAttribute("aria-expanded") === "true";
  let gesture = null;
  let suppressClickUntil = 0;

  // Translation leaves the box height alone; unrounded, so the bubble sits flush.
  const fullHeight = () => body.getBoundingClientRect().height;
  // The tray has no height of its own: its top is the footer's top edge.
  const visibleHeight = () => tray.getBoundingClientRect().top - body.getBoundingClientRect().top;

  // The bubble rides the tray's top edge; the CSS lifts it by this much when
  // open. The edge moves at once when the drawer resizes (RAL hides the
  // tuning), so the bubble skips its slide and moves with it.
  const resizeObserver = new ResizeObserver(() => {
    bubble.style.transition = "none";
    tray.style.setProperty("--tray-height", `${fullHeight()}px`);
    void bubble.offsetWidth;
    bubble.style.transition = "";
  });
  resizeObserver.observe(body);

  function holdAt(height) {
    body.style.transform = `translateY(${fullHeight() - height}px)`;
    bubble.style.transform = `translateY(${-height}px)`;
  }

  function settle() {
    tray.classList.remove("is-dragging");
    body.style.transform = "";
    bubble.style.transform = "";
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

  /** @param {PointerEvent} event @param {number} [startY] where the finger went down */
  function beginDrag(event, startY = event.clientY) {
    if (gesture) {
      return;
    }
    gesture = {
      id: event.pointerId,
      startY,
      startHeight: 0,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      speed: 0,
      moved: false,
    };
    try {
      bubble.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (a cancel race): no drag to follow.
      gesture = null;
    }
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    if (!gesture.moved) {
      if (Math.abs(gesture.startY - event.clientY) < DRAG_SLOP_PX) {
        return;
      }
      // Catch the tray where it is, mid-settle included, and follow from here.
      gesture.moved = true;
      gesture.startY = event.clientY;
      gesture.startHeight = visibleHeight();
      holdAt(gesture.startHeight);
      tray.classList.add("is-dragging");
    }

    const full = fullHeight();
    let height = gesture.startHeight + gesture.startY - event.clientY;
    if (height > full) height = full + (height - full) * RUBBER_BAND;
    holdAt(Math.max(0, height));

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
    const openShare = visibleHeight() / fullHeight();
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

  bubble.addEventListener("pointerdown", beginDrag);
  bubble.addEventListener("pointermove", handlePointerMove);
  bubble.addEventListener("pointerup", handlePointerEnd);
  bubble.addEventListener("pointercancel", handlePointerEnd);
  bubble.addEventListener("click", handleClickCapture, true);
  bubble.addEventListener("animationend", handleAnimationEnd);
  document.addEventListener("config-drawer-change", handleDrawerChange);

  function destroy() {
    resizeObserver.disconnect();
    bubble.removeEventListener("pointerdown", beginDrag);
    bubble.removeEventListener("pointermove", handlePointerMove);
    bubble.removeEventListener("pointerup", handlePointerEnd);
    bubble.removeEventListener("pointercancel", handlePointerEnd);
    bubble.removeEventListener("click", handleClickCapture, true);
    bubble.removeEventListener("animationend", handleAnimationEnd);
    document.removeEventListener("config-drawer-change", handleDrawerChange);
  }

  return { beginDrag, destroy };
}
