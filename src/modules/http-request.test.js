import { describe, expect, mock, test } from "bun:test";
import { requestJson } from "./http-request.js";

describe("requestJson", () => {
  test("adds correlation and JSON headers and parses a bounded response", async () => {
    const fetchImpl = mock(async (_url, init) => {
      expect(init.headers.get("Accept")).toBe("application/json");
      expect(init.headers.get("X-Request-ID")).not.toBe("");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await requestJson("https://example.test/api", { fetchImpl });

    expect(result.payload).toEqual({ ok: true });
    expect(result.requestId).not.toBe("");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("accepts an empty successful response", async () => {
    const result = await requestJson("https://example.test/api", {
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    expect(result.payload).toBeNull();
  });

  test("preserves structured HTTP errors", async () => {
    await expect(
      requestJson("https://example.test/api", {
        fetchImpl: async () =>
          new Response(JSON.stringify({ message: "Not allowed" }), { status: 403 }),
      }),
    ).rejects.toMatchObject({
      name: "HttpRequestError",
      kind: "http",
      status: 403,
      message: "Not allowed",
      payload: { message: "Not allowed" },
    });
  });

  test("rejects malformed successful JSON", async () => {
    await expect(
      requestJson("https://example.test/api", {
        fetchImpl: async () => new Response("{broken", { status: 200 }),
      }),
    ).rejects.toMatchObject({ kind: "invalid_response", status: 200 });
  });

  test("rejects a response that exceeds the configured byte limit", async () => {
    await expect(
      requestJson("https://example.test/api", {
        maxResponseBytes: 4,
        fetchImpl: async () => new Response('"oversized"', { status: 200 }),
      }),
    ).rejects.toMatchObject({ kind: "response_too_large", status: 200 });
  });

  test("classifies timeouts without retrying", async () => {
    const fetchImpl = mock(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        }),
    );

    await expect(
      requestJson("https://example.test/api", { fetchImpl, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("distinguishes caller cancellation from timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    const pending = requestJson("https://example.test/api", {
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 1_000,
    });

    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });
});
