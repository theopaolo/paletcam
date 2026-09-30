import { describe, expect, mock, test } from "bun:test";
import { createPanelCameraUiController } from "./panel-camera-ui-controller.js";

function createHarness() {
  const listeners = new Map();
  const documentRef = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) {
        listeners.delete(name);
      }
    },
  };
  const ui = {
    exposureUi: { setDisabled: mock(() => {}), syncCapabilities: mock(() => {}) },
    zoomUi: { setDisabled: mock(() => {}), syncCapabilities: mock(() => {}) },
  };
  const controller = createPanelCameraUiController({ ...ui, documentRef });
  controller.bind();
  const dispatch = (name, isOpen) => listeners.get(name)?.({ detail: { isOpen } });
  return { controller, dispatch, listeners, ui };
}

describe("panel camera UI controller", () => {
  test("pauses zoom and exposure while the settings drawer covers the preview", () => {
    const { dispatch, ui } = createHarness();

    dispatch("settings-drawer-change", true);
    expect(ui.zoomUi.setDisabled).toHaveBeenCalledTimes(1);
    expect(ui.exposureUi.setDisabled).toHaveBeenCalledTimes(1);

    dispatch("settings-drawer-change", false);
    expect(ui.zoomUi.syncCapabilities).toHaveBeenCalledTimes(1);
    expect(ui.exposureUi.syncCapabilities).toHaveBeenCalledTimes(1);
  });

  test("ignores the tuning tray, which leaves the preview visible", () => {
    const { dispatch, ui } = createHarness();

    dispatch("config-drawer-change", true);

    expect(ui.zoomUi.setDisabled).not.toHaveBeenCalled();
    expect(ui.exposureUi.setDisabled).not.toHaveBeenCalled();
  });

  test("destroy removes its listener", () => {
    const { controller, listeners } = createHarness();

    controller.destroy();

    expect(listeners.size).toBe(0);
  });
});
