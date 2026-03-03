function toRgbToken(color) {
  return `${color.r}, ${color.g}, ${color.b}`;
}

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.captureButton]
 * @returns {VisualEffects}
 */
export function createVisualEffects({
  captureButton,
} = {}) {
  let lastCaptureGlowRgb = '';
  function setCaptureButtonGlowColor(color) {
    if (!captureButton || !color) {
      return;
    }

    const rgbToken = toRgbToken(color);
    if (rgbToken === lastCaptureGlowRgb) {
      return;
    }

    captureButton.style.setProperty('--capture-glow-rgb', rgbToken);
    lastCaptureGlowRgb = rgbToken;
  }

  function setCaptureGlowActive(isActive) {
    captureButton?.classList.toggle('is-catching', isActive);
  }

  return {
    setCaptureButtonGlowColor,
    setCaptureGlowActive,
  };
}

