import { describe, expect, test } from "bun:test";
import { bindSignedInIndicator } from "./signed-in-indicator.js";

function createHarness(initialToken = "") {
  let token = initialToken;
  const listeners = new Set();
  const classes = new Set();
  const element = {
    classList: {
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
  return {
    element,
    options: {
      getToken: () => token,
      subscribeSession: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setToken(next) {
      token = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    listeners,
  };
}

describe("bindSignedInIndicator", () => {
  test("is lit from the start when a session already exists", () => {
    const harness = createHarness("token");
    bindSignedInIndicator(harness.element, harness.options);

    expect(harness.element.classList.contains("is-signed-in")).toBe(true);
  });

  test("follows sign-in and sign-out", () => {
    const harness = createHarness();
    bindSignedInIndicator(harness.element, harness.options);
    expect(harness.element.classList.contains("is-signed-in")).toBe(false);

    harness.setToken("token");
    expect(harness.element.classList.contains("is-signed-in")).toBe(true);

    harness.setToken("");
    expect(harness.element.classList.contains("is-signed-in")).toBe(false);
  });

  test("stops following once released", () => {
    const harness = createHarness();
    const release = bindSignedInIndicator(harness.element, harness.options);

    release();

    expect(harness.listeners.size).toBe(0);
  });

  test("tolerates a missing element", () => {
    expect(() => bindSignedInIndicator(null)()).not.toThrow();
  });
});
