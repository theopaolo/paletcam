import { findClosestRAL, getRalQualityLabel } from "../color-matching-ral.js";
import { relativeLuminance } from "../color-space-oklch.js";
import { sampleColorFromContextAtPoint } from "../ral-live-sampling.js";

const RAL_SMOOTHING_FACTOR = 0.18;
const RAL_COLOR_DISTANCE_THRESHOLD = 12;

export function createRalPreviewController({
  ralLiveSwatch,
  ralLiveSwatchColor,
  ralLiveSwatchCode,
  ralLiveSwatchName,
  ralLiveSwatchQuality,
  visualEffects,
}) {
  /** @type {{ r: number, g: number, b: number } | null} */
  let previousSampledColor = null;
  /** @type {{ match: RalMatch, sampledColor: { r: number, g: number, b: number } } | null} */
  let currentPreview = null;

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
    if (ralLiveSwatchQuality) {
      ralLiveSwatchQuality.textContent = "";
    }
  }

  function sync(match, sampledColor) {
    if (ralLiveSwatch) {
      const isLight = relativeLuminance(match.ral.r, match.ral.g, match.ral.b) > 0.179;
      ralLiveSwatch.classList.toggle("is-light-bg", isLight);
    }
    if (ralLiveSwatchColor) {
      ralLiveSwatchColor.style.backgroundColor = `rgb(${match.ral.r}, ${match.ral.g}, ${match.ral.b})`;
    }
    if (ralLiveSwatchCode) {
      ralLiveSwatchCode.textContent = match.ral.code;
    }
    if (ralLiveSwatchName) {
      ralLiveSwatchName.textContent = match.ral.name;
    }
    if (ralLiveSwatchQuality) {
      ralLiveSwatchQuality.textContent = `${getRalQualityLabel(match.deltaE)}`;
    }

    visualEffects.setCaptureButtonGlowColor(sampledColor);
    visualEffects.setCaptureGlowActive(true);
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

  function readCurrentMatch(context, width, height) {
    const rawColor = sampleColorFromContextAtPoint(context, width, height, width / 2, height / 2);
    const sampledColor = smooth(rawColor);
    const matches = findClosestRAL(sampledColor.r, sampledColor.g, sampledColor.b, 1);
    const match = matches[0] ?? null;

    if (!match) {
      currentPreview = null;
      clear();
      visualEffects.setCaptureGlowActive(false);
      return null;
    }

    currentPreview = {
      match,
      sampledColor: { ...sampledColor },
    };
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
    readCurrentMatch,
    reset,
    resyncCopy,
  };
}
