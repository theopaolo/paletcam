import { drawFrameToCanvas } from "../camera-ui.js";
import { findNearestColor, getContrastInkColor } from "../color-math.js";
import { relativeLuminance } from "../color-space-oklch.js";
import { createColorSmoother } from "../color-smoothing.js";
import {
  extractPaletteColors,
  getDominantColor,
  removeDarkestColor,
  renderPaletteBars,
} from "../palette-extraction.js";
import {
  computeColorPresence,
  createSwatchOriginTracker,
  drawOriginMarkers,
  hitTestOriginMarkers,
} from "../palette-origins.js";
import { createFrozenPinStore } from "./frozen-pins.js";
import { getCenteredAspectCropRect, getTargetFrameHeight } from "./geometry.js";
import { createLivePreviewExtractionPipeline } from "./live-preview-extraction-pipeline.js";
import { createLivePreviewFrameAcquisition } from "./live-preview-frame-acquisition.js";
import { createLivePreviewOriginMarkerModel } from "./live-preview-origin-marker-model.js";
import { createLivePreviewTiming, EXTRACTION_MIN_INTERVAL_MS } from "./live-preview-timing.js";

const PREVIEW_SMOOTHING_FACTOR = 0.16;
// Extraction cadence is time-based so cost stays constant across 60/120Hz
// displays; the palette is intentionally slower than the camera preview.
const HAPTIC_FREEZE_MS = 15;
const HAPTIC_UNFREEZE_MS = 8;
const HAPTIC_SCENE_RELEASE_PATTERN = [40, 60, 40];

function triggerHaptic(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are best-effort; iOS Safari has no vibration API.
  }
}

