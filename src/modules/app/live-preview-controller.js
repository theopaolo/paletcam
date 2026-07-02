import { drawFrameToCanvas } from "../camera-ui.js";
import { rgbDistanceSquared } from "../color-math.js";
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
import { getCenteredAspectCropRect, getTargetFrameHeight } from "./geometry.js";

// The quantizer samples at most ~40k pixels, so anything above ~320px wide is
// pure getImageData readback cost with no extraction-quality gain.
const ANALYSIS_MAX_WIDTH = 320;
const PREVIEW_SMOOTHING_FACTOR = 0.16;
// Extraction cadence is time-based so cost stays constant across 60/120Hz
// displays; the palette is intentionally slower than the camera preview.
const EXTRACTION_MIN_INTERVAL_MS = 200;
const CAMERA_TRACK_SETTINGS_REFRESH_MS = 1000;
const ORIGIN_MARKER_SMOOTHING_FACTOR = 0.1;
// A frozen palette belongs to the scene it was pinned in. Each fresh
// extraction is compared to the freeze-time snapshot (mean nearest-color
// distance). Two release tiers: an unmistakable scene swap (hard) releases on
// the first extraction (≤200ms), while moderate drift (soft) — reframing,
// slow pans, autoexposure — must persist for several extractions before the
// pins let go. Static-scene noise measures ≈ 8, a full scene change ≈ 100.
const FROZEN_SCENE_HARD_DISTANCE = 85;
const FROZEN_SCENE_SOFT_DISTANCE = 58;
const FROZEN_SCENE_SOFT_BREACH_LIMIT = 3;
// Per-pin presence: a frozen color whose matching pixels vanish from the
// frame (covered, moved away from) releases individually. The release
// threshold adapts per pin — a fraction of the best presence that pin ever
// measured — so a small vivid object (which only ever matches a sliver of
// pixels) is judged against its own normal, clamped to sane bounds.
const FROZEN_PRESENCE_BASELINE_RATIO = 0.25;
const FROZEN_PRESENCE_MAX_THRESHOLD = 0.004;
const FROZEN_PRESENCE_MIN_THRESHOLD = 0.0005;
const FROZEN_PRESENCE_BREACH_LIMIT = 2;
// Release animation: badges hop up, tumble off the bottom of the frame, and
// the live badge pops back in with a bounce.
const BADGE_FALL_HOP_VELOCITY = -140; // px/s
const BADGE_FALL_GRAVITY = 1400; // px/s^2
const BADGE_FALL_MAX_DURATION_MS = 1400;
const BADGE_POP_DURATION_MS = 350;
const HAPTIC_FREEZE_MS = 15;
const HAPTIC_UNFREEZE_MS = 8;
const HAPTIC_SCENE_RELEASE_PATTERN = [40, 60, 40];

