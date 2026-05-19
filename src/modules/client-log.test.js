import { afterEach, describe, expect, mock, test } from "bun:test";

const configModuleUrl = new URL("../config.js", import.meta.url).href;
const clientLogModuleUrl = new URL("./client-log.js", import.meta.url).href;

const originalFetch = globalThis.fetch;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");

function setGlobalProperty(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  mock.restore();

  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }

  if (originalLocationDescriptor) {
    Object.defineProperty(globalThis, "location", originalLocationDescriptor);
  } else {
    delete globalThis.location;
  }
});

describe("clientLogWithOptions", () => {
  test("throttles repeated logs with the same key", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    const fetchMock = mock(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;
    setGlobalProperty("navigator", { userAgent: "TestAgent/1.0" });
    setGlobalProperty("location", { href: "https://app.test/collection" });

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    module.resetClientLogThrottleForTests();

    expect(
      module.clientLogWithOptions("preview-failed", { paletteId: 1 }, {
        key: "preview-gallery-failure",
        throttleMs: 1000,
      }),
    ).toBe(true);
    expect(
      module.clientLogWithOptions("preview-failed", { paletteId: 2 }, {
        key: "preview-gallery-failure",
        throttleMs: 1000,
      }),
    ).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
