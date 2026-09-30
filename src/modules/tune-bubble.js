/**
 * The bubble on the tuning tray's top edge. A tap toggles the tray through the
 * button's own click (config-panel-controller.js owns the open state); a swipe
 * up opens it and a swipe down closes it. The bubble bloops when the tray
 * opens or closes.
 */
const SWIPE_PX = 18;
/** The browser may still fire a click after a swipe; it must not toggle again. */
const CLICK_SUPPRESS_MS = 350;

/** @param {{ bubble: HTMLElement | null }} options @returns {() => void} cleanup */
export function bindTuneBubble({ bubble }) {
  if (!bubble) {
    return () => {};
  }

  let gesture = null;
  let suppressClickUntil = 0;
  let wasOpen = bubble.getAttribute("aria-expanded") === "true";

  function handlePointerDown(event) {
    gesture = { id: event.pointerId, y: event.clientY };
  }

  function handlePointerUp(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const dy = event.clientY - gesture.y;
    gesture = null;
    if (Math.abs(dy) < SWIPE_PX) {
      return;
    }
    const isOpen = bubble.getAttribute("aria-expanded") === "true";
    if (dy < 0 !== isOpen) {
      bubble.click();
    }
    suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
  }

  function handlePointerCancel() {
    gesture = null;
  }

  function handleClickCapture(event) {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleDrawerChange(event) {
    const isOpen = Boolean(event?.detail?.isOpen);
    if (isOpen === wasOpen) {
      return;
    }
    wasOpen = isOpen;
    bubble.classList.remove("is-blooping");
    void bubble.offsetWidth;
    bubble.classList.add("is-blooping");
  }

  function handleAnimationEnd() {
    bubble.classList.remove("is-blooping");
  }

  bubble.addEventListener("pointerdown", handlePointerDown);
  bubble.addEventListener("pointerup", handlePointerUp);
  bubble.addEventListener("pointercancel", handlePointerCancel);
  bubble.addEventListener("click", handleClickCapture, true);
  bubble.addEventListener("animationend", handleAnimationEnd);
  document.addEventListener("config-drawer-change", handleDrawerChange);

  return () => {
    bubble.removeEventListener("pointerdown", handlePointerDown);
    bubble.removeEventListener("pointerup", handlePointerUp);
    bubble.removeEventListener("pointercancel", handlePointerCancel);
    bubble.removeEventListener("click", handleClickCapture, true);
    bubble.removeEventListener("animationend", handleAnimationEnd);
    document.removeEventListener("config-drawer-change", handleDrawerChange);
  };
}