export function createLivePreviewController({
  cameraFeed,
  frameCanvas,
  paletteCanvas,
  paletteLockOverlay = null,
  analysisCanvas = document.createElement("canvas"),
  analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true }) ??
    analysisCanvas.getContext("2d"),
  captureContainer,
  capturePaletteStage,
  originsOverlayCanvas = null,
  paletteCaptureStage,
  cameraController,
  paletteExtractionWorker,
  performanceHud,
  ralPreview,
  visualEffects,
  getCurrentCaptureMode,
  getIsCaptureSavePending = () => false,
  getOneMoreColor,
  getOriginBadgesEnabled = () => true,
  getMedianCutExtractionSettings,
  getHybridSettings,
  getShouldMirrorUserFacingCamera,
  getSwatchCount,
  shouldUseCanvasPreview,
  frameAcquisition: injectedFrameAcquisition = null,
  getDevicePixelRatio = () => window.devicePixelRatio || 1,
  timingOptions = {},
}) {
  const frameAcquisition =
    injectedFrameAcquisition ??
    createLivePreviewFrameAcquisition({
      cameraFeed,
      frameCanvas,
      paletteCanvas,
      analysisCanvas,
      analysisContext,
      originsOverlayCanvas,
      drawFrame: drawFrameToCanvas,
      getCropRect: getCenteredAspectCropRect,
      getFrameHeight: getTargetFrameHeight,
      getDevicePixelRatio,
    });
  const frameContext = frameAcquisition.getFrameContext();
  const paletteContext = frameAcquisition.getPaletteContext();
  const originsOverlayContext = frameAcquisition.getOriginsOverlayContext();
  const activeAnalysisContext = frameAcquisition.getAnalysisContext();
  const colorSmoother = createColorSmoother();
  const timing = createLivePreviewTiming({ ...timingOptions, onFrame: refresh });
  const extractionPipeline = createLivePreviewExtractionPipeline({
    worker: paletteExtractionWorker,
    extractPalette: extractPaletteColors,
    originTracker: createSwatchOriginTracker(),
    computePresence: computeColorPresence,
  });
  const originMarkerModel = createLivePreviewOriginMarkerModel({
    findNearestColor,
    hitTestMarkers: hitTestOriginMarkers,
    now: () => timing.now(),
    random: Math.random,
  });

  let isStreaming = false;
  const frozenPins = createFrozenPinStore();
  let lastVisiblePaletteColors = [];
  let lastPaintedColors = null;
  let paintedPaletteWidth = 0;
  let paintedPaletteHeight = 0;
  let cachedCameraTrackSettings = null;

  function getPaletteViewportSize() {
    const currentCaptureMode = getCurrentCaptureMode();
    const paletteViewport =
      currentCaptureMode === "ral" || paletteCaptureStage?.hidden
        ? captureContainer
        : (capturePaletteStage ?? captureContainer);

    return {
      width: paletteViewport?.clientWidth ?? 0,
      height: paletteViewport?.clientHeight ?? 0,
    };
  }

  function updateCachedDimensions() {
    const { width: nextPaletteWidth, height: nextPaletteHeight } = getPaletteViewportSize();
    return frameAcquisition.resize({
      viewportWidth: nextPaletteWidth,
      viewportHeight: nextPaletteHeight,
    });
  }

  function getCameraFrameSourceRect() {
    return frameAcquisition.getCameraFrameSourceRect();
  }

  function cancelRefresh() {
    timing.cancel();
  }

  function scheduleRefresh() {
    timing.schedule(isStreaming);
  }

  function clearOriginMarkers() {
    originMarkerModel.reset();
    if (originsOverlayContext && originsOverlayCanvas) {
      const { frameHeight, frameWidth } = frameAcquisition.getDimensions();
      originsOverlayContext.clearRect(0, 0, frameWidth || 0, frameHeight || 0);
    }
  }

  // Presentation side of a pin release (the state side lives in the store):
  // spawn the falling badge, let the live badge pop back in fresh, and
  // repaint so unfrozen slots pick the live colors back up.
  function handleReleasedPins(released, { animate = false } = {}) {
    if (released.length === 0) {
      return;
    }

    originMarkerModel.handleReleased(released, { animate });

    lastPaintedColors = null;
    syncSwatchLockHints(lastVisiblePaletteColors);
  }

  function clearFrozenSlots({ animate = false } = {}) {
    const released = frozenPins.releaseAll();
    handleReleasedPins(released, { animate });
    if (animate && released.length > 0) {
      triggerHaptic(HAPTIC_SCENE_RELEASE_PATTERN);
    }
  }

  function processFrozenPresence(presenceEntries) {
    const released = frozenPins.processPresence(presenceEntries);
    handleReleasedPins(released, { animate: true });
    if (released.length > 0) {
      triggerHaptic(HAPTIC_SCENE_RELEASE_PATTERN);
    }
  }

  function checkFrozenSceneChange(rawColors) {
    const released = frozenPins.checkSceneChange(rawColors);
    handleReleasedPins(released, { animate: true });
    if (released.length > 0) {
      triggerHaptic(HAPTIC_SCENE_RELEASE_PATTERN);
    }
  }

  function applyExtractionResult({ colors, frozenPresence }) {
    checkFrozenSceneChange(colors);
    processFrozenPresence(frozenPresence);
  }

  function canToggleFreeze() {
    const { frameHeight, frameWidth } = frameAcquisition.getDimensions();
    return (
      getOriginBadgesEnabled() &&
      getCurrentCaptureMode() !== "ral" &&
      frameWidth > 0 &&
      frameHeight > 0
    );
  }

  // Padlock hint at the top center of each swatch bar: closed when the slot
  // is frozen, open otherwise, so users discover that swatches are tappable.
  function createSwatchLockHint() {
    const hint = document.createElement("div");
    hint.className = "palette-lock-hint";
    const number = document.createElement("span");
    number.className = "palette-lock-hint-number";
    const icon = document.createElement("img");
    icon.alt = "";
    hint.append(number, icon);
    return hint;
  }

  function syncSwatchLockHints(colors) {
    if (!paletteLockOverlay) {
      return;
    }

    if (!canToggleFreeze() || colors.length === 0) {
      paletteLockOverlay.replaceChildren();
      return;
    }

    while (paletteLockOverlay.children.length < colors.length) {
      paletteLockOverlay.appendChild(createSwatchLockHint());
    }
    while (paletteLockOverlay.children.length > colors.length) {
      paletteLockOverlay.lastElementChild.remove();
    }

    colors.forEach((color, slot) => {
      const hint = paletteLockOverlay.children[slot];
      const icon = hint.querySelector("img");
      const isLocked = frozenPins.has(slot);
      const iconSrc = isLocked ? "/icons/lock-close.svg" : "/icons/lock-open.svg";

      // Same numbering and disc style as the origin badges on the live
      // frame (colored disc, dark ring, luma-picked ink), so the
      // swatch-to-badge mapping is readable at a glance.
      const number = hint.querySelector(".palette-lock-hint-number");
      const label = String(slot + 1);
      if (number.textContent !== label) {
        number.textContent = label;
      }
      number.style.backgroundColor = `rgb(${color.r} ${color.g} ${color.b})`;
      number.style.color = getContrastInkColor(color);

      if (icon.getAttribute("src") !== iconSrc) {
        icon.setAttribute("src", iconSrc);
      }
      hint.classList.toggle("is-locked", isLocked);
      hint.classList.toggle("is-light-ink", relativeLuminance(color.r, color.g, color.b) <= 0.179);
    });
  }

  function toggleSlotFreeze(slot) {
    if (frozenPins.has(slot)) {
      handleReleasedPins(frozenPins.release(slot));
      triggerHaptic(HAPTIC_UNFREEZE_MS);
      return true;
    }

    const displayColor = lastVisiblePaletteColors[slot];
    if (!displayColor) {
      return false;
    }

    // Swatch-initiated freezes can land on a slot whose badge is currently
    // hidden (no matching pixels); the color still pins, badge-less.
    frozenPins.freeze(
      slot,
      displayColor,
      originMarkerModel.getPosition(slot),
      extractionPipeline.getSnapshot().colors,
    );
    lastPaintedColors = null;
    syncSwatchLockHints(lastVisiblePaletteColors);
    triggerHaptic(HAPTIC_FREEZE_MS);
    return true;
  }

  function toggleOriginFreezeAt(normalizedX, normalizedY) {
    if (!canToggleFreeze()) {
      return false;
    }

    const { frameHeight, frameWidth } = frameAcquisition.getDimensions();
    const slot = originMarkerModel.hitTestAt({
      normalizedX,
      normalizedY,
      frameWidth,
      frameHeight,
    });
    if (slot < 0) {
      return false;
    }

    return toggleSlotFreeze(slot);
  }

  function togglePaletteSwatchFreezeAt(normalizedX) {
    if (!canToggleFreeze() || lastVisiblePaletteColors.length === 0) {
      return false;
    }

    const swatchCount = lastVisiblePaletteColors.length;
    const slot = Math.min(swatchCount - 1, Math.max(0, Math.floor(normalizedX * swatchCount)));
    return toggleSlotFreeze(slot);
  }

  function updateOriginMarkers(displayColors) {
    const { frameHeight, frameWidth } = frameAcquisition.getDimensions();
    if (!originsOverlayContext || frameWidth <= 0 || frameHeight <= 0) {
      return;
    }

    if (!getOriginBadgesEnabled()) {
      if (originMarkerModel.hasActivity()) {
        clearOriginMarkers();
      }
      if (frozenPins.size() > 0) {
        clearFrozenSlots();
      }
      return;
    }

    const { colors: extractedColors, origins: extractedOrigins } = extractionPipeline.getSnapshot();
    const markers = originMarkerModel.build({
      displayColors,
      rawColors: extractedColors ?? [],
      origins: extractedOrigins,
      frozenBySlot: displayColors.map((_, slot) => frozenPins.get(slot)),
      frameWidth,
      frameHeight,
    });
    drawOriginMarkers(originsOverlayContext, markers, frameWidth, frameHeight);
  }

  function reset() {
    extractionPipeline.reset();
    clearOriginMarkers();
    frozenPins.reset();
    lastVisiblePaletteColors = [];
    lastPaintedColors = null;
    paintedPaletteWidth = 0;
    paintedPaletteHeight = 0;
    paletteLockOverlay?.replaceChildren();
    cachedCameraTrackSettings = null;
    timing.resetCadence();
    ralPreview.clear();
    colorSmoother.reset();
    ralPreview.reset();
  }

  function getEffectiveSwatchCount() {
    return getSwatchCount() + (getOneMoreColor() ? 1 : 0);
  }

  // Smoothed display colors lose the quantizer's `population`; recover each
  // color's density from its nearest raw extracted color so saved palettes
  // keep the data behind the verso's density stripes.
  function findNearestExtractedPopulation(color) {
    const nearest = findNearestColor(color, extractionPipeline.getSnapshot().colors ?? []);
    return Number.isFinite(nearest?.color?.population) ? nearest.color.population : 0;
  }

  function getCapturePaletteColors() {
    if (lastVisiblePaletteColors.length === getSwatchCount()) {
      return lastVisiblePaletteColors.map((color) => ({
        ...color,
        population: findNearestExtractedPopulation(color),
      }));
    }

    return [];
  }

  function drawCurrentFrameToAnalysisCanvas() {
    return frameAcquisition.drawCurrentFrameToAnalysisCanvas({
      facingMode: cameraController.getFacingMode(),
      shouldMirrorUserFacing: getShouldMirrorUserFacingCamera(),
    });
  }

  function copyVisibleFrameToAnalysisCanvas() {
    return frameAcquisition.copyVisibleFrameToAnalysisCanvas();
  }

  function readCurrentRalMatch(
    context = frameContext,
    width = frameAcquisition.getDimensions().frameWidth,
    height = frameAcquisition.getDimensions().frameHeight,
  ) {
    return ralPreview.readCurrentMatch(context, width, height);
  }

  function getCameraTrackSettings(now = timing.now()) {
    if (!timing.shouldRefreshCameraSettings(now, Boolean(cachedCameraTrackSettings))) {
      return cachedCameraTrackSettings;
    }

    const stream = cameraFeed?.srcObject;
    cachedCameraTrackSettings =
      stream instanceof MediaStream ? (stream.getVideoTracks()[0]?.getSettings?.() ?? null) : null;
    timing.markCameraSettingsRefreshed(now);
    return cachedCameraTrackSettings;
  }

  function recordStoppedFrame() {
    performanceHud.recordFrame({
      captureMode: getCurrentCaptureMode(),
      streaming: false,
    });
  }

  function refresh(rafTimestamp = 0) {
    if (
      !isStreaming ||
      !activeAnalysisContext ||
      (shouldUseCanvasPreview && !frameContext) ||
      !paletteContext
    ) {
      return;
    }

    const { analysisHeight, analysisWidth, frameHeight, frameWidth, paletteHeight, paletteWidth } =
      frameAcquisition.getDimensions();
    if (
      paletteWidth <= 0 ||
      paletteHeight <= 0 ||
      frameWidth <= 0 ||
      frameHeight <= 0 ||
      analysisWidth <= 0 ||
      analysisHeight <= 0 ||
      cameraFeed.videoWidth <= 0 ||
      cameraFeed.videoHeight <= 0
    ) {
      scheduleRefresh();
      return;
    }
    const frameStartTime = timing.now();
    let analysisDurationMs = extractionPipeline.takeLatestWorkerDurationMs();
    const currentCaptureMode = getCurrentCaptureMode();

    if (shouldUseCanvasPreview) {
      frameAcquisition.drawPreview({
        facingMode: cameraController.getFacingMode(),
        shouldMirrorUserFacing: getShouldMirrorUserFacingCamera(),
      });
    }

    if (getIsCaptureSavePending()) {
      visualEffects.setCaptureGlowActive(false);
      // Force a repaint + glow refresh on the next palette frame.
      lastPaintedColors = null;
    } else if (currentCaptureMode === "ral") {
      if (originMarkerModel.hasActivity()) {
        clearOriginMarkers();
      }
      const analysisStartTime = timing.now();
      if (!shouldUseCanvasPreview) {
        drawCurrentFrameToAnalysisCanvas();
      }

      readCurrentRalMatch(
        shouldUseCanvasPreview ? frameContext : activeAnalysisContext,
        shouldUseCanvasPreview ? frameWidth : analysisWidth,
        shouldUseCanvasPreview ? frameHeight : analysisHeight,
      );
      analysisDurationMs = timing.now() - analysisStartTime;
    } else {
      if (timing.shouldExtract(frameStartTime, Boolean(extractionPipeline.getSnapshot().colors))) {
        const analysisStartTime = timing.now();
        const analysisFrameReady = shouldUseCanvasPreview
          ? copyVisibleFrameToAnalysisCanvas()
          : drawCurrentFrameToAnalysisCanvas();

        if (analysisFrameReady) {
          timing.markExtracted(frameStartTime);
          const frameImageData = frameAcquisition.readAnalysisPixels();
          if (!frameImageData) {
            scheduleRefresh();
            return;
          }
          const extraction = extractionPipeline.request({
            imageData: frameImageData,
            width: analysisWidth,
            height: analysisHeight,
            swatchCount: getEffectiveSwatchCount(),
            medianCutSettings: getMedianCutExtractionSettings(),
            hybridSettings: getHybridSettings(),
            frozenEntries: frozenPins.getEntries(),
          });

          if (!extraction.delegated) {
            applyExtractionResult(extraction.result);
            analysisDurationMs = timing.now() - analysisStartTime;
          }
        }
      }

      const extractedColors = extractionPipeline.getSnapshot().colors;
      if (!extractedColors || extractedColors.length === 0) {
        scheduleRefresh();
        return;
      }

      const smoothedColors = colorSmoother.smooth(extractedColors, PREVIEW_SMOOTHING_FACTOR);
      const liveColors = getOneMoreColor() ? removeDarkestColor(smoothedColors) : smoothedColors;
      const displayColors = frozenPins.applyToColors(liveColors);

      updateOriginMarkers(displayColors);

      // The smoother returns the same color objects while the palette is
      // stable (deadband), so identical refs mean nothing on screen changes.
      const paletteUnchanged =
        lastPaintedColors !== null &&
        paintedPaletteWidth === paletteCanvas.width &&
        paintedPaletteHeight === paletteCanvas.height &&
        lastPaintedColors.length === displayColors.length &&
        displayColors.every((color, index) => color === lastPaintedColors[index]);

      if (!paletteUnchanged) {
        lastVisiblePaletteColors = displayColors.map((color) => ({ ...color }));
        const dominantColor = getDominantColor(displayColors);

        renderPaletteBars(paletteContext, displayColors, paletteCanvas.width, paletteCanvas.height);
        syncSwatchLockHints(displayColors);
        lastPaintedColors = displayColors;
        paintedPaletteWidth = paletteCanvas.width;
        paintedPaletteHeight = paletteCanvas.height;

        if (dominantColor) {
          visualEffects.setCaptureButtonGlowColor(dominantColor);
          visualEffects.setCaptureGlowActive(true);
        } else {
          visualEffects.setCaptureGlowActive(false);
        }
      }
    }

    const cameraTrackSettings = getCameraTrackSettings(frameStartTime);
    performanceHud.recordFrame({
      analysisDurationMs,
      analysisHeight:
        currentCaptureMode === "ral" && shouldUseCanvasPreview ? frameHeight : analysisHeight,
      analysisWidth:
        currentCaptureMode === "ral" && shouldUseCanvasPreview ? frameWidth : analysisWidth,
      cameraFps: Number(cameraTrackSettings?.frameRate) || null,
      captureMode: currentCaptureMode,
      extractionIntervalMs: currentCaptureMode === "ral" ? null : EXTRACTION_MIN_INTERVAL_MS,
      rafTimestamp,
      refreshDurationMs: timing.now() - frameStartTime,
      sourceHeight: cameraFeed.videoHeight,
      sourceWidth: cameraFeed.videoWidth,
      streaming: isStreaming,
    });
    scheduleRefresh();
  }

  return {
    cancelRefresh,
    copyVisibleFrameToAnalysisCanvas,
    drawCurrentFrameToAnalysisCanvas,
    getCameraFrameSourceRect,
    getCapturePaletteColors,
    getEffectiveSwatchCount,
    getFrameContext: () => frameContext,
    getFrameHeight: () => frameAcquisition.getDimensions().frameHeight,
    getFrameWidth: () => frameAcquisition.getDimensions().frameWidth,
    getIsStreaming: () => isStreaming,
    handleWorkerResult(result) {
      applyExtractionResult(extractionPipeline.acceptWorkerResult(result));
    },
    readCurrentRalMatch,
    recordStoppedFrame,
    reset,
    scheduleRefresh,
    setStreaming(nextIsStreaming) {
      isStreaming = Boolean(nextIsStreaming);
    },
    toggleOriginFreezeAt,
    togglePaletteSwatchFreezeAt,
    updateCachedDimensions,
  };
}
