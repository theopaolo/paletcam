import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CAMERA_RESUME_DELAY_MS,
  IOS_CAMERA_LIFECYCLE_RESUME_DELAY_MS,
  getCameraResumeDelay,
} from "./camera-resume-policy.js";

describe("getCameraResumeDelay", () => {
  test("keeps the requested delay on non-iOS devices", () => {
    expect(
      getCameraResumeDelay({
        isIOS: false,
        reason: "visibilitychange",
      }),
    ).toBe(DEFAULT_CAMERA_RESUME_DELAY_MS);
  });

  test("extends iOS lifecycle resumes to clear the app switch animation", () => {
    expect(
      getCameraResumeDelay({
        isIOS: true,
        reason: "visibilitychange",
      }),
    ).toBe(IOS_CAMERA_LIFECYCLE_RESUME_DELAY_MS);

    expect(
      getCameraResumeDelay({
        isIOS: true,
        reason: "track-mute",
        requestedDelayMs: 0,
      }),
    ).toBe(IOS_CAMERA_LIFECYCLE_RESUME_DELAY_MS);
  });

  test("does not shorten a caller-provided delay", () => {
    expect(
      getCameraResumeDelay({
        isIOS: true,
        reason: "pageshow",
        requestedDelayMs: 1400,
      }),
    ).toBe(1400);
  });

  test("leaves unrelated iOS resume reasons unchanged", () => {
    expect(
      getCameraResumeDelay({
        isIOS: true,
        reason: "manual-retry",
        requestedDelayMs: 60,
      }),
    ).toBe(60);
  });
});
