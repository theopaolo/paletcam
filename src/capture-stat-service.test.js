import { afterEach, expect, mock, test } from "bun:test";
import {
  flushCaptureStats,
  resetCaptureStatFlushForTests,
  trackCaptureStatAsync,
} from "./capture-stat-service.js";
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
const originalAddEventListener = globalThis.addEventListener;

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  globalThis.addEventListener = originalAddEventListener;
  resetCaptureStatFlushForTests();
  mock.restore();
});

test("serializes capture-stat flushes without double-counting concurrent captures", async () => {
  const stored = new Map();
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.addEventListener = () => {};

  const pendingRequests = [];
  const requestJson = mock(
    (_url, options) =>
      new Promise((resolve) => {
        pendingRequests.push({ body: JSON.parse(options.body), resolve });
      }),
  );
  resetCaptureStatFlushForTests(requestJson);
  trackCaptureStatAsync();
  trackCaptureStatAsync();
  await Promise.resolve();

  expect(pendingRequests).toHaveLength(1);
  expect(pendingRequests[0].body.count).toBe(1);
  pendingRequests[0].resolve({ payload: null });
  await Promise.resolve();
  await Promise.resolve();

  expect(pendingRequests).toHaveLength(2);
  expect(pendingRequests[1].body.count).toBe(1);
  pendingRequests[1].resolve({ payload: null });
  await flushCaptureStats();

  expect(requestJson).toHaveBeenCalledTimes(2);
  expect(stored.size).toBe(0);
});

test("capture metrics remain non-fatal when localStorage is unavailable", async () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    removeItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.addEventListener = () => {};
  const requestJson = mock(async () => ({ payload: null }));
  resetCaptureStatFlushForTests(requestJson);

  expect(() => trackCaptureStatAsync()).not.toThrow();
  await flushCaptureStats();
  expect(requestJson).not.toHaveBeenCalled();
});
