import { t } from "../i18n.js";

export const PHOTO_QUALITY_MODES = ["sd", "hd", "fhd"];

export const PHOTO_QUALITY_EXPORT_VALUES = {
  sd: 0.72,
  hd: 0.85,
  fhd: 0.98,
};

const QUALITY_LABELS = { sd: "SD", hd: "HD", fhd: "FHD" };

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.overlayHost]
 * @param {((mode: string) => void) | null} [options.onModeChange]
 */
export function createPhotoQualityUiController({ overlayHost, onModeChange } = {}) {
  if (!overlayHost) {
    return {
      bindEvents() {},
      destroy() {},
      hide() {},
      initialize() {},
      show() {},
      syncMode() {},
    };
  }

  const layer = document.createElement("div");
  layer.className = "camera-quality-layer";

  const chip = document.createElement("button");
  chip.className = "camera-quality-chip";
  chip.type = "button";

  layer.appendChild(chip);
  overlayHost.appendChild(layer);

  let isBound = false;
  let currentMode = "hd";

  function updateDisplay(mode) {
    currentMode = PHOTO_QUALITY_MODES.includes(mode) ? mode : "hd";
    chip.textContent = QUALITY_LABELS[currentMode];
    chip.dataset.mode = currentMode;
    chip.setAttribute(
      "aria-label",
      t("camera.quality.aria", { mode: QUALITY_LABELS[currentMode] }),
    );
  }

  function handleClick() {
    const nextIndex = (PHOTO_QUALITY_MODES.indexOf(currentMode) + 1) % PHOTO_QUALITY_MODES.length;
    onModeChange?.(PHOTO_QUALITY_MODES[nextIndex]);
  }

  function bindEvents() {
    if (isBound) {
      return;
    }

    chip.addEventListener("click", handleClick);
    isBound = true;
  }

  function destroy() {
    if (isBound) {
      chip.removeEventListener("click", handleClick);
      isBound = false;
    }

    layer.remove();
  }

  function syncMode(mode) {
    updateDisplay(mode);
  }

  function hide() {
    layer.hidden = true;
  }

  function show() {
    layer.hidden = false;
  }

  function initialize(mode) {
    updateDisplay(mode ?? "hd");
  }

  return { bindEvents, destroy, hide, initialize, show, syncMode };
}
