const DEFAULT_ZOOM_STEP = 0.1;
const IDEAL_CAMERA_WIDTH = 1920;
const IDEAL_CAMERA_HEIGHT = 1080;

/**
 * @param {CameraControllerOptions} options
 * @returns {CameraController}
 */
export function createCameraController({
  cameraFeed,
  onCameraActiveChange,
  onZoomChange,
  onError,
  onStreamInterrupted,
  initialFacingMode = 'environment',
  zoomStep = DEFAULT_ZOOM_STEP,
}) {
  let facingMode = initialFacingMode;
  let videoTrack = null;
  let currentZoom = 1;
  let activeStartPromise = null;
  let streamRevision = 0;
  const trackEventCleanups = [];

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

  function notifyStreamInterrupted(type) {
    onStreamInterrupted?.({
      type,
      trackReadyState: videoTrack?.readyState ?? 'ended',
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

    nextVideoTrack.addEventListener('ended', handleTrackInterrupted);
    nextVideoTrack.addEventListener('mute', handleTrackInterrupted);

    trackEventCleanups.push(() => {
      nextVideoTrack.removeEventListener('ended', handleTrackInterrupted);
      nextVideoTrack.removeEventListener('mute', handleTrackInterrupted);
    });
  }

  function enforceInlineVideoPlayback() {
    if (!cameraFeed) {
      return;
    }

    // iOS Safari/PWA may force fullscreen unless these are set as both attrs and props.
    cameraFeed.setAttribute('playsinline', '');
    cameraFeed.setAttribute('webkit-playsinline', '');
    cameraFeed.setAttribute('autoplay', '');
    cameraFeed.setAttribute('muted', '');
    cameraFeed.setAttribute('disablepictureinpicture', '');

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

  async function applyZoom(zoomValue) {
    if (!videoTrack?.getCapabilities) {
      return;
    }

    const zoomCapabilities = /** @type {any} */ (videoTrack.getCapabilities()).zoom;
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

  function stopStream() {
    streamRevision += 1;
    activeStartPromise = null;
    clearTrackEventListeners();

    const stream = getCurrentStream();
    if (!stream) {
      notifyCameraActiveChange(false);
      videoTrack = null;
      return;
    }

    stream.getTracks().forEach((track) => {
      track.stop();
    });
    cameraFeed?.pause?.();
    cameraFeed.srcObject = null;
    videoTrack = null;
    notifyCameraActiveChange(false);
  }

  async function startStream() {
    if (!cameraFeed) {
      return false;
    }

    if (activeStartPromise) {
      return activeStartPromise;
    }

    enforceInlineVideoPlayback();
    stopStream();
    const startRevision = streamRevision;

    const currentStartPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: IDEAL_CAMERA_WIDTH },
            height: { ideal: IDEAL_CAMERA_HEIGHT },
          },
          audio: false,
        });

        if (startRevision !== streamRevision) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return false;
        }

        cameraFeed.srcObject = stream;
        await cameraFeed.play();

        if (startRevision !== streamRevision) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          if (cameraFeed.srcObject === stream) {
            cameraFeed.srcObject = null;
          }
          return false;
        }

        bindVideoTrack(stream.getVideoTracks()[0] ?? null);

        const minimumZoom = /** @type {any} */ (videoTrack?.getCapabilities?.())?.zoom?.min;
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

  function getZoomCapabilities() {
    const zoomCapabilities = /** @type {any} */ (videoTrack?.getCapabilities?.())?.zoom;
    if (!zoomCapabilities) {
      return null;
    }

    return {
      min: zoomCapabilities.min,
      max: zoomCapabilities.max,
      step: zoomCapabilities.step ?? zoomStep,
    };
  }

  function getStreamState() {
    const stream = getCurrentStream();
    const currentVideoTrack = videoTrack ?? stream?.getVideoTracks()[0] ?? null;

    return {
      hasStream: Boolean(stream),
      hasVideoTrack: Boolean(currentVideoTrack),
      trackReadyState: currentVideoTrack?.readyState ?? 'ended',
      videoReadyState: cameraFeed?.readyState ?? 0,
      videoPaused: Boolean(cameraFeed?.paused),
      videoEnded: Boolean(cameraFeed?.ended),
      videoWidth: cameraFeed?.videoWidth ?? 0,
      videoHeight: cameraFeed?.videoHeight ?? 0,
      currentTime: cameraFeed?.currentTime ?? 0,
    };
  }

  function destroy() {
    stopStream();
  }

  return {
    destroy,
    applyZoom,
    getCurrentZoom,
    getZoomCapabilities,
    getFacingMode,
    getStreamState,
    startStream,
    stopStream,
    toggleFacingMode,
  };
}
