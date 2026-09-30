import { subscribeLocaleChange, t } from "../i18n.js";

const GRID_STORAGE_KEY = "paletcam:grid:v1";

/**
 * Thirds over the live preview. The toggle is the Grid key in the tuning tray,
 * so nothing sits on the feed at rest.
 *
 * @param {{ overlayHost?: HTMLElement | null, toggleButton?: HTMLButtonElement | null }} [options]
 */
export function createCameraGridUiController({ overlayHost, toggleButton } = {}) {
  if (!overlayHost || !toggleButton) {
    return { bindEvents() {}, destroy() {}, initialize() {} };
  }

  const gridOverlay = document.createElement("div");
  gridOverlay.className = "camera-grid-overlay";
  gridOverlay.setAttribute("aria-hidden", "true");
  overlayHost.appendChild(gridOverlay);

  let isBound = false;
  let isVisible = false;

  const unsubscribeLocaleChange = subscribeLocaleChange(syncA11y);

  function loadPersistedState() {
    try {
      return globalThis.localStorage?.getItem(GRID_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function saveState() {
    try {
      globalThis.localStorage?.setItem(GRID_STORAGE_KEY, isVisible ? "1" : "0");
    } catch {}
  }

  function syncA11y() {
    toggleButton.setAttribute("aria-label", t("camera.grid.aria"));
    toggleButton.setAttribute("aria-pressed", String(isVisible));
  }

  function syncVisual() {
    gridOverlay.classList.toggle("is-visible", isVisible);
    syncA11y();
  }

  function toggle() {
    isVisible = !isVisible;
    saveState();
    syncVisual();
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    toggleButton.addEventListener("click", toggle);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      toggleButton.removeEventListener("click", toggle);
      isBound = false;
    }

    unsubscribeLocaleChange();
    gridOverlay.remove();
  }

  function initialize() {
    isVisible = loadPersistedState();
    syncVisual();
  }

  return { bindEvents, destroy, initialize };
}
