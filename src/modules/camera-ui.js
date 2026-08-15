import { t } from "../i18n.js";
import { toRgbCss } from "./color-format.js";

export function drawFrameToCanvas({
  context,
  cameraFeed,
  width,
  height,
  facingMode,
  shouldMirrorUserFacing = true,
  sourceRect = null,
}) {
  if (!context || !cameraFeed || width <= 0 || height <= 0) {
    return;
  }

  context.save();

  const hasSourceRect = Boolean(sourceRect && sourceRect.width > 0 && sourceRect.height > 0);

  const drawFrame = (x, y, drawWidth, drawHeight) => {
    if (!hasSourceRect) {
      context.drawImage(cameraFeed, x, y, drawWidth, drawHeight);
      return;
    }

    context.drawImage(
      cameraFeed,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      x,
      y,
      drawWidth,
      drawHeight,
    );
  };

  if (facingMode === "user" && shouldMirrorUserFacing) {
    context.scale(-1, 1);
    drawFrame(-width, 0, width, height);
  } else {
    drawFrame(0, 0, width, height);
  }

  context.restore();
}

export function renderOutputSwatches(container, colors) {
  if (!container) {
    return;
  }

  const safeColors = Array.isArray(colors) ? colors : [];
  container.innerHTML = "";
  container.classList.toggle("is-empty", safeColors.length === 0);

  if (safeColors.length === 0) {
    const hint = document.createElement("p");
    hint.className = "output-empty-hint";
    hint.textContent = t("camera.output.empty");
    container.appendChild(hint);
    return;
  }

  safeColors.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.className = "output-swatch";
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

export function updateExposureText(exposureDisplay, exposureValue) {
  if (!exposureDisplay || !Number.isFinite(exposureValue)) {
    return;
  }

  const sign = exposureValue > 0 ? "+" : "";
  exposureDisplay.textContent = `${sign}${exposureValue.toFixed(1)} EV`;
}
