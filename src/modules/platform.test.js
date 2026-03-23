import { describe, expect, test } from "bun:test";

import { isIOSDevice } from "./platform.js";

describe("isIOSDevice", () => {
  test("detects iPhone user agents", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
      }),
    ).toBe(true);
  });

  test("detects iPadOS desktop safari via touch-enabled Macintosh user agents", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  test("does not misclassify Android touch devices as iOS", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });

  test("does not flag desktop macOS without touch", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
