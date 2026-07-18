import { describe, expect, test } from "bun:test";
import { createPerformanceHudBridge } from "./performance-hud-bridge.js";

describe("performance HUD bridge", () => {
  test("is a synchronous no-op when debug loading is disabled", () => {
    const bridge = createPerformanceHudBridge({ initialEnabled: true });
    expect(() => bridge.recordFrame({ fps: 60 })).not.toThrow();
    expect(() => bridge.setEnabled(false)).not.toThrow();
    expect(() => bridge.destroy()).not.toThrow();
  });

  test("delegates state and metrics after the debug controller loads", async () => {
    const calls = [];
    const bridge = createPerformanceHudBridge({
      initialEnabled: false,
      loadController: async () => ({
        createPerformanceHudController: ({ initialEnabled }) => ({
          destroy: () => calls.push("destroy"),
          recordFrame: (metrics) => calls.push(["frame", metrics]),
          setEnabled: (enabled) => calls.push(["enabled", enabled]),
          initialEnabled,
        }),
      }),
    });

    bridge.setEnabled(true);
    await Promise.resolve();
    await Promise.resolve();
    bridge.recordFrame({ fps: 60 });
    bridge.destroy();

    expect(calls).toEqual([["frame", { fps: 60 }], "destroy"]);
  });
});
