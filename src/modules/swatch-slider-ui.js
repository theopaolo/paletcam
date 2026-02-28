import { updateSliderTooltip } from './camera-ui.js';

const DEFAULT_SWATCH_ACTIVE_PULSE_MS = 170;

export function createSwatchSliderUiController({
  swatchSlider,
  onSwatchCountChange,
  activePulseMs = DEFAULT_SWATCH_ACTIVE_PULSE_MS,
} = {}) {
  let activePulseTimeout = 0;
  let pendingPointerUpHandler = null;
  let isBound = false;

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

  function clearPendingPointerUpHandler() {
    if (!pendingPointerUpHandler) {
      return;
    }

    window.removeEventListener('pointerup', pendingPointerUpHandler);
    pendingPointerUpHandler = null;
  }

  function handlePointerUp() {
    setDragState(false);
    clearPendingPointerUpHandler();
  }

  function handlePointerDown() {
    setDragState(true);
    pulseActiveIndicator();
    clearPendingPointerUpHandler();
    pendingPointerUpHandler = handlePointerUp;
    window.addEventListener('pointerup', pendingPointerUpHandler, { once: true });
  }

  function handlePointerCancel() {
    setDragState(false);
    clearPendingPointerUpHandler();
  }

  function handleBlur() {
    setDragState(false);
    clearPendingPointerUpHandler();
  }

  function handleInput(event) {
    const nextSwatchCount = Number(event.target.value);

    if (!Number.isFinite(nextSwatchCount) || nextSwatchCount < 1) {
      return;
    }

    onSwatchCountChange?.(nextSwatchCount);
    updateSliderTooltip(swatchSlider, nextSwatchCount);
    pulseActiveIndicator();
  }

  function bindEvents() {
    if (!swatchSlider || isBound) {
      return;
    }

    swatchSlider.addEventListener('pointerdown', handlePointerDown);
    swatchSlider.addEventListener('pointercancel', handlePointerCancel);
    swatchSlider.addEventListener('blur', handleBlur);
    swatchSlider.addEventListener('input', handleInput);
    isBound = true;
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

  function destroy() {
    if (swatchSlider && isBound) {
      swatchSlider.removeEventListener('pointerdown', handlePointerDown);
      swatchSlider.removeEventListener('pointercancel', handlePointerCancel);
      swatchSlider.removeEventListener('blur', handleBlur);
      swatchSlider.removeEventListener('input', handleInput);
      isBound = false;
    }

    clearPendingPointerUpHandler();
    cleanup();
  }

  return {
    bindEvents,
    cleanup,
    destroy,
    initialize,
  };
}
