import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createZoomUiController } from "./zoom-ui.js";
import { FakeElement, installFakeDom } from "./test-support/fake-dom.js";

function findByClass(root, className) {
  if (root.classList?.contains(className)) {
    return root;
  }

  for (const child of root.children ?? []) {
    const match = findByClass(child, className);
    if (match) {
      return match;
    }
  }

  return null;
}

describe("createZoomUiController", () => {
  const originalVibrate = globalThis.navigator?.vibrate;
  let uninstallFakeDom = () => {};

  beforeEach(() => {
    uninstallFakeDom = installFakeDom();

    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "vibrate", {
        configurable: true,
        value() {},
      });
    }
  });

  afterEach(() => {
    uninstallFakeDom();

    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "vibrate", {
        configurable: true,
        value: originalVibrate,
      });
    }
  });

  test("renders an always-visible scrubber and rolls back a failed drag", async () => {
    const previewFrame = new FakeElement("div");
    const overlayHost = new FakeElement("div");
    previewFrame.appendChild(overlayHost);

    let applyRequestCount = 0;
    /** @type {(result: boolean) => void} */
    let resolveApply = () => {};
    const cameraController = {
      applyZoom() {
        applyRequestCount += 1;
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      },
      getCurrentZoom() {
        return 1;
      },
      getZoomCapabilities() {
        return { min: 0.5, max: 2.4, step: 0.1 };
      },
    };

    const zoomUi = createZoomUiController({
      cameraController,
      overlayHost,
    });
    zoomUi.initialize();
    zoomUi.syncCapabilities();
    zoomUi.bindEvents();

    const dock = findByClass(overlayHost, "camera-zoom-dock");
    const readout = findByClass(overlayHost, "camera-zoom-readout");
    const scrubber = findByClass(overlayHost, "camera-zoom-scrubber");
    const track = findByClass(overlayHost, "camera-zoom-ruler");
    track.setBoundingRect({ height: 20, left: 40, top: 0, width: 220 });

    expect(findByClass(overlayHost, "camera-zoom-chip-rack")).toBeNull();
    expect(readout.textContent).toBe("1x");
    expect(scrubber.tabIndex).toBe(0);
    expect(scrubber.getAttribute("aria-valuetext")).toBe("Zoom 1x");

    scrubber.dispatch("pointerdown", {
      button: 0,
      clientX: 98,
      pointerId: 1,
      target: scrubber,
    });
    scrubber.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(dock.classList.contains("is-scrubbing")).toBe(true);
    expect(scrubber.classList.contains("is-active")).toBe(true);
    expect(readout.textContent).toBe("1.4x");
    expect(scrubber.getAttribute("aria-valuetext")).toBe("Zoom 1.4x");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(readout.textContent).toBe("1x");

    scrubber.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(applyRequestCount).toBe(2);

    scrubber.dispatch("pointerup", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(dock.classList.contains("is-scrubbing")).toBe(false);
    expect(scrubber.classList.contains("is-active")).toBe(false);
  });

  test("supports keyboard nudges on the scrubber slider", async () => {
    const overlayHost = new FakeElement("div");

    let appliedZoom = null;
    const cameraController = {
      applyZoom(zoomValue) {
        appliedZoom = zoomValue;
        return Promise.resolve(true);
      },
      getCurrentZoom() {
        return 1;
      },
      getZoomCapabilities() {
        return { min: 1, max: 3, step: 0.1 };
      },
    };

    const zoomUi = createZoomUiController({
      cameraController,
      overlayHost,
    });
    zoomUi.initialize();
    zoomUi.syncCapabilities();
    zoomUi.bindEvents();

    const scrubber = findByClass(overlayHost, "camera-zoom-scrubber");
    const readout = findByClass(overlayHost, "camera-zoom-readout");

    scrubber.dispatch("keydown", { key: "ArrowRight", target: scrubber });
    await Promise.resolve();
    zoomUi.handleZoomChange(1.1);

    expect(appliedZoom).toBe(1.1);
    expect(readout.textContent).toBe("1.1x");
    expect(scrubber.getAttribute("aria-valuenow")).toBe("1.1");
    expect(scrubber.classList.contains("is-active")).toBe(true);
  });
});
