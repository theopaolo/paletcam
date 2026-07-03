function toRgbToken(color) {
  return `${color.r}, ${color.g}, ${color.b}`;
}

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.captureButton]
 * @param {HTMLElement | null} [options.swatchSliderShell]
 * @returns {VisualEffects}
 */
export function createVisualEffects({
  captureButton,
  swatchSliderShell,
} = {}) {
  let lastCaptureGlowRgb = '';
  let lastRibbonKey = '';

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

  function setPaletteRibbon(colors) {
    if (!swatchSliderShell) {
      return;
    }

    if (!Array.isArray(colors) || colors.length === 0) {
      if (lastRibbonKey !== '') {
        swatchSliderShell.style.removeProperty('--palette-ribbon');
        lastRibbonKey = '';
      }
      return;
    }

    const ribbonKey = colors.map(toRgbToken).join(';');
    if (ribbonKey === lastRibbonKey) {
      return;
    }

    const segmentWidth = 100 / colors.length;
    const stops = colors
      .map((color, index) => {
        const from = (index * segmentWidth).toFixed(2);
        const to = ((index + 1) * segmentWidth).toFixed(2);
        return `rgb(${toRgbToken(color)}) ${from}% ${to}%`;
      })
      .join(', ');

    swatchSliderShell.style.setProperty('--palette-ribbon', `linear-gradient(to right, ${stops})`);
    lastRibbonKey = ribbonKey;
  }

  return {
    setCaptureButtonGlowColor,
    setCaptureGlowActive,
    setPaletteRibbon,
  };
}
