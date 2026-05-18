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

  test("reverts optimistic exposure after a rejected apply and retries the same EV request", async () => {
    const previewFrame = new FakeElement("div");
    previewFrame.setBoundingRect({ height: 640, width: 360 });
    const overlayHost = new FakeElement("div");
    overlayHost.setBoundingRect({ height: 640, width: 360 });
    previewFrame.appendChild(overlayHost);

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
    };

    const exposureUi = createExposureUiController({
      cameraController,
      overlayHost,
    });
    exposureUi.initialize();
    exposureUi.syncCapabilities();
    exposureUi.bindEvents();

    const exposureLayer = findByClass(overlayHost, "camera-exposure-layer");
    const rail = findByClass(overlayHost, "camera-ev-rail");
    const valueBadge = findByClass(overlayHost, "camera-ev-value");
    const passiveIndicator = findByClass(overlayHost, "camera-ev-indicator");
    const resetButton = findByClass(overlayHost, "camera-ev-reset");

    rail.setBoundingRect({ height: 146, top: 100 });

    expect(passiveIndicator.hidden).toBe(false);
    expect(resetButton.hidden).toBe(false);
    expect(resetButton.disabled).toBe(true);
    expect(resetButton.classList.contains("is-zero")).toBe(true);

    exposureUi.handleExposureChange(0.8);
    expect(passiveIndicator.textContent).toBe("EV +0.8");
    expect(resetButton.disabled).toBe(false);
    expect(resetButton.classList.contains("is-active")).toBe(true);

    exposureUi.handleExposureChange(0);
    expect(passiveIndicator.textContent).toBe("EV 0.0");
    expect(resetButton.hidden).toBe(false);
    expect(resetButton.disabled).toBe(true);
    expect(resetButton.classList.contains("is-zero")).toBe(true);

    passiveIndicator.dispatch("pointerdown", {
      button: 0,
      pointerId: 1,
    });
    expect(exposureLayer.classList.contains("is-visible")).toBe(true);

    rail.dispatch("pointerdown", {
      button: 0,
      clientY: 133,
      pointerId: 2,
    });

    expect(valueBadge.textContent).toBe("+1.1");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(valueBadge.textContent).toBe("0.0");
    expect(passiveIndicator.textContent).toBe("EV 0.0");

    rail.dispatch("pointerdown", {
      button: 0,
      clientY: 133,
      pointerId: 3,
    });

    expect(applyRequestCount).toBe(2);
  });
});
