import { reportAppError } from "./error-reporting.js";

const DEFAULT_ZOOM_STEP = 0.1;
const DEFAULT_EXPOSURE_STEP = 0.1;
const IDEAL_CAMERA_WIDTH = 1600;
const IDEAL_CAMERA_HEIGHT = 1200;
const IDEAL_CAMERA_FRAME_RATE = 60;

/**
 * @param {CameraControllerOptions} options
 * @returns {CameraController}
 */
export function createCameraController({
  cameraFeed,
  onCameraActiveChange,
  onExposureChange,
  onZoomChange,
  onError,
  onStreamInterrupted,
  initialFacingMode = "environment",
  zoomStep = DEFAULT_ZOOM_STEP,
}) {
  let facingMode = initialFacingMode;
  /** @type {MediaStreamTrack | null} */
  let videoTrack = null;
  let currentZoom = 1;
  let currentExposureCompensation = 0;
  /** @type {CameraPoint | null} */
  let currentMeteringPoint = null;
  /** @type {Promise<boolean> | null} */
  let activeStartPromise = null;
  let streamRevision = 0;
  let isDestroyed = false;
  /** @type {Array<() => void>} */
  const trackEventCleanups = [];

  function notifyZoomChange() {
    onZoomChange?.(currentZoom);
  }

  function notifyExposureChange() {
    onExposureChange?.(currentExposureCompensation);
  }

  function notifyCameraActiveChange(isActive) {
    onCameraActiveChange?.(isActive);
  }

  function reportError(message, error) {
    reportAppError(error, {
      consoleMessage: message,
      includeClientLog: false,
    });
    onError?.(error);
  }

  function reportControlError(message, error) {
    reportAppError(error, {
      consoleMessage: message,
      consoleLevel: "warn",
      includeClientLog: false,
    });
  }

  function clearTrackEventListeners() {
    while (trackEventCleanups.length > 0) {
      const cleanup = trackEventCleanups.pop();
      cleanup?.();
    }
  }

  function getCurrentStream() {
    return cameraFeed?.srcObject instanceof MediaStream
      ? /** @type {MediaStream} */ (cameraFeed.srcObject)
      : null;
  }

  function releaseStream(stream) {
    stream?.getTracks?.().forEach((track) => {
      track.stop();
    });
    if (cameraFeed?.srcObject === stream) {
      cameraFeed.srcObject = null;
    }
  }

  function notifyStreamInterrupted(type) {
    onStreamInterrupted?.({
      type,
      trackReadyState: videoTrack?.readyState ?? "ended",
    });
  }

  function bindVideoTrack(nextVideoTrack) {
    clearTrackEventListeners();
    videoTrack = nextVideoTrack;

    if (!nextVideoTrack) {
      return;
    }

    const handleTrackInterrupted = (event) => {
      if (videoTrack !== nextVideoTrack) {
        return;
      }

      notifyStreamInterrupted(event.type);
    };

    nextVideoTrack.addEventListener("ended", handleTrackInterrupted);
    nextVideoTrack.addEventListener("mute", handleTrackInterrupted);

    trackEventCleanups.push(() => {
      nextVideoTrack.removeEventListener("ended", handleTrackInterrupted);
      nextVideoTrack.removeEventListener("mute", handleTrackInterrupted);
    });
  }

  function enforceInlineVideoPlayback() {
    if (!cameraFeed) {
      return;
    }

    // iOS Safari/PWA may force fullscreen unless these are set as both attrs and props.
    cameraFeed.setAttribute("playsinline", "");
    cameraFeed.setAttribute("webkit-playsinline", "");
    cameraFeed.setAttribute("autoplay", "");
    cameraFeed.setAttribute("muted", "");
    cameraFeed.setAttribute("disablepictureinpicture", "");

    cameraFeed.playsInline = true;
    cameraFeed.autoplay = true;
    cameraFeed.muted = true;
    cameraFeed.defaultMuted = true;
    cameraFeed.controls = false;
    cameraFeed.disablePictureInPicture = true;
  }

  function clampZoom(zoomValue, zoomCapabilities) {
    return Math.max(zoomCapabilities.min, Math.min(zoomCapabilities.max, zoomValue));
  }

  function clampExposureCompensation(exposureValue, exposureCapabilities) {
    return Math.max(exposureCapabilities.min, Math.min(exposureCapabilities.max, exposureValue));
  }

  function getNeutralExposureCompensation(exposureCapabilities) {
    return clampExposureCompensation(0, exposureCapabilities);
  }

  function getPreferredExposureMode(capabilities) {
    const exposureModes = Array.isArray(capabilities?.exposureMode)
      ? capabilities.exposureMode
      : [];

    if (exposureModes.includes("continuous")) {
      return "continuous";
    }

    return null;
  }

  function getPreferredFocusMode(capabilities) {
    const focusModes = Array.isArray(capabilities?.focusMode) ? capabilities.focusMode : [];

    if (focusModes.includes("continuous")) {
      return "continuous";
    }

    return null;
  }

  function supportsPointsOfInterest(capabilities) {
    const pointCapabilities = capabilities?.pointsOfInterest;

    if (Array.isArray(pointCapabilities)) {
      return true;
    }

    if (typeof pointCapabilities === "boolean") {
      return pointCapabilities;
    }

    return false;
  }

  function clampNormalizedPoint(point) {
    return {
      x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
      y: Math.max(0, Math.min(1, Number(point?.y) || 0)),
    };
  }

  function getTrackCapabilities() {
    return videoTrack?.getCapabilities
      ? /** @type {CameraTrackCapabilities} */ (videoTrack.getCapabilities())
      : null;
  }

  function getTrackSettings() {
    return videoTrack?.getSettings
      ? /** @type {CameraTrackSettings} */ (videoTrack.getSettings())
      : null;
  }

  /**
   * @param {unknown} error
   * @returns {string}
   */
  function getErrorName(error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      typeof error.name === "string"
    ) {
      return error.name;
    }

    return "";
  }

  function syncTrackControlsFromSettings() {
    const capabilities = getTrackCapabilities();
    const settings = getTrackSettings();

    const zoomCapabilities = capabilities?.zoom;
    if (zoomCapabilities) {
      const nextZoom = typeof settings?.zoom === "number" ? settings.zoom : zoomCapabilities.min;
      currentZoom = clampZoom(nextZoom, zoomCapabilities);
    } else {
      currentZoom = 1;
    }

    const exposureCapabilities = capabilities?.exposureCompensation;
    if (exposureCapabilities) {
      const nextExposure =
        typeof settings?.exposureCompensation === "number"
          ? settings.exposureCompensation
          : getNeutralExposureCompensation(exposureCapabilities);
      currentExposureCompensation = clampExposureCompensation(nextExposure, exposureCapabilities);
    } else {
      currentExposureCompensation = 0;
    }
  }

  async function applyTrackControls() {
    if (!videoTrack?.getCapabilities || !videoTrack.applyConstraints) {
      return false;
    }

    const capabilities = getTrackCapabilities();
    /** @type {CameraTrackConstraintSet} */
    const nextConstraintSet = {};

    if (!capabilities) {
      return false;
    }

    if (capabilities.zoom) {
      currentZoom = clampZoom(currentZoom, capabilities.zoom);
      nextConstraintSet.zoom = currentZoom;
    }

    if (capabilities.exposureCompensation) {
      currentExposureCompensation = clampExposureCompensation(
        currentExposureCompensation,
        capabilities.exposureCompensation,
      );
      nextConstraintSet.exposureCompensation = currentExposureCompensation;
    }

    const preferredExposureMode = getPreferredExposureMode(capabilities);
    if (preferredExposureMode) {
      nextConstraintSet.exposureMode = preferredExposureMode;
    }

    if (currentMeteringPoint && supportsPointsOfInterest(capabilities)) {
      nextConstraintSet.pointsOfInterest = [currentMeteringPoint];
    }

    const preferredFocusMode = getPreferredFocusMode(capabilities);
    if (currentMeteringPoint && preferredFocusMode) {
      nextConstraintSet.focusMode = preferredFocusMode;
    }

    if (Object.keys(nextConstraintSet).length === 0) {
      notifyZoomChange();
      notifyExposureChange();
      return true;
    }

    try {
      await videoTrack.applyConstraints({
        advanced: [/** @type {MediaTrackConstraintSet} */ (nextConstraintSet)],
      });
      syncTrackControlsFromSettings();
      notifyZoomChange();
      notifyExposureChange();
      return true;
    } catch (error) {
      reportControlError("Error applying camera controls:", error);
      syncTrackControlsFromSettings();
      notifyZoomChange();
      notifyExposureChange();
      return false;
    }
  }

  async function applyZoom(zoomValue) {
    const zoomCapabilities = getTrackCapabilities()?.zoom;
    if (!zoomCapabilities) {
      return false;
    }

    currentZoom = clampZoom(zoomValue, zoomCapabilities);

    return applyTrackControls();
  }

  async function applyExposureCompensation(exposureValue) {
    const exposureCapabilities = getTrackCapabilities()?.exposureCompensation;
    if (!exposureCapabilities) {
      return false;
    }

    currentExposureCompensation = clampExposureCompensation(exposureValue, exposureCapabilities);

    return applyTrackControls();
  }

  async function setMeteringPoint(point) {
    const capabilities = getTrackCapabilities();
    if (!supportsPointsOfInterest(capabilities)) {
      return false;
    }

    currentMeteringPoint = clampNormalizedPoint(point);
    return applyTrackControls();
  }

  function stopStream() {
    streamRevision += 1;
    activeStartPromise = null;
    clearTrackEventListeners();

    const stream = getCurrentStream();
    if (!stream) {
      notifyCameraActiveChange(false);
      videoTrack = null;
      currentMeteringPoint = null;
      return;
    }

    releaseStream(stream);
    cameraFeed?.pause?.();
    videoTrack = null;
    currentMeteringPoint = null;
    notifyCameraActiveChange(false);
  }

  async function startStream() {
    if (!cameraFeed || isDestroyed) {
      return false;
    }

    if (activeStartPromise) {
      return activeStartPromise;
    }

    enforceInlineVideoPlayback();
    stopStream();
    const startRevision = streamRevision;

    const currentStartPromise = (async () => {
      let acquiredStream = null;
      try {
        const videoConstraintCandidates = [
          {
            facingMode,
            width: { ideal: IDEAL_CAMERA_WIDTH },
            height: { ideal: IDEAL_CAMERA_HEIGHT },
            frameRate: { ideal: IDEAL_CAMERA_FRAME_RATE },
          },
          { facingMode },
          true,
        ];

        for (const video of videoConstraintCandidates) {
          try {
            acquiredStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
            break;
          } catch (err) {
            if (getErrorName(err) !== "OverconstrainedError") {
              throw err;
            }
          }
        }

        if (!acquiredStream) {
          throw new DOMException("Camera unavailable", "OverconstrainedError");
        }

        if (startRevision !== streamRevision) {
          releaseStream(acquiredStream);
          return false;
        }

        cameraFeed.srcObject = acquiredStream;
        await cameraFeed.play();

        if (startRevision !== streamRevision) {
          releaseStream(acquiredStream);
          return false;
        }

        bindVideoTrack(acquiredStream.getVideoTracks()[0] ?? null);
        syncTrackControlsFromSettings();
        await applyTrackControls();

        if (startRevision !== streamRevision) {
          releaseStream(acquiredStream);
          return false;
        }

        notifyCameraActiveChange(true);

        return true;
      } catch (error) {
        releaseStream(acquiredStream);
        if (startRevision !== streamRevision || isDestroyed) {
          return false;
        }
        notifyCameraActiveChange(false);
        const name = getErrorName(error);
        if (name === "NotAllowedError" || name === "OverconstrainedError") {
          // Expected: permission denied or camera unavailable — notify without console noise.
          onError?.(error);
        } else {
          reportError("Unable to start camera stream:", error);
        }
        return false;
      }
    })();

    activeStartPromise = currentStartPromise;

    try {
      return await currentStartPromise;
    } finally {
      if (activeStartPromise === currentStartPromise) {
        activeStartPromise = null;
      }
    }
  }

  async function toggleFacingMode() {
    if (isDestroyed) {
      return false;
    }
    facingMode = facingMode === "environment" ? "user" : "environment";
    currentZoom = 1;
    currentExposureCompensation = 0;
    currentMeteringPoint = null;
    notifyZoomChange();
    notifyExposureChange();

    return startStream();
  }

  function getFacingMode() {
    return facingMode;
  }

  function getCurrentZoom() {
    return currentZoom;
  }

  function getCurrentExposureCompensation() {
    return currentExposureCompensation;
  }

  function getZoomCapabilities() {
    const zoomCapabilities = getTrackCapabilities()?.zoom;
    if (!zoomCapabilities) {
      return null;
    }

    return {
      min: zoomCapabilities.min,
      max: zoomCapabilities.max,
      step: zoomCapabilities.step ?? zoomStep,
    };
  }

  function getExposureCapabilities() {
    const exposureCapabilities = getTrackCapabilities()?.exposureCompensation;
    if (!exposureCapabilities) {
      return null;
    }

    return {
      min: exposureCapabilities.min,
      max: exposureCapabilities.max,
      step: exposureCapabilities.step ?? DEFAULT_EXPOSURE_STEP,
    };
  }

  function supportsMeteringPointSelection() {
    return supportsPointsOfInterest(getTrackCapabilities());
  }

  function getStreamState() {
    const stream = getCurrentStream();
    const currentVideoTrack = videoTrack ?? stream?.getVideoTracks()[0] ?? null;

    return {
      hasStream: Boolean(stream),
      hasVideoTrack: Boolean(currentVideoTrack),
      trackReadyState: currentVideoTrack?.readyState ?? "ended",
      videoReadyState: cameraFeed?.readyState ?? 0,
      videoPaused: Boolean(cameraFeed?.paused),
      videoEnded: Boolean(cameraFeed?.ended),
      videoWidth: cameraFeed?.videoWidth ?? 0,
      videoHeight: cameraFeed?.videoHeight ?? 0,
      currentTime: cameraFeed?.currentTime ?? 0,
    };
  }

  function destroy() {
    isDestroyed = true;
    stopStream();
  }

  return {
    applyExposureCompensation,
    destroy,
    applyZoom,
    getCurrentExposureCompensation,
    getCurrentZoom,
    getExposureCapabilities,
    getZoomCapabilities,
    getFacingMode,
    getStreamState,
    setMeteringPoint,
    startStream,
    stopStream,
    supportsMeteringPointSelection,
    toggleFacingMode,
  };
}
