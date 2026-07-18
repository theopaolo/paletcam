import { subscribeLocaleChange, t } from "../i18n.js";

const GRID_STORAGE_KEY = "paletcam:grid:v1";

/** @param {{ overlayHost?: HTMLElement | null }} [options] */
export function createCameraGridUiController({ overlayHost } = {}) {
  if (!overlayHost) {
    return { bindEvents() {}, destroy() {}, hide() {}, initialize() {}, show() {} };
  }

  const gridOverlay = document.createElement("div");
  gridOverlay.className = "camera-grid-overlay";
  gridOverlay.setAttribute("aria-hidden", "true");

  const toggleLayer = document.createElement("div");
  toggleLayer.className = "camera-grid-toggle-layer";

  const toggleButton = document.createElement("button");
  toggleButton.className = "camera-grid-toggle";
  toggleButton.type = "button";
  toggleButton.textContent = "GRID";

  toggleLayer.appendChild(toggleButton);
  overlayHost.appendChild(gridOverlay);
  overlayHost.appendChild(toggleLayer);

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
    toggleButton.classList.toggle("is-active", isVisible);
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
    toggleLayer.remove();
  }

  function hide() {
    toggleLayer.hidden = true;
  }

  function show() {
    toggleLayer.hidden = false;
  }

  function initialize() {
    isVisible = loadPersistedState();
    syncVisual();
  }

  return { bindEvents, destroy, hide, initialize, show };
}
