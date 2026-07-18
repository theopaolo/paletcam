import { describe, expect, test } from "bun:test";

import { createLivePreviewTiming } from "./live-preview-timing.js";

describe("live preview timing", () => {
  test("schedules only one frame and clears pending state before the callback", () => {
    const callbacks = [];
    const frameTimestamps = [];
    const timing = createLivePreviewTiming({
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      onFrame: (timestamp) => {
        frameTimestamps.push(timestamp);
        timing.schedule(true);
      },
    });

    timing.schedule(false);
    timing.schedule(true);
    timing.schedule(true);
    expect(callbacks).toHaveLength(1);

    callbacks[0](42);
    expect(frameTimestamps).toEqual([42]);
    expect(callbacks).toHaveLength(2);
  });

  test("cancels a pending frame once and permits a replacement", () => {
    const cancelled = [];
    let nextRequestId = 10;
    const timing = createLivePreviewTiming({
      requestFrame: () => nextRequestId++,
      cancelFrame: (requestId) => cancelled.push(requestId),
    });

    timing.schedule(true);
    timing.cancel();
    timing.cancel();
    timing.schedule(true);

    expect(cancelled).toEqual([10]);
  });

  test("preserves extraction and camera-settings cadence including reset", () => {
    const timing = createLivePreviewTiming();

    expect(timing.shouldExtract(10, false)).toBe(true);
    timing.markExtracted(10);
    expect(timing.shouldExtract(209, true)).toBe(false);
    expect(timing.shouldExtract(210, true)).toBe(true);

    expect(timing.shouldRefreshCameraSettings(10, false)).toBe(true);
    timing.markCameraSettingsRefreshed(10);
    expect(timing.shouldRefreshCameraSettings(1009, true)).toBe(false);
    expect(timing.shouldRefreshCameraSettings(1010, true)).toBe(true);

    timing.resetCadence();
    expect(timing.shouldExtract(1, true)).toBe(false);
    expect(timing.shouldRefreshCameraSettings(1, true)).toBe(false);
  });

  test("uses the injected monotonic clock", () => {
    const timing = createLivePreviewTiming({ now: () => 123.5 });
    expect(timing.now()).toBe(123.5);
  });
});
