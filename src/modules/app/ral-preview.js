import { findClosestRAL } from "../color-matching-ral.js";
import { relativeLuminance } from "../color-space-oklch.js";

const RAL_SMOOTHING_FACTOR = 0.18;
const RAL_COLOR_DISTANCE_THRESHOLD = 12;

/**
 * The single-color swatch: the color under the crosshair, its name, and the
 * nearest RAL Classic code in small type. Names load with color-name-api.js
 * on the first sample, so palette mode never pays for the name list.
 */
export function createRalPreviewController({
  ralLiveSwatch,
  ralLiveSwatchColor,
  ralLiveSwatchCode,
  ralLiveSwatchName,
  visualEffects,
  onColorChange = null,
}) {
  /** @type {{ r: number, g: number, b: number } | null} */
  let previousSampledColor = null;
  /** @type {{ match: RalMatch, sampledColor: { r: number, g: number, b: number } } | null} */
  let currentPreview = null;
  /** @type {Promise<typeof import("../color-name-api.js")> | null} */
  let colorNamesPromise = null;

  function clear() {
    ralLiveSwatch?.classList.remove("is-light-bg");
    if (ralLiveSwatchColor) {
      ralLiveSwatchColor.style.backgroundColor = "";
    }
    if (ralLiveSwatchCode) {
      ralLiveSwatchCode.textContent = "";
    }
    if (ralLiveSwatchName) {
      ralLiveSwatchName.textContent = "";
    }
  }

  function paintName(sampledColor) {
    colorNamesPromise ??= import("../color-name-api.js");
    void colorNamesPromise.then(async ({ getColorNames }) => {
      const [name] = await getColorNames([sampledColor]);
      // A newer sample may have landed while the name list loaded.
      if (ralLiveSwatchName && currentPreview?.sampledColor === sampledColor) {
        ralLiveSwatchName.textContent = name ?? "";
      }
    });
  }

  function sync(match, sampledColor) {
    const { r, g, b } = sampledColor;
    ralLiveSwatch?.classList.toggle("is-light-bg", relativeLuminance(r, g, b) > 0.179);
    if (ralLiveSwatchColor) {
      ralLiveSwatchColor.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }
    if (ralLiveSwatchCode) {
      ralLiveSwatchCode.textContent = match.ral.code;
    }
    paintName(sampledColor);

    visualEffects.setCaptureButtonGlowColor(sampledColor);
    visualEffects.setCaptureGlowActive(true);
    onColorChange?.(sampledColor);
  }

  function smooth(raw) {
    if (!previousSampledColor) {
      previousSampledColor = raw;
      return raw;
    }

    const distance = Math.hypot(
      raw.r - previousSampledColor.r,
      raw.g - previousSampledColor.g,
      raw.b - previousSampledColor.b,
    );

    if (distance < RAL_COLOR_DISTANCE_THRESHOLD) {
      return previousSampledColor;
    }

    const smoothed = {
      r: Math.round(
        previousSampledColor.r + (raw.r - previousSampledColor.r) * RAL_SMOOTHING_FACTOR,
      ),
      g: Math.round(
        previousSampledColor.g + (raw.g - previousSampledColor.g) * RAL_SMOOTHING_FACTOR,
      ),
      b: Math.round(
        previousSampledColor.b + (raw.b - previousSampledColor.b) * RAL_SMOOTHING_FACTOR,
      ),
    };

    previousSampledColor = smoothed;
    return smoothed;
  }

  function reset() {
    previousSampledColor = null;
    currentPreview = null;
  }

  /** @param {{ r: number, g: number, b: number }} rawColor the crosshair's average */
  function update(rawColor) {
    const sampledColor = smooth(rawColor);
    // Held inside the smoothing threshold: nothing on screen changes.
    if (currentPreview?.sampledColor === sampledColor) {
      return currentPreview.match;
    }

    const match = findClosestRAL(sampledColor.r, sampledColor.g, sampledColor.b, 1)[0] ?? null;
    if (!match) {
      currentPreview = null;
      clear();
      visualEffects.setCaptureGlowActive(false);
      return null;
    }

    currentPreview = { match, sampledColor };
    sync(match, sampledColor);
    return match;
  }

  function resyncCopy() {
    if (currentPreview) {
      sync(currentPreview.match, currentPreview.sampledColor);
    }
  }

  return {
    clear,
    getCurrentPreview: () => currentPreview,
    reset,
    resyncCopy,
    update,
  };
}
