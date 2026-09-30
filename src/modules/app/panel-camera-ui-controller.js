/**
 * The settings drawer covers the live preview, so zoom and exposure stand down
 * while it is open. The tuning tray pushes the preview up instead of covering
 * it, so the camera controls stay live while tuning.
 */
export function createPanelCameraUiController({ zoomUi, exposureUi, documentRef = document }) {
  let isBound = false;
  let isDestroyed = false;

  function handleSettingsDrawerChange(event) {
    if (event?.detail?.isOpen) {
      zoomUi?.setDisabled();
      exposureUi?.setDisabled();
      return;
    }

    zoomUi?.syncCapabilities();
    exposureUi?.syncCapabilities();
  }

  function bind() {
    if (isBound || isDestroyed) {
      return;
    }

    isBound = true;
    documentRef.addEventListener("settings-drawer-change", handleSettingsDrawerChange);
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    if (isBound) {
      documentRef.removeEventListener("settings-drawer-change", handleSettingsDrawerChange);
      isBound = false;
    }
  }

  return {
    bind,
    destroy,
  };
}
