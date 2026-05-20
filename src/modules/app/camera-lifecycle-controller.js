import { DEFAULT_CAMERA_RESUME_DELAY_MS, getCameraResumeDelay } from "../camera-resume-policy.js";
import { clientLog } from "../client-log.js";
import { formatErrorDetails } from "../error-format.js";
import { showToast } from "../toast-ui.js";
import { t } from "../../i18n.js";
import { supportsCameraStartup, waitForDelay } from "../platform.js";

const CAMERA_HEALTH_CHECK_DELAY_MS = 320;
const CAMERA_MIN_TIME_ADVANCE_SECONDS = 0.05;

export function createCameraLifecycleController({
  cameraFeed,
  cameraController,
  captureButton,
  rotateButton,
  captureMicroInteractions,
  isIOS,
  livePreviewController,
  visualEffects,
  getExposureUi,
  getIsAppDestroyed,
  getZoomUi,
  scheduleViewportMetricsSync,
  syncCameraFeedOrientation,
  syncCameraViewportLayout,
  updateCachedPreviewDimensions,
}) {
  let isInitialStartupComplete = false;
  let shouldResumeCameraOnForeground = false;
  let cameraResumeTimeoutId = 0;
  let cameraResumeAttemptId = 0;
  let activeCameraStartPromise = null;

  function syncActionAvailability() {
    const shouldDisableActions = !supportsCameraStartup() || Boolean(activeCameraStartPromise);
    if (captureButton) captureButton.disabled = shouldDisableActions;
    if (rotateButton) rotateButton.disabled = shouldDisableActions;
    captureButton?.classList.toggle("is-loading", Boolean(activeCameraStartPromise));
  }

  function getCameraStartToastOptions(error) {
    const name = error?.name ?? "";

    if (name === "NotAllowedError" || name === "SecurityError") {
      return {
        message: t("camera.start.notAllowed"),
        duration: 4200,
      };
    }

    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return {
        message: t("camera.start.notFound"),
        duration: 3800,
      };
    }

    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
      return {
        message: t("camera.start.notReadable"),
        duration: 3800,
      };
    }

    if (name === "OverconstrainedError") {
      return {
        message: t("camera.start.overconstrained"),
        duration: 3800,
      };
    }

    return {
      message: t("camera.start.generic"),
      duration: 3500,
      details: formatErrorDetails(error),
    };
  }

  function handleCameraStartError(error) {
    const { message, duration, details } = getCameraStartToastOptions(error);
    showToast(message, {
      variant: "error",
      duration,
      details,
    });
  }

  function cancelScheduledResume() {
    if (!cameraResumeTimeoutId) {
      return;
    }

    window.clearTimeout(cameraResumeTimeoutId);
    cameraResumeTimeoutId = 0;
  }

  function invalidateResumeChecks() {
    cameraResumeAttemptId += 1;
  }

  function finalizeStartedCameraStream(started) {
    if (!started) {
      return false;
    }

    syncCameraViewportLayout();
    updateCachedPreviewDimensions();
    getZoomUi()?.syncCapabilities();
    getExposureUi()?.syncCapabilities();
    shouldResumeCameraOnForeground = true;

    if (!livePreviewController.getIsStreaming()) {
      livePreviewController.setStreaming(true);
      livePreviewController.scheduleRefresh();
    }

    return true;
  }

  async function runStartOperation(startOperation) {
    if (!supportsCameraStartup()) {
      syncActionAvailability();
      return false;
    }

    if (activeCameraStartPromise) {
      return activeCameraStartPromise;
    }

    const startPromise = (async () => {
      cancelScheduledResume();
      invalidateResumeChecks();
      livePreviewController.setStreaming(false);
      livePreviewController.cancelRefresh();

      const started = await startOperation();

      return finalizeStartedCameraStream(started);
    })();

    activeCameraStartPromise = startPromise;
    syncActionAvailability();

    try {
      return await startPromise;
    } finally {
      if (activeCameraStartPromise === startPromise) {
        activeCameraStartPromise = null;
      }
      syncActionAvailability();
    }
  }

  function pauseCameraPreview() {
    livePreviewController.setStreaming(false);
    livePreviewController.cancelRefresh();
    livePreviewController.reset();
    cameraFeed?.pause?.();
    visualEffects.setCaptureGlowActive(false);
    captureMicroInteractions.cleanup();
    livePreviewController.recordStoppedFrame();
  }

  function shouldHandleCameraLifecycle() {
    return !getIsAppDestroyed() && Boolean(cameraFeed);
  }

  function getShouldKeepCameraWarmInBackground() {
    return !isIOS;
  }

  async function resumePreviewFromActiveStream() {
    if (!cameraFeed) {
      return false;
    }

    try {
      await cameraFeed.play();
    } catch {
      return false;
    }

    syncCameraViewportLayout();
    if (!updateCachedPreviewDimensions()) {
      return false;
    }

    getZoomUi()?.syncCapabilities();
    livePreviewController.setStreaming(true);
    livePreviewController.scheduleRefresh();

    return true;
  }

  async function isCameraStreamHealthy(resumeAttemptId) {
    if (!cameraFeed) {
      return false;
    }

    const initialState = cameraController.getStreamState();
    if (
      !initialState.hasStream ||
      !initialState.hasVideoTrack ||
      initialState.trackReadyState !== "live" ||
      initialState.videoReadyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return false;
    }

    try {
      await cameraFeed.play();
    } catch {
      return false;
    }

    const initialTime = cameraFeed.currentTime;
    await waitForDelay(CAMERA_HEALTH_CHECK_DELAY_MS);

    if (
      resumeAttemptId !== cameraResumeAttemptId ||
      !shouldHandleCameraLifecycle() ||
      document.visibilityState !== "visible"
    ) {
      return false;
    }

    const nextState = cameraController.getStreamState();
    if (
      !nextState.hasStream ||
      !nextState.hasVideoTrack ||
      nextState.trackReadyState !== "live" ||
      nextState.videoWidth <= 0 ||
      nextState.videoHeight <= 0
    ) {
      return false;
    }

    return cameraFeed.currentTime > initialTime + CAMERA_MIN_TIME_ADVANCE_SECONDS;
  }

  async function resumeCameraIfNeeded(reason) {
    if (
      !shouldHandleCameraLifecycle() ||
      !shouldResumeCameraOnForeground ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const resumeAttemptId = ++cameraResumeAttemptId;
    const streamState = cameraController.getStreamState();

    if (
      !streamState.hasStream ||
      !streamState.hasVideoTrack ||
      streamState.trackReadyState !== "live" ||
      !getShouldKeepCameraWarmInBackground()
    ) {
      await startCameraStream();
      return;
    }

    const isHealthy = await isCameraStreamHealthy(resumeAttemptId);
    if (
      resumeAttemptId !== cameraResumeAttemptId ||
      !shouldHandleCameraLifecycle() ||
      !shouldResumeCameraOnForeground ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    if (isHealthy) {
      const resumed = await resumePreviewFromActiveStream();
      if (resumed) {
        return;
      }
    }

    clientLog("Restarting camera after app resume.", {
      reason,
      isIOS,
    });
    await startCameraStream();
  }

  function scheduleResume(reason, delayMs = DEFAULT_CAMERA_RESUME_DELAY_MS) {
    if (
      !isInitialStartupComplete ||
      !shouldHandleCameraLifecycle() ||
      !shouldResumeCameraOnForeground ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    cancelScheduledResume();
    const effectiveDelayMs = getCameraResumeDelay({
      isIOS,
      reason,
      requestedDelayMs: delayMs,
    });

    cameraResumeTimeoutId = window.setTimeout(() => {
      cameraResumeTimeoutId = 0;
      void resumeCameraIfNeeded(reason);
    }, effectiveDelayMs);
  }

  function handleAppHidden() {
    if (!shouldHandleCameraLifecycle()) {
      return;
    }

    const streamState = cameraController.getStreamState();
    shouldResumeCameraOnForeground =
      shouldResumeCameraOnForeground ||
      livePreviewController.getIsStreaming() ||
      streamState.hasStream ||
      streamState.trackReadyState === "live";
    invalidateResumeChecks();
    cancelScheduledResume();
    pauseCameraPreview();

    if (!getShouldKeepCameraWarmInBackground()) {
      cameraController.stopStream();
    }
  }

  function handleDocumentVisibilityChange() {
    if (document.visibilityState === "hidden") {
      handleAppHidden();
      return;
    }

    scheduleViewportMetricsSync();
    scheduleResume("visibilitychange");
  }

  function handleWindowPageShow() {
    scheduleViewportMetricsSync();
    scheduleResume("pageshow");
  }

  function handleWindowFocus() {
    if (document.visibilityState !== "visible") {
      return;
    }

    scheduleViewportMetricsSync();
    scheduleResume("focus");
  }

  function handleCameraActiveChange(isCameraActive) {
    syncCameraFeedOrientation();
    if (!isCameraActive) {
      livePreviewController.reset();
      getZoomUi()?.setDisabled();
      getExposureUi()?.setDisabled();
      visualEffects.setCaptureGlowActive(false);
    } else {
      getZoomUi()?.syncCapabilities();
      getExposureUi()?.syncCapabilities();
    }

    if (isCameraActive) {
      shouldResumeCameraOnForeground = true;
    } else {
      livePreviewController.setStreaming(false);
    }
  }

  function handleStreamInterrupted({ type }) {
    shouldResumeCameraOnForeground = true;

    if (document.visibilityState !== "visible") {
      return;
    }

    scheduleResume(`track-${type}`, 0);
  }

  async function startCameraStream() {
    return runStartOperation(() => cameraController.startStream());
  }

  async function rotateCamera() {
    stopCurrentStream({ preserveResumeIntent: true });
    await runStartOperation(() => cameraController.toggleFacingMode());
  }

  function handleCameraCanPlay() {
    if (cameraFeed.videoWidth <= 0 || cameraFeed.videoHeight <= 0) {
      return;
    }

    syncCameraViewportLayout();
    if (!updateCachedPreviewDimensions()) {
      return;
    }

    if (!livePreviewController.getIsStreaming()) {
      livePreviewController.setStreaming(true);
      livePreviewController.scheduleRefresh();
    }
  }

  function stopCurrentStream({ preserveResumeIntent = shouldResumeCameraOnForeground } = {}) {
    shouldResumeCameraOnForeground = preserveResumeIntent;
    invalidateResumeChecks();
    cancelScheduledResume();
    pauseCameraPreview();
    cameraController.stopStream();
  }

  return {
    cancelScheduledResume,
    handleAppHidden,
    handleCameraActiveChange,
    handleCameraCanPlay,
    handleCameraStartError,
    handleDocumentVisibilityChange,
    handleStreamInterrupted,
    handleWindowFocus,
    handleWindowPageShow,
    rotateCamera,
    setInitialStartupComplete() {
      isInitialStartupComplete = true;
    },
    startCameraStream,
    stopCurrentStream,
    syncActionAvailability,
  };
}
