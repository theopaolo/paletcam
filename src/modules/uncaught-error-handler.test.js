import { afterEach, describe, expect, mock, test } from "bun:test";

const clientLogModuleUrl = new URL("./client-log.js", import.meta.url).href;
const handlerModuleUrl = new URL("./uncaught-error-handler.js", import.meta.url).href;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  mock.restore();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete globalThis.window;
  }
});

describe("bindUncaughtErrorHandlers", () => {
  test("binds once, reports events, and can be destroyed and rebound", async () => {
    const clientLog = mock(() => true);
    mock.module(clientLogModuleUrl, () => ({ clientLog }));
    const targetWindow = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: targetWindow,
    });

    const module = await import(`${handlerModuleUrl}?test=${Math.random()}`);
    const firstCleanup = module.bindUncaughtErrorHandlers();
    expect(module.bindUncaughtErrorHandlers()).toBe(firstCleanup);

    const errorEvent = new Event("error");
    Object.assign(errorEvent, {
      error: new Error("failure"),
      message: "failure",
      filename: "https://app.test/app.js?token=private",
      lineno: 7,
      colno: 9,
    });
    targetWindow.dispatchEvent(errorEvent);
    expect(clientLog).toHaveBeenCalledTimes(1);
    expect(clientLog.mock.calls[0][0]).toBe("uncaught:error");
    expect(clientLog.mock.calls[0][1]).toEqual({ name: "Error", lineno: 7, colno: 9 });
    expect(JSON.stringify(clientLog.mock.calls[0][1])).not.toContain("failure");
    expect(JSON.stringify(clientLog.mock.calls[0][1])).not.toContain("token=private");

    firstCleanup();
    targetWindow.dispatchEvent(errorEvent);
    expect(clientLog).toHaveBeenCalledTimes(1);

    const secondCleanup = module.bindUncaughtErrorHandlers();
    expect(secondCleanup).not.toBe(firstCleanup);
    targetWindow.dispatchEvent(errorEvent);
    expect(clientLog).toHaveBeenCalledTimes(2);
    secondCleanup();
  });
});
