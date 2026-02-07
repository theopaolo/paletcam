const DEFAULT_ZOOM_STEP = 0.1;
const DEFAULT_ZOOM_INTERVAL_MS = 50;

export function createCameraController({
  cameraFeed,
  onCameraActiveChange,
  onZoomChange,
  onError,
  initialFacingMode = 'environment',
  zoomStep = DEFAULT_ZOOM_STEP,
  zoomIntervalMs = DEFAULT_ZOOM_INTERVAL_MS,
}) {
  let facingMode = initialFacingMode;
  let videoTrack = null;
  let currentZoom = 1;
  let zoomTimer = null;

  function notifyZoomChange() {
    onZoomChange?.(currentZoom);
  }

  function notifyCameraActiveChange(isActive) {
    onCameraActiveChange?.(isActive);
  }

  function reportError(message, error) {
    console.error(message, error);
    onError?.(error);
  }

  function stopZoom() {
    if (!zoomTimer) {
      return;
    }

    window.clearInterval(zoomTimer);
    zoomTimer = null;
  }

  function clampZoom(zoomValue, zoomCapabilities) {
    return Math.max(zoomCapabilities.min, Math.min(zoomCapabilities.max, zoomValue));
  }

  async function applyZoom(zoomValue) {
    if (!videoTrack?.getCapabilities) {
      return;
    }

    const zoomCapabilities = videoTrack.getCapabilities().zoom;
    if (!zoomCapabilities) {
      return;
    }

    currentZoom = clampZoom(zoomValue, zoomCapabilities);

    try {
      await videoTrack.applyConstraints({ advanced: [{ zoom: currentZoom }] });
      notifyZoomChange();
    } catch (error) {
      reportError('Error applying zoom:', error);
    }
  }

  function startZoom(direction) {
    stopZoom();

    zoomTimer = window.setInterval(() => {
      const nextZoom = direction === 'in' ? currentZoom + zoomStep : currentZoom - zoomStep;
      void applyZoom(nextZoom);
    }, zoomIntervalMs);
  }

  function stopStream() {
    stopZoom();

    const stream = cameraFeed?.srcObject;
    if (!stream) {
      notifyCameraActiveChange(false);
      videoTrack = null;
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
    cameraFeed.srcObject = null;
    videoTrack = null;
    notifyCameraActiveChange(false);
  }

  async function startStream() {
    if (!cameraFeed) {
      return false;
    }

    stopStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });

      cameraFeed.srcObject = stream;
      await cameraFeed.play();

      videoTrack = stream.getVideoTracks()[0] ?? null;

      const minimumZoom = videoTrack?.getCapabilities?.().zoom?.min;
      if (typeof minimumZoom === 'number') {
        currentZoom = minimumZoom;
      }

      notifyZoomChange();
      notifyCameraActiveChange(true);

      return true;
    } catch (error) {
      notifyCameraActiveChange(false);
      reportError('Unable to start camera stream:', error);
      return false;
    }
  }

  async function toggleFacingMode() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    currentZoom = 1;
    notifyZoomChange();

    return startStream();
  }

  function getFacingMode() {
    return facingMode;
  }

  function getCurrentZoom() {
    return currentZoom;
  }

  return {
    applyZoom,
    getCurrentZoom,
    getFacingMode,
    startStream,
    startZoom,
    stopStream,
    stopZoom,
    toggleFacingMode,
  };
}
