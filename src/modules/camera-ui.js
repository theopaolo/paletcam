import { toRgbCss } from './color-format.js';

const EMPTY_OUTPUT_HINT_TEXT = 'Votre premiere capture apparaitra ici.';

function setClassVisibility(element, shouldShow) {
  if (!element) {
    return;
  }

  element.classList.toggle('hidden', !shouldShow);
}

export function setCaptureState({ btnOn, btnShoot, isCameraActive }) {
  setClassVisibility(btnOn, !isCameraActive);
  setClassVisibility(btnShoot, isCameraActive);
}

export function drawFrameToCanvas({
  context,
  cameraFeed,
  width,
  height,
  facingMode,
  shouldMirrorUserFacing = true,
}) {
  if (!context || !cameraFeed || width <= 0 || height <= 0) {
    return;
  }

  context.save();

  if (facingMode === 'user' && shouldMirrorUserFacing) {
    context.scale(-1, 1);
    context.drawImage(cameraFeed, -width, 0, width, height);
  } else {
    context.drawImage(cameraFeed, 0, 0, width, height);
  }

  context.restore();
}

export function renderOutputSwatches(container, colors) {
  if (!container) {
    return;
  }

  const safeColors = Array.isArray(colors) ? colors : [];
  container.innerHTML = '';
  container.classList.toggle('is-empty', safeColors.length === 0);

  if (safeColors.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'output-empty-hint';
    hint.textContent = EMPTY_OUTPUT_HINT_TEXT;
    container.appendChild(hint);
    return;
  }

  safeColors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'output-swatch';
    swatch.style.backgroundColor = toRgbCss(color);
    swatch.title = toRgbCss(color);

    container.appendChild(swatch);
  });
}

export function updateZoomText(zoomDisplay, zoomValue) {
  if (!zoomDisplay) {
    return;
  }

  zoomDisplay.textContent = `${zoomValue.toFixed(1)}x zoom`;
}

function formatScaleValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function updateSliderTooltip(sliderElement, swatchCount) {
  if (!sliderElement) {
    return;
  }

  const sliderWrapper = sliderElement.closest('.swatch-slider');
  if (!sliderWrapper) {
    return;
  }

  const minValue = Number(sliderElement.min) || 1;
  const maxValue = Number(sliderElement.max) || minValue;
  const stepValue = Number(sliderElement.step);
  const step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 1;
  const clampedCount = Math.min(Math.max(swatchCount, minValue), maxValue);
  sliderElement.setAttribute('aria-label', `Nombre de couleurs : ${formatScaleValue(clampedCount)}`);
  const tickCount = Math.max(1, Math.floor(((maxValue - minValue) / step) + Number.EPSILON) + 1);
  const tickIndex = Math.max(0, Math.floor(((clampedCount - minValue) / step) + Number.EPSILON));
  const tickIntervals = Math.max(1, tickCount - 1);

  sliderWrapper.style.setProperty('--tick-count', String(tickCount));
  sliderWrapper.style.setProperty('--tick-index', String(tickIndex));
  sliderWrapper.style.setProperty('--tick-intervals', String(tickIntervals));

  const countIndicator = sliderWrapper.querySelector('.swatch-count-indicator');
  if (countIndicator) {
    countIndicator.textContent = `${formatScaleValue(clampedCount)} couleurs`;
  }

  const minIndicator = sliderWrapper.querySelector('.swatch-scale-label-min');
  if (minIndicator) {
    minIndicator.textContent = formatScaleValue(minValue);
  }

  const maxIndicator = sliderWrapper.querySelector('.swatch-scale-label-max');
  if (maxIndicator) {
    maxIndicator.textContent = formatScaleValue(maxValue);
  }
}
