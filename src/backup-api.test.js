import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchBackupManifest, MAX_RATE_LIMIT_RETRIES } from "./backup-api.js";

const CREDENTIALS = { accountId: "0123456789abcdef", secret: "a".repeat(48) };

function jsonResponse(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("backup api rate-limit handling", () => {
  test("retries a 429 after the advertised delay and then succeeds", async () => {
    const responses = [
      jsonResponse(429, { error: "rate_limited" }, { "retry-after": "0" }),
      jsonResponse(200, { ok: true, manifest: { assets: [] } }),
    ];
    const fetchMock = mock(async () => responses.shift());
    globalThis.fetch = fetchMock;

    const manifest = await fetchBackupManifest(CREDENTIALS);

    expect(manifest.assets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("gives up with rate_limited after exhausting retries", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(429, { error: "rate_limited" }, { "retry-after": "0" }),
    );
    globalThis.fetch = fetchMock;

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
