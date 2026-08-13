export function createPanelCameraUiController({
  cameraFeed,
  configPanel,
  zoomUi,
  exposureUi,
  gridUi,
  documentRef = document,
  windowRef = window,
}) {
  let isBound = false;
  let isDestroyed = false;
  let isConfigDrawerOpen = false;
  let isSettingsDrawerOpen = false;
  let configPipVideo = null;

  function removeConfigPipVideo() {
    if (!configPipVideo) {
      return;
    }

    configPipVideo.srcObject = null;
    configPipVideo.remove();
    configPipVideo = null;
  }

  function createConfigPipVideo() {
    const stream = cameraFeed?.srcObject;
    if (
      isDestroyed ||
      !isConfigDrawerOpen ||
      !stream ||
      !configPanel ||
      configPipVideo ||
      windowRef.innerHeight >= 800
    ) {
      return;
    }

    const video = documentRef.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = "config-pip";
    video.setAttribute("aria-hidden", "true");
    video.srcObject = stream;
    documentRef.body.appendChild(video);
    configPipVideo = video;

    try {
      void Promise.resolve(video.play()).catch(() => {});
    } catch {
      // This preview is optional; the main camera feed remains authoritative.
    }
  }

  function syncCameraControls() {
    if (isConfigDrawerOpen || isSettingsDrawerOpen) {
      zoomUi?.setDisabled();
      exposureUi?.setDisabled();
      gridUi?.hide();
      return;
    }

    zoomUi?.syncCapabilities();
    exposureUi?.syncCapabilities();
    gridUi?.show();
  }

  function handleConfigDrawerChange(event) {
    isConfigDrawerOpen = Boolean(event?.detail?.isOpen);
    if (isConfigDrawerOpen) {
      createConfigPipVideo();
    } else {
      removeConfigPipVideo();
    }
    syncCameraControls();
  }

  function handleSettingsDrawerChange(event) {
    isSettingsDrawerOpen = Boolean(event?.detail?.isOpen);
    syncCameraControls();
  }

  function bind() {
    if (isBound || isDestroyed) {
      return;
    }

    isBound = true;
    documentRef.addEventListener("config-drawer-change", handleConfigDrawerChange);
    documentRef.addEventListener("settings-drawer-change", handleSettingsDrawerChange);
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    removeConfigPipVideo();
    if (isBound) {
      documentRef.removeEventListener("config-drawer-change", handleConfigDrawerChange);
      documentRef.removeEventListener("settings-drawer-change", handleSettingsDrawerChange);
      isBound = false;
    }
  }

  return {
    bind,
    destroy,
  };
}
