import { toRgbCss } from './palette-extraction.js';

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

export function drawFrameToCanvas({ context, cameraFeed, width, height, facingMode }) {
  if (!context || !cameraFeed || width <= 0 || height <= 0) {
    return;
  }

  context.save();

  if (facingMode === 'user') {
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

  container.innerHTML = '';

  colors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'output-swatch';
    swatch.style.backgroundColor = toRgbCss(color);
    swatch.title = toRgbCss(color);

    swatch.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(toRgbCss(color));
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

  zoomDisplay.textContent = zoomValue.toFixed(1);
}

export function updateSliderTooltip(sliderElement, swatchCount) {
  if (!sliderElement) {
    return;
  }

  sliderElement.setAttribute('aria-label', `Swatches: ${swatchCount}`);
}
