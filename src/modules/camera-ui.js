import { toRgbCss } from './palette-extraction.js';

const EMPTY_OUTPUT_HINT_TEXT = 'Votre premiere capture apparaitra ici.';
const OUTPUT_COPY_MODE_STORAGE_KEY = 'paletcam.outputCopyMode';
const OUTPUT_COPY_MODES = ['rgb', 'hex', 'hsl'];
const OUTPUT_COPY_MODE_LABELS = {
  rgb: 'RGB',
  hex: 'HEX',
  hsl: 'HSL',
};
let outputCopyMode = readStoredCopyMode();

function readStoredCopyMode() {
  try {
    const storedMode = window.localStorage.getItem(OUTPUT_COPY_MODE_STORAGE_KEY);
    if (OUTPUT_COPY_MODES.includes(storedMode)) {
      return storedMode;
    }
  } catch (_error) {
    return 'rgb';
  }

  return 'rgb';
}

function persistCopyMode(nextMode) {
  try {
    window.localStorage.setItem(OUTPUT_COPY_MODE_STORAGE_KEY, nextMode);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function formatHexColor(color) {
  const r = color.r.toString(16).padStart(2, '0').toUpperCase();
  const g = color.g.toString(16).padStart(2, '0').toUpperCase();
  const b = color.b.toString(16).padStart(2, '0').toUpperCase();
  return `#${r}${g}${b}`;
}

function formatHslColor(color) {
  const normalizedR = color.r / 255;
  const normalizedG = color.g / 255;
  const normalizedB = color.b / 255;
  const maxChannel = Math.max(normalizedR, normalizedG, normalizedB);
  const minChannel = Math.min(normalizedR, normalizedG, normalizedB);
  const delta = maxChannel - minChannel;
  const lightness = (maxChannel + minChannel) / 2;
  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs((2 * lightness) - 1));

  let hue = 0;
  if (delta !== 0) {
    if (maxChannel === normalizedR) {
      hue = ((normalizedG - normalizedB) / delta) % 6;
    } else if (maxChannel === normalizedG) {
      hue = ((normalizedB - normalizedR) / delta) + 2;
    } else {
      hue = ((normalizedR - normalizedG) / delta) + 4;
    }
  }

  const roundedHue = Math.round(hue * 60 < 0 ? (hue * 60) + 360 : hue * 60);
  const roundedSaturation = Math.round(saturation * 100);
  const roundedLightness = Math.round(lightness * 100);

  return `hsl(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%)`;
}

function getCopyTextForColor(color) {
  if (outputCopyMode === 'hex') {
    return formatHexColor(color);
  }

  if (outputCopyMode === 'hsl') {
    return formatHslColor(color);
  }

  return toRgbCss(color);
}

function getCopyModeToggleLabel() {
  const modeLabel = OUTPUT_COPY_MODE_LABELS[outputCopyMode] ?? OUTPUT_COPY_MODE_LABELS.rgb;
  return `Copier ${modeLabel}`;
}

function cycleCopyMode() {
  const currentModeIndex = OUTPUT_COPY_MODES.indexOf(outputCopyMode);
  const nextModeIndex = (currentModeIndex + 1) % OUTPUT_COPY_MODES.length;
  outputCopyMode = OUTPUT_COPY_MODES[nextModeIndex];
  persistCopyMode(outputCopyMode);
}

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

  const copyModeToggle = document.createElement('button');
  copyModeToggle.type = 'button';
  copyModeToggle.className = 'output-copy-mode-toggle';
  copyModeToggle.textContent = getCopyModeToggleLabel();
  copyModeToggle.setAttribute(
    'aria-label',
    `${getCopyModeToggleLabel()}. Touchez pour changer le format de copie.`
  );
  copyModeToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    cycleCopyMode();
    renderOutputSwatches(container, safeColors);
  });
  container.appendChild(copyModeToggle);

  safeColors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'output-swatch';
    swatch.style.backgroundColor = toRgbCss(color);
    swatch.title = getCopyTextForColor(color);

    swatch.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getCopyTextForColor(color));
      } catch (error) {
        console.error('Failed to copy color to clipboard:', error);
      }
    });

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
  sliderElement.setAttribute('aria-label', `Echantillons: ${formatScaleValue(clampedCount)}`);
  const tickCount = Math.max(1, Math.floor(((maxValue - minValue) / step) + Number.EPSILON) + 1);
  const tickIndex = Math.max(0, Math.floor(((clampedCount - minValue) / step) + Number.EPSILON));
  const tickIntervals = Math.max(1, tickCount - 1);

  sliderWrapper.style.setProperty('--tick-count', String(tickCount));
  sliderWrapper.style.setProperty('--tick-index', String(tickIndex));
  sliderWrapper.style.setProperty('--tick-intervals', String(tickIntervals));

  const countIndicator = sliderWrapper.querySelector('.swatch-count-indicator');
  if (countIndicator) {
    countIndicator.textContent = `${formatScaleValue(clampedCount)} colors`;
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
