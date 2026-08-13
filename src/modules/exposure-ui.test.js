import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createExposureUiController } from "./exposure-ui.js";
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

describe("createExposureUiController", () => {
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

  test("meters at the tapped point and drops any previous EV offset", async () => {
    const overlayHost = new FakeElement("div");
    overlayHost.setBoundingRect({ height: 640, left: 0, top: 0, width: 360 });

    const meteringPoints = [];
    const cameraController = {
      applyExposureCompensation() {
        return Promise.resolve(true);
      },
      getCurrentExposureCompensation() {
        return 0;
      },
      getExposureCapabilities() {
        return { min: -2, max: 2, step: 0.1 };
      },
      setMeteringPoint(point) {
        meteringPoints.push(point);
        return Promise.resolve(true);
      },
      supportsMeteringPointSelection() {
        return true;
      },
    };

    const exposureUi = createExposureUiController({ cameraController, overlayHost });
    exposureUi.initialize();
    exposureUi.syncCapabilities();
    exposureUi.bindEvents();

    const meterLayer = findByClass(overlayHost, "camera-meter-layer");
    meterLayer.setBoundingRect({ height: 640, left: 0, top: 0, width: 360 });
    const reticle = findByClass(overlayHost, "camera-meter-reticle");
    const evReadout = findByClass(overlayHost, "camera-meter-ev");

    exposureUi.handleExposureChange(0.8);
    expect(evReadout.textContent).toBe("+0.8");

    meterLayer.dispatch("pointerdown", { clientX: 90, clientY: 160, pointerId: 1 });
    await Promise.resolve();

    expect(meteringPoints).toEqual([{ x: 0.25, y: 0.25 }]);
    expect(reticle.classList.contains("is-visible")).toBe(true);
    expect(reticle.style.left).toBe("25%");
    expect(reticle.style.top).toBe("25%");
    expect(evReadout.textContent).toBe("0.0");

    // A drag across 60% of the 640px preview spans the full -2..+2 range, so
    // 96px up is a quarter of the positive half.
    meterLayer.dispatch("pointermove", { clientY: 64, pointerId: 1 });
    await Promise.resolve();

    expect(reticle.classList.contains("is-adjusting")).toBe(true);
    expect(evReadout.textContent).toBe("+1.0");

    meterLayer.dispatch("pointerup", { pointerId: 1 });
  });

  test("reverts optimistic exposure after a rejected apply and retries the same EV request", async () => {
    const overlayHost = new FakeElement("div");
    overlayHost.setBoundingRect({ height: 640, left: 0, top: 0, width: 360 });

    let applyRequestCount = 0;
    /** @type {(result: boolean) => void} */
    let resolveApply = () => {};
    const cameraController = {
      applyExposureCompensation() {
        applyRequestCount += 1;
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      },
      getCurrentExposureCompensation() {
        return 0;
      },
      getExposureCapabilities() {
        return { min: -2, max: 2, step: 0.1 };
      },
      setMeteringPoint() {
        return Promise.resolve(true);
      },
      supportsMeteringPointSelection() {
        return true;
      },
    };

    const exposureUi = createExposureUiController({
      cameraController,
      overlayHost,
    });
    exposureUi.initialize();
    exposureUi.syncCapabilities();
    exposureUi.bindEvents();

    const meterLayer = findByClass(overlayHost, "camera-meter-layer");
    meterLayer.setBoundingRect({ height: 640, left: 0, top: 0, width: 360 });
    const evReadout = findByClass(overlayHost, "camera-meter-ev");

    meterLayer.dispatch("pointerdown", { clientX: 180, clientY: 320, pointerId: 1 });
    resolveApply(true);
    await Promise.resolve();
    await Promise.resolve();
    applyRequestCount = 0;

    meterLayer.dispatch("pointermove", { clientY: 224, pointerId: 1 });

    expect(evReadout.textContent).toBe("+1.0");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(evReadout.textContent).toBe("0.0");

    meterLayer.dispatch("pointermove", { clientY: 224, pointerId: 1 });

    expect(applyRequestCount).toBe(2);
  });
});