function easeOutBack(progress) {
  const overshoot = 1.70158;
  const p = progress - 1;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}

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
  const originsOverlayContext = originsOverlayCanvas?.getContext("2d") ?? null;
  const colorSmoother = createColorSmoother();
  // Only used by the sync fallback path; the worker keeps its own tracker.
  const originTracker = createSwatchOriginTracker();

  let frameWidth = 0;
  let frameHeight = 0;
  let analysisWidth = 0;
  let analysisHeight = 0;
  let isStreaming = false;
  let lastExtractionAt = 0;
  let lastExtractedColors = null;
  let lastExtractedOrigins = [];
  let smoothedMarkerPositions = [];
  let lastRenderedMarkers = [];
  let markerBornAt = [];
  let fallingBadges = [];
  const frozenSlots = new Map();
  const frozenPresenceBreaches = new Map();
  let frozenSceneReference = null;
  let frozenSceneBreachCount = 0;
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

    if (originsOverlayCanvas) {
      const dpr = window.devicePixelRatio || 1;
      const overlayWidth = Math.round(frameWidth * dpr);
      const overlayHeight = Math.round(frameHeight * dpr);
      if (
        originsOverlayCanvas.width !== overlayWidth ||
        originsOverlayCanvas.height !== overlayHeight
      ) {
        originsOverlayCanvas.width = overlayWidth;
        originsOverlayCanvas.height = overlayHeight;
      }
      originsOverlayContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  function clearOriginMarkers() {
    smoothedMarkerPositions = [];
    lastRenderedMarkers = [];
    markerBornAt = [];
    fallingBadges = [];
    if (originsOverlayContext && originsOverlayCanvas) {
      originsOverlayContext.clearRect(0, 0, frameWidth || 0, frameHeight || 0);
    }
  }

  function releaseFrozenSlot(slot, { animate = false } = {}) {
    const entry = frozenSlots.get(slot);
    if (!entry) {
      return;
    }

    if (animate && entry.position) {
      fallingBadges.push({
        x: entry.position.x,
        y: entry.position.y,
        color: entry.color,
        label: slot + 1,
        horizontalVelocity: (Math.random() - 0.5) * 160,
        startedAt: performance.now(),
      });
    }

    frozenSlots.delete(slot);
    frozenPresenceBreaches.delete(slot);
    // Let the live badge for this slot pop back in fresh.
    smoothedMarkerPositions[slot] = null;
    markerBornAt[slot] = 0;
    if (frozenSlots.size === 0) {
      frozenSceneReference = null;
      frozenSceneBreachCount = 0;
    }
    // Force repaint so unfrozen slots pick the live colors back up.
    lastPaintedColors = null;
  }

  function clearFrozenSlots({ animate = false } = {}) {
    const hadFrozenSlots = frozenSlots.size > 0;
    for (const slot of Array.from(frozenSlots.keys())) {
      releaseFrozenSlot(slot, { animate });
    }
    if (animate && hadFrozenSlots) {
      triggerHaptic(HAPTIC_SCENE_RELEASE_PATTERN);
    }
  }

  function getFrozenColorEntries() {
    return Array.from(frozenSlots, ([slot, entry]) => ({ slot, color: { ...entry.color } }));
  }

  // Per-pin presence watchdog: release a pinned color once its matching
  // pixels have been absent from the frame for consecutive extractions.
  function processFrozenPresence(presenceEntries) {
    if (!Array.isArray(presenceEntries) || presenceEntries.length === 0) {
      return;
    }

    let releasedAny = false;
    for (const { slot, presence } of presenceEntries) {
      if (!frozenSlots.has(slot)) {
        frozenPresenceBreaches.delete(slot);
        continue;
      }

      const state = frozenPresenceBreaches.get(slot) ?? { maxPresence: 0, breachCount: 0 };
      state.maxPresence = Math.max(state.maxPresence, presence);

      const releaseThreshold = Math.min(
        FROZEN_PRESENCE_MAX_THRESHOLD,
        Math.max(FROZEN_PRESENCE_MIN_THRESHOLD, state.maxPresence * FROZEN_PRESENCE_BASELINE_RATIO),
      );

      if (presence < releaseThreshold) {
        state.breachCount += 1;
        if (state.breachCount >= FROZEN_PRESENCE_BREACH_LIMIT) {
          releaseFrozenSlot(slot, { animate: true });
          releasedAny = true;
          continue;
        }
      } else {
        state.breachCount = 0;
      }
      frozenPresenceBreaches.set(slot, state);
    }

    if (releasedAny) {
      triggerHaptic(HAPTIC_SCENE_RELEASE_PATTERN);
    }
  }

  // Released badges hop up, tumble down past the frame edge, and fade.
  function buildFallingBadgeMarkers(now) {
    if (fallingBadges.length === 0) {
      return [];
    }

    const markers = [];
    fallingBadges = fallingBadges.filter((badge) => {
      const elapsedSeconds = (now - badge.startedAt) / 1000;
      if (now - badge.startedAt > BADGE_FALL_MAX_DURATION_MS) {
        return false;
      }

      const dropPx =
        BADGE_FALL_HOP_VELOCITY * elapsedSeconds +
        0.5 * BADGE_FALL_GRAVITY * elapsedSeconds * elapsedSeconds;
      const y = badge.y + dropPx / frameHeight;
      if (y * frameHeight > frameHeight + 24) {
        return false;
      }

      markers.push({
        x: badge.x + (badge.horizontalVelocity * elapsedSeconds) / frameWidth,
        y,
        color: badge.color,
        label: badge.label,
        frozen: true,
        clamp: false,
        rotation: badge.horizontalVelocity * elapsedSeconds * 0.02,
        alpha: 1 - (now - badge.startedAt) / BADGE_FALL_MAX_DURATION_MS,
      });
      return true;
    });

    return markers;
  }

  function applyFrozenColors(colors) {
    if (frozenSlots.size === 0) {
      return colors;
    }

    return colors.map((color, slot) => frozenSlots.get(slot)?.color ?? color);
  }

  // Scene-change watchdog: compares each fresh extraction against the palette
  // snapshot taken when freezing. Sustained mismatch releases all frozen slots.
  function checkFrozenSceneChange(rawColors) {
    if (frozenSlots.size === 0 || !frozenSceneReference || frozenSceneReference.length === 0) {
      return;
    }

    if (!Array.isArray(rawColors) || rawColors.length === 0) {
      return;
    }

    let totalDistance = 0;
    for (const color of rawColors) {
      let bestDistanceSquared = Infinity;
      for (const reference of frozenSceneReference) {
        const distanceSquared = rgbDistanceSquared(color, reference);
        if (distanceSquared < bestDistanceSquared) {
          bestDistanceSquared = distanceSquared;
        }
      }
      totalDistance += Math.sqrt(bestDistanceSquared);
    }

    const meanDistance = totalDistance / rawColors.length;
    if (meanDistance > FROZEN_SCENE_HARD_DISTANCE) {
      clearFrozenSlots({ animate: true });
    } else if (meanDistance > FROZEN_SCENE_SOFT_DISTANCE) {
      frozenSceneBreachCount += 1;
      if (frozenSceneBreachCount >= FROZEN_SCENE_SOFT_BREACH_LIMIT) {
        clearFrozenSlots({ animate: true });
      }
    } else {
      frozenSceneBreachCount = 0;
    }
  }

  function canToggleFreeze() {
    return (
      getOriginBadgesEnabled() &&
      getCurrentCaptureMode() !== "ral" &&
      frameWidth > 0 &&
      frameHeight > 0
    );
  }

  function toggleSlotFreeze(slot) {
    if (frozenSlots.has(slot)) {
      releaseFrozenSlot(slot);
      triggerHaptic(HAPTIC_UNFREEZE_MS);
      return true;
    }

    const displayColor = lastVisiblePaletteColors[slot];
    if (!displayColor) {
      return false;
    }

    // Swatch-initiated freezes can land on a slot whose badge is currently
    // hidden (no matching pixels); the color still pins, badge-less.
    const position = smoothedMarkerPositions[slot];
    frozenSlots.set(slot, {
      color: { ...displayColor },
      position: position ? { ...position } : null,
    });
    frozenSceneReference = (lastExtractedColors ?? []).map((color) => ({ ...color }));
    frozenSceneBreachCount = 0;
    lastPaintedColors = null;
    triggerHaptic(HAPTIC_FREEZE_MS);
    return true;
  }

  function toggleOriginFreezeAt(normalizedX, normalizedY) {
    if (!canToggleFreeze() || lastRenderedMarkers.length === 0) {
      return false;
    }

    const slot = hitTestOriginMarkers(
      lastRenderedMarkers,
      normalizedX * frameWidth,
      normalizedY * frameHeight,
      frameWidth,
      frameHeight,
    );
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
    const slot = Math.min(
      swatchCount - 1,
      Math.max(0, Math.floor(normalizedX * swatchCount)),
    );
    return toggleSlotFreeze(slot);
  }

  // Each visible swatch is matched back to the raw extraction color whose
  // scene centroid we know, then the badge glides toward that spot so sensor
  // jitter doesn't make markers twitch.
  function updateOriginMarkers(displayColors) {
    if (!originsOverlayContext || frameWidth <= 0 || frameHeight <= 0) {
      return;
    }

    if (!getOriginBadgesEnabled()) {
      if (lastRenderedMarkers.length > 0 || fallingBadges.length > 0) {
        clearOriginMarkers();
      }
      if (frozenSlots.size > 0) {
        clearFrozenSlots();
      }
      return;
    }

    const now = performance.now();
    const rawColors = lastExtractedColors ?? [];
    const markers = [];

    for (let slot = 0; slot < displayColors.length; slot += 1) {
      const displayColor = displayColors[slot];

      // Frozen badges stay where the color was pinned; the live scan no
      // longer applies to them. A badge-less pin (frozen from the swatch bar
      // while its color had no visible origin) keeps the slot marker-free.
      const frozenEntry = frozenSlots.get(slot);
      if (frozenEntry) {
        smoothedMarkerPositions[slot] = frozenEntry.position ? { ...frozenEntry.position } : null;
        if (frozenEntry.position) {
          markers.push({
            x: frozenEntry.position.x,
            y: frozenEntry.position.y,
            color: frozenEntry.color,
            label: slot + 1,
            slot,
            frozen: true,
          });
        }
        continue;
      }

      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < rawColors.length; i += 1) {
        const distance = rgbDistanceSquared(displayColor, rawColors[i]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      const targetOrigin = bestIndex >= 0 ? lastExtractedOrigins[bestIndex] : null;
      if (!targetOrigin) {
        smoothedMarkerPositions[slot] = null;
        continue;
      }

      const previousPosition = smoothedMarkerPositions[slot];
      if (!previousPosition) {
        // Fresh appearance (first frame, or just released) — pop in.
        markerBornAt[slot] = now;
      }
      const nextPosition = previousPosition
        ? {
            x:
              previousPosition.x +
              (targetOrigin.x - previousPosition.x) * ORIGIN_MARKER_SMOOTHING_FACTOR,
            y:
              previousPosition.y +
              (targetOrigin.y - previousPosition.y) * ORIGIN_MARKER_SMOOTHING_FACTOR,
          }
        : { x: targetOrigin.x, y: targetOrigin.y };

      const popProgress = Math.min(1, (now - (markerBornAt[slot] ?? 0)) / BADGE_POP_DURATION_MS);

      smoothedMarkerPositions[slot] = nextPosition;
      markers.push({
        x: nextPosition.x,
        y: nextPosition.y,
        color: displayColor,
        label: slot + 1,
        slot,
        scale: popProgress < 1 ? easeOutBack(popProgress) : 1,
      });
    }

    smoothedMarkerPositions.length = displayColors.length;
    markerBornAt.length = displayColors.length;
    lastRenderedMarkers = markers;
    drawOriginMarkers(
      originsOverlayContext,
      [...markers, ...buildFallingBadgeMarkers(now)],
      frameWidth,
      frameHeight,
    );
  }

  function reset() {
    lastExtractionAt = 0;
    lastExtractedColors = null;
    lastExtractedOrigins = [];
    clearOriginMarkers();
    originTracker.reset();
    frozenSlots.clear();
    frozenPresenceBreaches.clear();
    frozenSceneReference = null;
    frozenSceneBreachCount = 0;
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
      if (smoothedMarkerPositions.length > 0) {
        clearOriginMarkers();
      }
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
            frozenColors: getFrozenColorEntries(),
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
            lastExtractedOrigins = originTracker.compute(
              frameImageData,
              analysisWidth,
              analysisHeight,
              result.colors,
            );
            checkFrozenSceneChange(result.colors);
            if (frozenSlots.size > 0) {
              const frozenEntries = getFrozenColorEntries();
              const presence = computeColorPresence(
                frameImageData,
                analysisWidth,
                analysisHeight,
                frozenEntries.map((entry) => entry.color),
              );
              processFrozenPresence(
                frozenEntries.map((entry, index) => ({
                  slot: entry.slot,
                  presence: presence[index] ?? 0,
                })),
              );
            }
            analysisDurationMs = performance.now() - analysisStartTime;
          }
        }
      }

      if (!lastExtractedColors || lastExtractedColors.length === 0) {
        scheduleRefresh();
        return;
      }

      const smoothedColors = colorSmoother.smooth(lastExtractedColors, PREVIEW_SMOOTHING_FACTOR);
      const liveColors = getOneMoreColor() ? removeDarkestColor(smoothedColors) : smoothedColors;
      const displayColors = applyFrozenColors(liveColors);

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
    handleWorkerResult({ colors, durationMs, origins, frozenPresence }) {
      latestPaletteWorkerDurationMs = durationMs;
      lastExtractedColors = colors;
      lastExtractedOrigins = Array.isArray(origins) ? origins : [];
      checkFrozenSceneChange(colors);
      processFrozenPresence(frozenPresence);
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
