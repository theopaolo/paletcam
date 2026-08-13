import { describe, expect, mock, test } from "bun:test";
import { createPanelCameraUiController } from "./panel-camera-ui-controller.js";

function createDocumentHarness() {
  const listeners = new Map();
  const videos = [];
  const documentRef = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) {
        listeners.delete(name);
      }
    },
    createElement(name) {
      expect(name).toBe("video");
      const video = {
        parentElement: null,
        play: mock(async () => {}),
        remove: mock(() => {
          video.parentElement = null;
        }),
        setAttribute: mock(() => {}),
        srcObject: null,
      };
      videos.push(video);
      return video;
    },
    body: {
      appendChild(video) {
        video.parentElement = documentRef.body;
      },
    },
  };

  function dispatch(name, isOpen) {
    listeners.get(name)?.({ detail: { isOpen } });
  }

  return { dispatch, documentRef, listeners, videos };
}

function createUiHarness() {
  return {
    exposureUi: {
      setDisabled: mock(() => {}),
      syncCapabilities: mock(() => {}),
    },
    gridUi: {
      hide: mock(() => {}),
      show: mock(() => {}),
    },
    zoomUi: {
      setDisabled: mock(() => {}),
      syncCapabilities: mock(() => {}),
    },
  };
}

function createHarness({ innerHeight = 700 } = {}) {
  const documentHarness = createDocumentHarness();
  const ui = createUiHarness();
  const stream = {};
  const controller = createPanelCameraUiController({
    cameraFeed: { srcObject: stream },
    configPanel: {},
    ...ui,
    documentRef: documentHarness.documentRef,
    windowRef: { innerHeight },
  });
  controller.bind();
  return { controller, documentHarness, stream, ui };
}

describe("panel camera UI controller", () => {
  test("owns and releases the compact configuration preview", async () => {
    const { documentHarness, stream, ui } = createHarness();

    documentHarness.dispatch("config-drawer-change", true);

    expect(documentHarness.videos).toHaveLength(1);
    const [video] = documentHarness.videos;
    expect(video.srcObject).toBe(stream);
    expect(video.parentElement).toBe(documentHarness.documentRef.body);
    expect(ui.zoomUi.setDisabled).toHaveBeenCalledTimes(1);
    expect(ui.gridUi.hide).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledTimes(1);

    documentHarness.dispatch("config-drawer-change", false);

    expect(video.srcObject).toBeNull();
    expect(video.remove).toHaveBeenCalledTimes(1);
    expect(ui.zoomUi.syncCapabilities).toHaveBeenCalledTimes(1);
    expect(ui.gridUi.show).toHaveBeenCalledTimes(1);
  });

  test("keeps controls hidden until every camera-obscuring drawer closes", () => {
    const { documentHarness, ui } = createHarness();

    documentHarness.dispatch("config-drawer-change", true);
    documentHarness.dispatch("settings-drawer-change", true);
    documentHarness.dispatch("config-drawer-change", false);

    expect(ui.zoomUi.syncCapabilities).not.toHaveBeenCalled();
    expect(ui.gridUi.show).not.toHaveBeenCalled();

    documentHarness.dispatch("settings-drawer-change", false);

    expect(ui.zoomUi.syncCapabilities).toHaveBeenCalledTimes(1);
    expect(ui.gridUi.show).toHaveBeenCalledTimes(1);
  });

  test("destroy removes an open preview and all owned listeners", () => {
    const { controller, documentHarness } = createHarness();
    documentHarness.dispatch("config-drawer-change", true);
    const [video] = documentHarness.videos;

    controller.destroy();

    expect(video.srcObject).toBeNull();
    expect(video.remove).toHaveBeenCalledTimes(1);
    expect(documentHarness.listeners.size).toBe(0);

    documentHarness.dispatch("config-drawer-change", true);
    expect(documentHarness.videos).toHaveLength(1);
  });

  test("does not create a compact preview on a tall viewport", () => {
    const { documentHarness, ui } = createHarness({ innerHeight: 900 });

    documentHarness.dispatch("config-drawer-change", true);

    expect(documentHarness.videos).toHaveLength(0);
    expect(ui.exposureUi.setDisabled).toHaveBeenCalledTimes(1);
    expect(ui.gridUi.hide).toHaveBeenCalledTimes(1);
  });
});
