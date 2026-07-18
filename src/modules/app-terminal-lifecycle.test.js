import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  isAppLifetimeTerminated,
  registerAppTermination,
  resetAppTerminalLifecycleForTests,
  terminateAppLifetime,
} from "./app-terminal-lifecycle.js";

afterEach(() => {
  resetAppTerminalLifecycleForTests();
});

describe("app terminal lifecycle", () => {
  test("terminates every current owner exactly once", () => {
    const first = mock(() => {});
    const second = mock(() => {});
    registerAppTermination(first);
    registerAppTermination(second);

    expect(terminateAppLifetime()).toBe(true);
    expect(terminateAppLifetime()).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(isAppLifetimeTerminated()).toBe(true);
  });

  test("supports idempotent unregistration", () => {
    const callback = mock(() => {});
    const unregister = registerAppTermination(callback);

    expect(unregister()).toBe(true);
    expect(unregister()).toBe(false);
    terminateAppLifetime();
    expect(callback).not.toHaveBeenCalled();
  });

  test("immediately closes a lazy owner registered after termination", () => {
    terminateAppLifetime();
    const callback = mock(() => {});

    const unregister = registerAppTermination(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(unregister()).toBe(false);
  });

  test("one failing callback cannot retain another owner", () => {
    const originalConsoleError = console.error;
    console.error = mock(() => {});
    const survivor = mock(() => {});
    registerAppTermination(() => {
      throw new Error("injected teardown failure");
    });
    registerAppTermination(survivor);

    try {
      expect(terminateAppLifetime()).toBe(true);
      expect(survivor).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
