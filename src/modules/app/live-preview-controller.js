import { drawFrameToCanvas } from "../camera-ui.js";
import { createColorSmoother } from "../color-smoothing.js";
import {
  extractPaletteColors,
  getDominantColor,
  removeDarkestColor,
  renderPaletteBars,
} from "../palette-extraction.js";
import { getCenteredAspectCropRect, getTargetFrameHeight } from "./geometry.js";

// The quantizer samples at most ~40k pixels, so anything above ~320px wide is
// pure getImageData readback cost with no extraction-quality gain.
const ANALYSIS_MAX_WIDTH = 320;
const PREVIEW_SMOOTHING_FACTOR = 0.16;
// Extraction cadence is time-based so cost stays constant across 60/120Hz
// displays; the palette is intentionally slower than the camera preview.
const EXTRACTION_MIN_INTERVAL_MS = 200;
const CAMERA_TRACK_SETTINGS_REFRESH_MS = 1000;

export function createLivePreviewController({
  cameraFeed,
  frameCanvas,
  paletteCanvas,
  analysisCanvas = document.createElement("canvas"),
  analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true }) ??
    analysisCanvas.getContext("2d"),
  captureContainer,
  capturePaletteStage,
  paletteCaptureStage,
  cameraController,
  paletteExtractionWorker,
  performanceHud,
  ralPreview,
  visualEffects,
  getCurrentCaptureMode,
  getIsCaptureSavePending = () => false,
  getOneMoreColor,
  getPaletteScoringSettings,
  getMedianCutExtractionSettings,
  getHybridSettings,
  getPaletteSelector,
  getShouldMirrorUserFacingCamera,
  getSwatchCount,
  shouldUseCanvasPreview,
}) {
  const frameContext =
    frameCanvas?.getContext("2d", { willReadFrequently: true }) ?? frameCanvas?.getContext("2d");
  const paletteContext = paletteCanvas?.getContext("2d");
  const colorSmoother = createColorSmoother();

  let frameWidth = 0;
  let frameHeight = 0;
  let analysisWidth = 0;
  let analysisHeight = 0;
  let isStreaming = false;
  let lastExtractionAt = 0;
  let lastExtractedColors = null;
  let lastVisiblePaletteColors = [];
  let lastPaintedColors = null;
  let paintedPaletteWidth = 0;
  let paintedPaletteHeight = 0;
  let cachedPaletteWidth = 0;
  let cachedPaletteHeight = 0;
  let previewFrameRequestId = 0;
  let latestPaletteWorkerDurationMs = null;
  let cachedCameraTrackSettings = null;
  let cameraTrackSettingsRefreshedAt = 0;

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

  function updateAnalysisDimensions() {
    if (frameWidth <= 0 || frameHeight <= 0) {
      analysisWidth = 0;
      analysisHeight = 0;
      analysisCanvas.width = 0;
      analysisCanvas.height = 0;
      return false;
    }

    const scale = Math.min(1, ANALYSIS_MAX_WIDTH / frameWidth);
    const nextAnalysisWidth = Math.max(1, Math.round(frameWidth * scale));
    const nextAnalysisHeight = Math.max(1, Math.round(frameHeight * scale));

    analysisWidth = nextAnalysisWidth;
    analysisHeight = nextAnalysisHeight;

    if (
      analysisCanvas.width !== nextAnalysisWidth ||
      analysisCanvas.height !== nextAnalysisHeight
    ) {
      analysisCanvas.width = nextAnalysisWidth;
      analysisCanvas.height = nextAnalysisHeight;
    }

    return true;
  }

  function updateCachedDimensions() {
    const { width: nextPaletteWidth, height: nextPaletteHeight } = getPaletteViewportSize();
    if (nextPaletteWidth <= 0 || nextPaletteHeight <= 0) {
      cachedPaletteWidth = 0;
      cachedPaletteHeight = 0;
      frameWidth = 0;
      frameHeight = 0;
      analysisWidth = 0;
      analysisHeight = 0;
      analysisCanvas.width = 0;
      analysisCanvas.height = 0;
      return false;
    }

    cachedPaletteWidth = nextPaletteWidth;
    cachedPaletteHeight = nextPaletteHeight;
    frameWidth = nextPaletteWidth;
    frameHeight = getTargetFrameHeight(frameWidth);

    if (
      !cameraFeed ||
      !frameCanvas ||
      !paletteCanvas ||
      !analysisContext ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return false;
    }

    cameraFeed.setAttribute("width", String(frameWidth));
    cameraFeed.setAttribute("height", String(frameHeight));

    if (frameCanvas.width !== frameWidth || frameCanvas.height !== frameHeight) {
      frameCanvas.width = frameWidth;
      frameCanvas.height = frameHeight;
    }

    if (paletteCanvas.width !== frameWidth || paletteCanvas.height !== cachedPaletteHeight) {
      paletteCanvas.width = frameWidth;
      paletteCanvas.height = cachedPaletteHeight;
    }

    updateAnalysisDimensions();
    return true;
  }

  function getCameraFrameSourceRect() {
    return getCenteredAspectCropRect(cameraFeed?.videoWidth ?? 0, cameraFeed?.videoHeight ?? 0);
  }

  function getPaletteExtractionOptions() {
    return {
      medianCut: { ...getMedianCutExtractionSettings() },
      scoring: { ...getPaletteScoringSettings() },
      hybrid: {
        ...getHybridSettings(),
        // Previous raw extraction, used by the perceptual selector as a
        // stability bias so picks don't flip between near-equal candidates.
        previousColors: lastExtractedColors ?? [],
      },
      paletteSelector: getPaletteSelector?.() ?? "current",
    };
  }

  function cancelRefresh() {
    if (!previewFrameRequestId) {
      return;
    }

    window.cancelAnimationFrame(previewFrameRequestId);
    previewFrameRequestId = 0;
  }

  function scheduleRefresh() {
    if (!isStreaming || previewFrameRequestId) {
      return;
    }

    previewFrameRequestId = window.requestAnimationFrame((rafTimestamp) => {
      previewFrameRequestId = 0;
      refresh(rafTimestamp);
    });
  }

  function reset() {
    lastExtractionAt = 0;
    lastExtractedColors = null;
    lastVisiblePaletteColors = [];
    lastPaintedColors = null;
    paintedPaletteWidth = 0;
    paintedPaletteHeight = 0;
    latestPaletteWorkerDurationMs = null;
    cachedCameraTrackSettings = null;
    cameraTrackSettingsRefreshedAt = 0;
    ralPreview.clear();
    paletteExtractionWorker.invalidate();
    colorSmoother.reset();
    ralPreview.reset();
  }

  function getEffectiveSwatchCount() {
    return getSwatchCount() + (getOneMoreColor() ? 1 : 0);
  }

  function getCapturePaletteColors() {
    if (lastVisiblePaletteColors.length === getSwatchCount()) {
      return lastVisiblePaletteColors.map((color) => ({ ...color }));
    }

    return [];
  }

  function drawCurrentFrameToAnalysisCanvas() {
    if (!analysisContext || analysisWidth <= 0 || analysisHeight <= 0) {
      return false;
    }

    drawFrameToCanvas({
      context: analysisContext,
      cameraFeed,
      width: analysisWidth,
      height: analysisHeight,
      facingMode: cameraController.getFacingMode(),
      shouldMirrorUserFacing: getShouldMirrorUserFacingCamera(),
      sourceRect: getCameraFrameSourceRect(),
    });

    return true;
  }

  function copyVisibleFrameToAnalysisCanvas() {
    if (
      !analysisContext ||
      !frameCanvas ||
      analysisWidth <= 0 ||
      analysisHeight <= 0 ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return false;
    }

    analysisContext.drawImage(
      frameCanvas,
      0,
      0,
      frameWidth,
      frameHeight,
      0,
      0,
      analysisWidth,
      analysisHeight,
    );

    return true;
  }

  function readCurrentRalMatch(context = frameContext, width = frameWidth, height = frameHeight) {
    return ralPreview.readCurrentMatch(context, width, height);
  }

  function getCameraTrackSettings(now = performance.now()) {
    if (
      cachedCameraTrackSettings &&
      now - cameraTrackSettingsRefreshedAt < CAMERA_TRACK_SETTINGS_REFRESH_MS
    ) {
      return cachedCameraTrackSettings;
    }

    const stream = cameraFeed?.srcObject;
    cachedCameraTrackSettings =
      stream instanceof MediaStream ? (stream.getVideoTracks()[0]?.getSettings?.() ?? null) : null;
    cameraTrackSettingsRefreshedAt = now;
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
      !analysisContext ||
      (shouldUseCanvasPreview && !frameContext) ||
      !paletteContext
    ) {
      return;
    }

    if (
      cachedPaletteWidth <= 0 ||
      cachedPaletteHeight <= 0 ||
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
    const frameStartTime = performance.now();
    let analysisDurationMs = latestPaletteWorkerDurationMs;
    latestPaletteWorkerDurationMs = null;
    const currentCaptureMode = getCurrentCaptureMode();

    if (shouldUseCanvasPreview) {
      drawFrameToCanvas({
        context: frameContext,
        cameraFeed,
        width: frameWidth,
        height: frameHeight,
        facingMode: cameraController.getFacingMode(),
        shouldMirrorUserFacing: getShouldMirrorUserFacingCamera(),
        sourceRect: getCameraFrameSourceRect(),
      });
    }

    if (getIsCaptureSavePending()) {
      visualEffects.setCaptureGlowActive(false);
      // Force a repaint + glow refresh on the next palette frame.
      lastPaintedColors = null;
    } else if (currentCaptureMode === "ral") {
      const analysisStartTime = performance.now();
      if (!shouldUseCanvasPreview) {
        drawCurrentFrameToAnalysisCanvas();
      }

      readCurrentRalMatch(
        shouldUseCanvasPreview ? frameContext : analysisContext,
        shouldUseCanvasPreview ? frameWidth : analysisWidth,
        shouldUseCanvasPreview ? frameHeight : analysisHeight,
      );
      analysisDurationMs = performance.now() - analysisStartTime;
    } else {
      if (frameStartTime - lastExtractionAt >= EXTRACTION_MIN_INTERVAL_MS || !lastExtractedColors) {
        const analysisStartTime = performance.now();
        const analysisFrameReady = shouldUseCanvasPreview
          ? copyVisibleFrameToAnalysisCanvas()
          : drawCurrentFrameToAnalysisCanvas();

        if (analysisFrameReady) {
          lastExtractionAt = frameStartTime;
          const frameImageData = analysisContext.getImageData(
            0,
            0,
            analysisWidth,
            analysisHeight,
          ).data;
          const extractionDelegatedToWorker = paletteExtractionWorker.requestExtraction({
            imageData: frameImageData,
            width: analysisWidth,
            height: analysisHeight,
            swatchCount: getEffectiveSwatchCount(),
            options: getPaletteExtractionOptions(),
          });

          if (!extractionDelegatedToWorker) {
            const result = extractPaletteColors(
              frameImageData,
              analysisWidth,
              analysisHeight,
              getEffectiveSwatchCount(),
              getPaletteExtractionOptions(),
            );

            lastExtractedColors = result.colors;
            analysisDurationMs = performance.now() - analysisStartTime;
          }
        }
      }

      if (!lastExtractedColors || lastExtractedColors.length === 0) {
        scheduleRefresh();
        return;
      }

      const smoothedColors = colorSmoother.smooth(lastExtractedColors, PREVIEW_SMOOTHING_FACTOR);
      const displayColors = getOneMoreColor() ? removeDarkestColor(smoothedColors) : smoothedColors;

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
      refreshDurationMs: performance.now() - frameStartTime,
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
    getFrameHeight: () => frameHeight,
    getFrameWidth: () => frameWidth,
    getIsStreaming: () => isStreaming,
    handleWorkerResult({ colors, durationMs }) {
      latestPaletteWorkerDurationMs = durationMs;
      lastExtractedColors = colors;
    },
    readCurrentRalMatch,
    recordStoppedFrame,
    reset,
    scheduleRefresh,
    setStreaming(nextIsStreaming) {
      isStreaming = Boolean(nextIsStreaming);
    },
    updateCachedDimensions,
  };
}
