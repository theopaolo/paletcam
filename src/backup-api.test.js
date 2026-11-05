import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_RETRY_DELAY_MS,
  deleteBackupAccount,
  fetchBackupManifest,
  fetchBackupPalette,
  getRetryDelayMs,
  MAX_RATE_LIMIT_RETRIES,
  pairBackupAccount,
  putBackupPalette,
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

describe("backup api account deletion", () => {
  test("sends an authenticated DELETE to /v1/account", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { ok: true }));
    globalThis.fetch = fetchMock;

    await deleteBackupAccount(CREDENTIALS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.endsWith("/v1/account")).toBe(true);
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe(
      `Bearer ${CREDENTIALS.accountId}.${CREDENTIALS.secret}`,
    );
  });
});

describe("backup api sync contract", () => {
  const HASH = "d".repeat(64);

  test("a palette write names the server version it expects", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { ok: true, hash: HASH }));
    globalThis.fetch = fetchMock;

    await expect(
      putBackupPalette(CREDENTIALS, "uid-one", { palette: {} }, { baseHash: HASH }),
    ).resolves.toBe(HASH);
    await putBackupPalette(CREDENTIALS, "uid-one", { palette: {} });

    expect(fetchMock.mock.calls[0][1].headers["If-Match"]).toBe(`"${HASH}"`);
    expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBe("*");
    expect(fetchMock.mock.calls[1][1].headers["If-Match"]).toBeUndefined();
  });

  test("a conflict carries the server's answer", async () => {
    const body = { ok: false, error: "conflict", current: null, tombstoned: true };
    globalThis.fetch = mock(async () => jsonResponse(409, body));

    await expect(
      putBackupPalette(CREDENTIALS, "uid-one", { palette: {} }, { baseHash: HASH }),
    ).rejects.toMatchObject({ code: "conflict", status: 409, body });
  });

  test("a palette download reports its version from the ETag", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { palette: { timestamp: "t" } }, { etag: `"${HASH.toUpperCase()}"` }),
    );

    await expect(fetchBackupPalette(CREDENTIALS, "uid-one")).resolves.toEqual({
      envelope: { palette: { timestamp: "t" } },
      hash: HASH,
    });
  });

  test("pairing sends no credentials and does not wait out a 429", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(201, { ok: true, accountId: "0123456789abcdef", secret: "e".repeat(48) }),
    );
    globalThis.fetch = fetchMock;

    await expect(pairBackupAccount()).resolves.toEqual({
      accountId: "0123456789abcdef",
      secret: "e".repeat(48),
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    const sleptDelays = [];
    setBackupApiSleepForTests(async (delayMs) => sleptDelays.push(delayMs));
    globalThis.fetch = mock(async () => jsonResponse(429, { error: "rate_limited" }));
    await expect(pairBackupAccount()).rejects.toMatchObject({ code: "rate_limited" });
    expect(sleptDelays).toEqual([]);

    globalThis.fetch = mock(async () => jsonResponse(403, { error: "pairing_disabled" }));
    await expect(pairBackupAccount()).rejects.toMatchObject({ code: "pairing_disabled" });
  });
});
