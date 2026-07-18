export const EXTRACTION_MIN_INTERVAL_MS = 200;
export const CAMERA_TRACK_SETTINGS_REFRESH_MS = 1000;

/**
 * Owns the live preview's clock and cadence bookkeeping without knowing about
 * frames, extraction, rendering, or camera APIs.
 * @param {object} [options]
 * @param {(callback: FrameRequestCallback) => number} [options.requestFrame]
 * @param {(requestId: number) => void} [options.cancelFrame]
 * @param {() => number} [options.now]
 * @param {number} [options.extractionIntervalMs]
 * @param {number} [options.cameraSettingsRefreshMs]
 * @param {(timestamp: number) => void} [options.onFrame]
 */
export function createLivePreviewTiming({
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (requestId) => window.cancelAnimationFrame(requestId),
  now = () => performance.now(),
  extractionIntervalMs = EXTRACTION_MIN_INTERVAL_MS,
  cameraSettingsRefreshMs = CAMERA_TRACK_SETTINGS_REFRESH_MS,
  onFrame,
} = {}) {
  let pendingFrameRequestId = 0;
  let lastExtractionAt = 0;
  let cameraSettingsRefreshedAt = 0;

  function cancel() {
    if (!pendingFrameRequestId) {
      return;
    }
    cancelFrame(pendingFrameRequestId);
    pendingFrameRequestId = 0;
  }

  /** @param {boolean} isEnabled */
  function schedule(isEnabled) {
    if (!isEnabled || pendingFrameRequestId) {
      return;
    }
    pendingFrameRequestId = requestFrame((timestamp) => {
      pendingFrameRequestId = 0;
      onFrame?.(timestamp);
    });
  }

  return {
    cancel,
    /** @param {number} timestamp */
    markCameraSettingsRefreshed(timestamp) {
      cameraSettingsRefreshedAt = timestamp;
    },
    /** @param {number} timestamp */
    markExtracted(timestamp) {
      lastExtractionAt = timestamp;
    },
    now,
    resetCadence() {
      lastExtractionAt = 0;
      cameraSettingsRefreshedAt = 0;
    },
    schedule,
    /** @param {number} timestamp @param {boolean} hasExtractedColors */
    shouldExtract(timestamp, hasExtractedColors) {
      return timestamp - lastExtractionAt >= extractionIntervalMs || !hasExtractedColors;
    },
    /** @param {number} timestamp @param {boolean} hasCachedSettings */
    shouldRefreshCameraSettings(timestamp, hasCachedSettings) {
      return !hasCachedSettings || timestamp - cameraSettingsRefreshedAt >= cameraSettingsRefreshMs;
    },
  };
}
