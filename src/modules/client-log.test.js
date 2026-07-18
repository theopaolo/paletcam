import { afterEach, describe, expect, mock, test } from "bun:test";

const configModuleUrl = new URL("../config.js", import.meta.url).href;
const clientLogModuleUrl = new URL("./client-log.js", import.meta.url).href;

const originalFetch = globalThis.fetch;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
const originalAbortSignalTimeout = AbortSignal.timeout;

function setGlobalProperty(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  mock.restore();
  AbortSignal.timeout = originalAbortSignalTimeout;

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

  if (originalSessionStorageDescriptor) {
    Object.defineProperty(globalThis, "sessionStorage", originalSessionStorageDescriptor);
  } else {
    delete globalThis.sessionStorage;
  }
});

describe("clientLogWithOptions", () => {
  test("is a no-op when no telemetry endpoint is configured", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => ""),
    }));

    const fetchMock = mock(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;
    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);

    expect(module.clientLogWithOptions("not-sent")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
      module.clientLogWithOptions(
        "Failed to render palette gallery preview.",
        { paletteId: 1, variant: "gallery" },
        {
          key: "preview-gallery-failure",
          throttleMs: 1000,
        },
      ),
    ).toBe(true);
    expect(
      module.clientLogWithOptions(
        "Failed to render palette gallery preview.",
        { paletteId: 2, variant: "gallery" },
        {
          key: "preview-gallery-failure",
          throttleMs: 1000,
        },
      ),
    ).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context).toEqual(
      expect.objectContaining({
        commitHash: "",
        appVersion: "",
        clientFamily: "other",
        variant: "gallery",
      }),
    );
    expect(body.context).not.toHaveProperty("paletteId");
    expect(body.context).not.toHaveProperty("url");
    expect(body.context).not.toHaveProperty("userAgent");
    expect(body.context.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("serializes delivery and accounts for events dropped at the bounded queue limit", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    let releaseFirstDelivery;
    const firstDelivery = new Promise((resolve) => {
      releaseFirstDelivery = resolve;
    });
    let fetchCallCount = 0;
    const fetchMock = mock(() => {
      fetchCallCount += 1;
      return fetchCallCount === 1 ? firstDelivery : Promise.resolve({ ok: true });
    });
    globalThis.fetch = fetchMock;

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    module.resetClientLogDeliveryStateForTests();
    const results = Array.from({ length: module.MAX_CLIENT_LOG_DELIVERIES + 5 }, () =>
      module.clientLog("metric:session-started"),
    );

    expect(results.filter(Boolean)).toHaveLength(module.MAX_CLIENT_LOG_DELIVERIES);
    expect(results.filter((result) => !result)).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(module.getClientLogDeliveryStats()).toEqual({
      attemptedCount: 1,
      droppedCount: 5,
      failedCount: 0,
      inFlight: true,
      pendingCount: module.MAX_CLIENT_LOG_DELIVERIES - 1,
    });

    releaseFirstDelivery({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(module.MAX_CLIENT_LOG_DELIVERIES);
    expect(module.getClientLogDeliveryStats()).toEqual({
      attemptedCount: module.MAX_CLIENT_LOG_DELIVERIES,
      droppedCount: 5,
      failedCount: 0,
      inFlight: false,
      pendingCount: 0,
    });
  });

  test("continues serialized delivery after rejected and non-successful requests", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    const fetchMock = mock()
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementationOnce(() => Promise.resolve({ ok: false }))
      .mockImplementation(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    module.resetClientLogDeliveryStateForTests();
    expect(module.clientLog("metric:session-started")).toBe(true);
    expect(module.clientLog("metric:session-started")).toBe(true);
    expect(module.clientLog("metric:session-started")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(module.getClientLogDeliveryStats()).toEqual({
      attemptedCount: 3,
      droppedCount: 0,
      failedCount: 2,
      inFlight: false,
      pendingCount: 0,
    });
  });

  test("aborts a hung delivery at the bounded deadline and releases the queue", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    AbortSignal.timeout = mock(() => {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort(new DOMException("Timed out", "TimeoutError")));
      return controller.signal;
    });
    const fetchMock = mock()
      .mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      )
      .mockImplementationOnce(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    module.resetClientLogDeliveryStateForTests();
    expect(module.clientLog("metric:session-started")).toBe(true);
    expect(module.clientLog("metric:session-started")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(AbortSignal.timeout).toHaveBeenCalledWith(module.CLIENT_LOG_DELIVERY_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(module.getClientLogDeliveryStats()).toEqual({
      attemptedCount: 2,
      droppedCount: 0,
      failedCount: 1,
      inFlight: false,
      pendingCount: 0,
    });
  });

  test("drops unknown events and non-allowlisted hostile context", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    const fetchMock = mock(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;
    setGlobalProperty("navigator", { userAgent: "TestAgent/1.0" });
    setGlobalProperty("location", {
      href: "https://app.test/collection?access_token=location-secret#private",
    });

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    expect(
      module.clientLogWithOptions("user@example.test arbitrary message", {
        authorization: "Bearer private",
      }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    module.clientLogWithOptions("Community API request failed.", {
      authorization: "Bearer private",
      errorName: "Error",
      failureKind: "http",
      filename: "private-camera-backup.json",
      method: "POST",
      parserMessage: "user@example.test Bearer opaque-secret",
      remoteCatchId: "private-remote-id",
      status: 503,
      url: "https://api.test/items?signature=private#trace",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toBe("Community API request failed.");
    expect(body.context).toEqual(
      expect.objectContaining({
        clientFamily: "other",
        errorName: "Error",
        failureKind: "http",
        method: "POST",
        status: 503,
      }),
    );
    expect(JSON.stringify(body)).not.toContain("location-secret");
    expect(JSON.stringify(body)).not.toContain("Bearer private");
    expect(JSON.stringify(body)).not.toContain("opaque-secret");
    expect(JSON.stringify(body)).not.toContain("user@example.test");
    expect(JSON.stringify(body)).not.toContain("private-remote-id");
    expect(JSON.stringify(body)).not.toContain("private-camera-backup.json");
    expect(body.context).not.toHaveProperty("url");
  });

  test("replaces a malformed stored correlation identifier with a strict UUIDv4", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));

    let storedValue = "private-session-id";
    setGlobalProperty("sessionStorage", {
      getItem: () => storedValue,
      setItem: (_key, value) => {
        storedValue = value;
      },
    });
    const fetchMock = mock(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    const replacement = module.getSessionCorrelationId({
      getItem: () => storedValue,
      setItem: (_key, value) => {
        storedValue = value;
      },
    });
    expect(replacement).toBe(storedValue);
    expect(replacement).not.toBe("private-session-id");
    expect(module.clientLog("metric:session-started")).toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(body)).not.toContain("private-session-id");
  });

  test("falls back safely when sessionStorage access is blocked", async () => {
    mock.module(configModuleUrl, () => ({
      getLogApiBaseUrl: mock(() => "https://example.test/api"),
    }));
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    const module = await import(`${clientLogModuleUrl}?test=${Math.random()}`);
    expect(module.getSessionCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
