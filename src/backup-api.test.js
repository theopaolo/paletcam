import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_RETRY_DELAY_MS,
  fetchBackupManifest,
  getRetryDelayMs,
  MAX_RATE_LIMIT_RETRIES,
  setBackupApiSleepForTests,
} from "./backup-api.js";

const CREDENTIALS = { accountId: "0123456789abcdef", secret: "a".repeat(48) };

function jsonResponse(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setBackupApiSleepForTests(null);
});

describe("backup api rate-limit handling", () => {
  test("retry delay honors an exposed Retry-After and never drops to zero", () => {
    expect(getRetryDelayMs(jsonResponse(429, {}, { "retry-after": "60" }))).toBe(60_000);
    expect(getRetryDelayMs(jsonResponse(429, {}, { "retry-after": "600" }))).toBe(90_000);
    // A CORS-hidden header reads as null; Number(null) is 0 — both must fall
    // back to the default pause instead of an instant retry burst.
    expect(getRetryDelayMs(jsonResponse(429, {}))).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(getRetryDelayMs(jsonResponse(429, {}, { "retry-after": "0" }))).toBe(
      DEFAULT_RETRY_DELAY_MS,
    );
    expect(getRetryDelayMs(jsonResponse(429, {}, { "retry-after": "soon" }))).toBe(
      DEFAULT_RETRY_DELAY_MS,
    );
  });

  test("retries a 429 after a real pause and then succeeds", async () => {
    const responses = [
      jsonResponse(429, { error: "rate_limited" }),
      jsonResponse(200, { ok: true, manifest: { assets: [] } }),
    ];
    const fetchMock = mock(async () => responses.shift());
    globalThis.fetch = fetchMock;
    const sleptDelays = [];
    setBackupApiSleepForTests(async (delayMs) => {
      sleptDelays.push(delayMs);
    });

    const manifest = await fetchBackupManifest(CREDENTIALS);

    expect(manifest.assets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleptDelays).toEqual([DEFAULT_RETRY_DELAY_MS]);
  });

  test("gives up with rate_limited after exhausting retries", async () => {
    const fetchMock = mock(async () => jsonResponse(429, { error: "rate_limited" }));
    globalThis.fetch = fetchMock;
    setBackupApiSleepForTests(async () => {});

    await expect(fetchBackupManifest(CREDENTIALS)).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
  });

  test("does not retry auth failures", async () => {
    const fetchMock = mock(async () => jsonResponse(401, { error: "unauthorized" }));
    globalThis.fetch = fetchMock;

    await expect(fetchBackupManifest(CREDENTIALS)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("maps a failed fetch to the network code", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("connection refused");
    });

    await expect(fetchBackupManifest(CREDENTIALS)).rejects.toMatchObject({ code: "network" });
  });
});
