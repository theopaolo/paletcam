import { updateSliderTooltip } from './camera-ui.js';

const DEFAULT_SWATCH_ACTIVE_PULSE_MS = 170;

export function createSwatchSliderUiController({
  swatchSlider,
  onSwatchCountChange,
  activePulseMs = DEFAULT_SWATCH_ACTIVE_PULSE_MS,
} = {}) {
  let activePulseTimeout = 0;

  function getSliderPanel() {
    return swatchSlider?.closest('.swatch-slider') ?? null;
  }

  function setDragState(isDragging) {
    getSliderPanel()?.classList.toggle('is-dragging', isDragging);
  }

  function pulseActiveIndicator() {
    const sliderPanel = getSliderPanel();
    if (!sliderPanel) {
      return;
    }

    sliderPanel.classList.add('is-active');

    if (activePulseTimeout) {
      window.clearTimeout(activePulseTimeout);
    }

    activePulseTimeout = window.setTimeout(() => {
      sliderPanel.classList.remove('is-active');
      activePulseTimeout = 0;
    }, activePulseMs);
  }

  function bindEvents() {
    if (!swatchSlider) {
      return;
    }

    swatchSlider.addEventListener('pointerdown', () => {
      setDragState(true);
      pulseActiveIndicator();
      window.addEventListener('pointerup', () => setDragState(false), { once: true });
    });

    swatchSlider.addEventListener('pointercancel', () => setDragState(false));
    swatchSlider.addEventListener('blur', () => setDragState(false));
    swatchSlider.addEventListener('input', (event) => {
      const nextSwatchCount = Number(event.target.value);

      if (!Number.isFinite(nextSwatchCount) || nextSwatchCount < 1) {
        return;
      }

      onSwatchCountChange?.(nextSwatchCount);
      updateSliderTooltip(swatchSlider, nextSwatchCount);
      pulseActiveIndicator();
    });
  }

  function initialize(swatchCount) {
    updateSliderTooltip(swatchSlider, swatchCount);
  }

  function cleanup() {
    if (activePulseTimeout) {
      window.clearTimeout(activePulseTimeout);
      activePulseTimeout = 0;
    }

    const sliderPanel = getSliderPanel();
    sliderPanel?.classList.remove('is-active');
    sliderPanel?.classList.remove('is-dragging');
  }

  return {
    bindEvents,
    cleanup,
    initialize,
  };
}

