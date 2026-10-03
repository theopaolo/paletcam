import { subscribeLocaleChange, t } from "../i18n.js";
import { clampValue } from "./camera-scrubber-value.js";
import { showToast } from "./toast-ui.js";
import { boundaryFeedback, detentFeedback } from "./ui-feedback.js";
import { createWhiteBalanceLut, measureNeutralGains } from "./white-balance.js";

/* The held spot is read over this share of the frame width, averaged down to
   PATCH_SAMPLES² pixels, so texture and sensor noise do not skew it. */
const PATCH_SHARE = 0.05;
const PATCH_SAMPLES = 8;

function averageRgb(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    r += pixels[index];
    g += pixels[index + 1];
    b += pixels[index + 2];
  }
  const count = pixels.length / 4;
  return `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
}

/**
 * Long-press something white or gray on the preview and the live palette is
 * corrected for the color of the light, until the WB chip is tapped or the
 * camera restarts. Where the browser allows it the camera's own white balance
 * is locked too, so the correction stays right while you pan.
 *
 * @param {object} options
 * @param {HTMLElement | null} options.overlayHost
 * @param {HTMLVideoElement | null} options.cameraFeed
 * @param {CameraController} options.cameraController
 * @param {() => CropRect | null} options.getSourceRect visible part of the video, in video pixels
 * @param {() => boolean} options.isMirrored
 * @param {() => void} [options.onChange] the correction was set or cleared
 */
export function createWhiteBalanceUiController({
  overlayHost,
  cameraFeed,
  cameraController,
  getSourceRect,
  isMirrored,
  onChange,
}) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "camera-wb-chip";
  chip.hidden = true;
  const swatch = document.createElement("span");
  swatch.className = "camera-wb-swatch";
  chip.append(swatch, "WB");
  overlayHost?.appendChild(chip);

  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = PATCH_SAMPLES;
  patchCanvas.height = PATCH_SAMPLES;
  const patchContext = patchCanvas.getContext("2d", { willReadFrequently: true });

  /** @type {Uint8Array | null} */
  let lut = null;

  function syncLabel() {
    chip.setAttribute("aria-label", t("camera.whiteBalance.clear"));
  }
  syncLabel();
  const unsubscribeLocaleChange = subscribeLocaleChange(syncLabel);

  /** @param {CameraPoint} point normalized on the visible frame */
  function readPatch(point) {
    const videoWidth = cameraFeed?.videoWidth ?? 0;
    const videoHeight = cameraFeed?.videoHeight ?? 0;
    if (!cameraFeed || !patchContext || videoWidth <= 0 || videoHeight <= 0) {
      return null;
    }

    const rect = getSourceRect() ?? { x: 0, y: 0, width: videoWidth, height: videoHeight };
    const size = Math.max(2, Math.round(rect.width * PATCH_SHARE));
    const x = isMirrored() ? 1 - point.x : point.x;
    const left = clampValue(rect.x + x * rect.width - size / 2, rect.x, rect.x + rect.width - size);
    const top = clampValue(
      rect.y + point.y * rect.height - size / 2,
      rect.y,
      rect.y + rect.height - size,
    );
    patchContext.drawImage(cameraFeed, left, top, size, size, 0, 0, PATCH_SAMPLES, PATCH_SAMPLES);
    return patchContext.getImageData(0, 0, PATCH_SAMPLES, PATCH_SAMPLES).data;
  }

  /**
   * @param {CameraPoint} point
   * @returns {boolean} false when the spot was too dark, blown out or colorful
   */
  function pickAt(point) {
    const patch = readPatch(point);
    const gains = patch ? measureNeutralGains(patch) : null;
    if (!patch || !gains) {
      boundaryFeedback();
      showToast(t("camera.whiteBalance.rejected"), { duration: 2200 });
      return false;
    }

    lut = createWhiteBalanceLut(gains);
    swatch.style.backgroundColor = averageRgb(patch);
    chip.hidden = false;
    // The look drum's two-part latch: white balance is now held.
    detentFeedback("look", true);
    void cameraController.setWhiteBalanceLocked(true);
    onChange?.();
    return true;
  }

  function clear() {
    if (!lut) {
      return;
    }

    lut = null;
    chip.hidden = true;
    void cameraController.setWhiteBalanceLocked(false);
    onChange?.();
  }

  chip.addEventListener("click", clear);

  function destroy() {
    chip.removeEventListener("click", clear);
    unsubscribeLocaleChange();
    chip.remove();
  }

  return {
    clear,
    destroy,
    getLut: () => lut,
    pickAt,
  };
}
