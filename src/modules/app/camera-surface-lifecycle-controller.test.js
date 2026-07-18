import { describe, expect, mock, test } from "bun:test";
import { createCameraSurfaceLifecycleController } from "./camera-surface-lifecycle-controller.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness({ isCameraActive = true } = {}) {
  const suspendCamera = mock(() => {});
  const releaseCamera = mock(async () => true);
  const onError = mock(() => {});
  const controller = createCameraSurfaceLifecycleController({
    isCameraActive: () => isCameraActive,
    suspendCamera,
    releaseCamera,
    onError,
  });

  return { controller, onError, releaseCamera, suspendCamera };
}

describe("camera surface lifecycle controller", () => {
  test("suspends an active camera and resumes after the last surface closes", async () => {
    const harness = createHarness();

    expect(harness.controller.open("collection")).toBe(true);
    expect(harness.suspendCamera).toHaveBeenCalledWith({ shouldResume: true });

    harness.controller.open("catch-details");
    harness.controller.close("catch-details");
    await flushMicrotasks();
    expect(harness.releaseCamera).not.toHaveBeenCalled();

    harness.controller.close("collection");
    await flushMicrotasks();
    expect(harness.releaseCamera).toHaveBeenCalledWith({ shouldResume: true });
  });

  test("releases suspension without starting a camera that was inactive", async () => {
    const harness = createHarness({ isCameraActive: false });

    harness.controller.open("collection");
    expect(harness.suspendCamera).toHaveBeenCalledWith({ shouldResume: false });
    harness.controller.close("collection");
    await flushMicrotasks();

    expect(harness.releaseCamera).toHaveBeenCalledWith({ shouldResume: false });
  });

  test("cancels a queued resume when another surface opens", async () => {
    const harness = createHarness();

    harness.controller.open("collection");
    harness.controller.close("collection");
    harness.controller.open("catch-details");
    await flushMicrotasks();
    expect(harness.releaseCamera).not.toHaveBeenCalled();

    harness.controller.close("catch-details");
    await flushMicrotasks();
    expect(harness.releaseCamera).toHaveBeenCalledWith({ shouldResume: true });
  });

  test("destroy prevents a pending resume", async () => {
    const harness = createHarness();

    harness.controller.open("collection");
    harness.controller.close("collection");
    harness.controller.destroy();
    await flushMicrotasks();

    expect(harness.releaseCamera).not.toHaveBeenCalled();
  });

  test("contains suspend and resume failures", async () => {
    const harness = createHarness();
    const suspendError = new Error("stop failed");
    const resumeError = new Error("start failed");
    harness.suspendCamera.mockImplementationOnce(() => {
      throw suspendError;
    });
    harness.releaseCamera.mockRejectedValueOnce(resumeError);

    harness.controller.open("collection");
    harness.controller.close("collection");
    await flushMicrotasks();

    expect(harness.onError).toHaveBeenCalledWith(suspendError, "suspend");
    expect(harness.onError).toHaveBeenCalledWith(resumeError, "resume");
  });
});
