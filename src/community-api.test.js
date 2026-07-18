import { afterEach, describe, expect, mock, test } from "bun:test";

const apiModuleUrl = new URL("./community-api.js", import.meta.url).href;
const configModuleUrl = new URL("./config.js", import.meta.url).href;
const httpRequestModuleUrl = new URL("./modules/http-request.js", import.meta.url).href;
const clientLogModuleUrl = new URL("./modules/client-log.js", import.meta.url).href;

async function loadApi(payloadOrFactory) {
  const requestJson = mock(async (...args) => ({
    payload:
      typeof payloadOrFactory === "function" ? await payloadOrFactory(...args) : payloadOrFactory,
    requestId: "request-1",
    response: {},
  }));
  const clientLog = mock(() => {});
  const clientLogWithOptions = mock(() => true);
  mock.module(configModuleUrl, () => ({ getApiBaseUrl: () => "https://community.test/api/v1" }));
  mock.module(httpRequestModuleUrl, () => ({ requestJson }));
  mock.module(clientLogModuleUrl, () => ({
    clientLog,
    clientLogWithOptions,
    sanitizeTelemetryContext: (context) => context,
  }));
  const api = await import(`${apiModuleUrl}?test=${Math.random()}`);
  return { api, clientLog, requestJson };
}

afterEach(() => {
  mock.restore();
});

describe("community API contract boundary", () => {
  test("returns a structured, secret-free contract error for malformed verification", async () => {
    const { api, clientLog } = await loadApi({
      token: "must-never-be-logged",
      user: "invalid-user-shape",
    });

    let caughtError;
    try {
      await api.verifyCommunityLoginCode({
        email: "catcher@example.com",
        code: "123456",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({
      name: "CommunityApiError",
      message: "Invalid response from community API.",
      status: 502,
      path: "/verify",
      payload: {
        failureKind: "invalid_response",
        issue: "user must be an object or null",
      },
    });
    expect(clientLog).toHaveBeenCalledWith("Community API returned an invalid response.", {
      errorName: "CommunityApiContractError",
    });
    expect(JSON.stringify(clientLog.mock.calls)).not.toContain("must-never-be-logged");
    expect(JSON.stringify(clientLog.mock.calls)).not.toContain("123456");
    expect(JSON.stringify(clientLog.mock.calls)).not.toContain("catcher@example.com");
  });

  test("validates publication before returning it to the service layer", async () => {
    const { api } = await loadApi({ catch: { status: "PUBLIC" } });

    await expect(
      api.postCatchToCommunity({
        token: "secret",
        photoBase64: "secret-photo",
        timestamp: "2026-07-12T10:00:00.000Z",
        colors: [{ r: 1, g: 2, b: 3 }],
      }),
    ).rejects.toMatchObject({
      name: "CommunityApiError",
      status: 502,
      path: "/catch/publish",
      payload: { failureKind: "invalid_response" },
    });
  });

  test("sends a validated idempotency key with publication requests", async () => {
    const operationKey = `paletcam-publish-${"a".repeat(64)}`;
    const { api, requestJson } = await loadApi({
      catch: { id: "catch-1", status: "TO_MODERATE" },
    });

    await expect(
      api.postCatchToCommunity({
        token: "secret",
        operationKey,
        photoBase64: "secret-photo",
        timestamp: "2026-07-12T10:00:00.000Z",
        colors: [{ r: 1, g: 2, b: 3 }],
      }),
    ).resolves.toEqual({
      catch: { id: "catch-1", status: "TO_MODERATE" },
    });

    expect(requestJson.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(operationKey);
  });

  test("rejects malformed publication idempotency keys before transport", async () => {
    const { api, requestJson } = await loadApi({
      catch: { id: "catch-1", status: "TO_MODERATE" },
    });

    await expect(
      api.postCatchToCommunity({
        token: "secret",
        operationKey: "attacker-controlled-key",
        photoBase64: "secret-photo",
        timestamp: "2026-07-12T10:00:00.000Z",
        colors: [{ r: 1, g: 2, b: 3 }],
      }),
    ).rejects.toThrow("Invalid publication idempotency key.");
    expect(requestJson).not.toHaveBeenCalled();
  });

  test("returns normalized status results only after the entire payload validates", async () => {
    const { api, requestJson } = await loadApi({
      catches: [{ id: 17, status: "private" }],
      deletedIds: [18],
    });
    const controller = new AbortController();

    await expect(
      api.fetchCatchModerationStatuses({
        token: "secret",
        remoteCatchIds: ["17", "18"],
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      statuses: [{ remoteCatchId: "17", status: "PRIVATE" }],
      deletedIds: ["18"],
    });
    expect(requestJson.mock.calls[0][1].signal).toBe(controller.signal);
  });

  test("chunks bounded moderation requests sequentially and preserves the abort signal", async () => {
    const controller = new AbortController();
    const remoteCatchIds = Array.from({ length: 1_001 }, (_, index) => `remote-${index}`);
    const { api, requestJson } = await loadApi((_url, requestInit) => {
      const ids = JSON.parse(requestInit.body).ids;
      return {
        catches: ids.map((id) => ({ id, status: "public" })),
        deletedIds: [],
      };
    });

    const result = await api.fetchCatchModerationStatuses({
      token: "secret",
      remoteCatchIds,
      signal: controller.signal,
    });

    expect(result.statuses).toHaveLength(1_001);
    expect(requestJson).toHaveBeenCalledTimes(11);
    expect(
      requestJson.mock.calls.map(([, requestInit]) => JSON.parse(requestInit.body).ids.length),
    ).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1]);
    expect(
      requestJson.mock.calls.every(([, requestInit]) => requestInit.signal === controller.signal),
    ).toBe(true);
  });

  test("rejects oversized moderation requests before transport", async () => {
    const { api, requestJson } = await loadApi({ catches: [], deletedIds: [] });
    const remoteCatchIds = Array.from({ length: 2_001 }, (_, index) => `remote-${index}`);

    await expect(
      api.fetchCatchModerationStatuses({ token: "secret", remoteCatchIds }),
    ).rejects.toThrow(/at most 2000 ids/);
    expect(requestJson).not.toHaveBeenCalled();
  });

  test("rejects ambiguous duplicate moderation responses", async () => {
    const { api } = await loadApi({
      catches: [{ id: "17", status: "public" }],
      deletedIds: [17],
    });

    await expect(
      api.fetchCatchModerationStatuses({ token: "secret", remoteCatchIds: ["17"] }),
    ).rejects.toMatchObject({
      name: "CommunityApiError",
      status: 502,
      path: "/catches/statuses",
      payload: { failureKind: "invalid_response" },
    });
  });
});
