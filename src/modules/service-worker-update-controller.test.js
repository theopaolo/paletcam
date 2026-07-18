import { describe, expect, mock, test } from "bun:test";
import { createServiceWorkerUpdateController } from "./service-worker-update-controller.js";

function createHarness() {
  let activeCount = 0;
  let listener = () => {};
  const activateWorker = mock(() => {});
  const onDeferred = mock(() => {});
  const onReadyToReload = mock(() => {});
  const unsubscribe = mock(() => {});
  const controller = createServiceWorkerUpdateController({
    isBusy: () => activeCount > 0,
    subscribeBusy: (nextListener) => {
      listener = nextListener;
      return unsubscribe;
    },
    activateWorker,
    onDeferred,
    onReadyToReload,
  });

  return {
    activateWorker,
    controller,
    onDeferred,
    onReadyToReload,
    setActiveCount(nextCount) {
      activeCount = nextCount;
      listener({ activeCount });
    },
    unsubscribe,
  };
}

describe("service-worker update controller", () => {
  test("defers a user-approved activation until critical work becomes idle", () => {
    const harness = createHarness();
    const worker = /** @type {ServiceWorker} */ ({});

    harness.setActiveCount(1);
    expect(harness.controller.requestActivation(worker)).toBe("deferred");
    expect(harness.onDeferred).toHaveBeenCalledTimes(1);
    expect(harness.activateWorker).not.toHaveBeenCalled();

    harness.setActiveCount(0);
    expect(harness.activateWorker).toHaveBeenCalledWith(worker);
    expect(harness.controller.handleControllerChange()).toBe(true);
    expect(harness.onReadyToReload).toHaveBeenCalledTimes(1);
    expect(harness.controller.handleControllerChange()).toBe(false);
  });

  test("defers reload when critical work starts after activation was requested", () => {
    const harness = createHarness();
    const worker = /** @type {ServiceWorker} */ ({});

    expect(harness.controller.requestActivation(worker)).toBe("activating");
    harness.setActiveCount(1);
    expect(harness.controller.handleControllerChange()).toBe(false);
    expect(harness.onReadyToReload).not.toHaveBeenCalled();

    harness.setActiveCount(0);
    expect(harness.onReadyToReload).toHaveBeenCalledTimes(1);
    expect(harness.controller.handleControllerChange()).toBe(false);
  });

  test("activates immediately while idle and releases its subscription on destroy", () => {
    const harness = createHarness();
    const worker = /** @type {ServiceWorker} */ ({});

    expect(harness.controller.requestActivation(worker)).toBe("activating");
    expect(harness.activateWorker).toHaveBeenCalledWith(worker);
    harness.controller.destroy();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.controller.requestActivation(worker)).toBe("unavailable");
  });
});
