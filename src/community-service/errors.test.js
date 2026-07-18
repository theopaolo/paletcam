import { afterEach, expect, mock, test } from "bun:test";

const errorsModuleUrl = new URL("./errors.js", import.meta.url).href;
const sessionModuleUrl = new URL("../community-session.js", import.meta.url).href;

afterEach(() => {
  mock.restore();
});

test("maps lifecycle cancellation without treating it as an API failure", async () => {
  const clearCommunitySession = mock(() => {});
  mock.module(sessionModuleUrl, () => ({
    clearCommunitySession,
    getCommunityAccessToken: () => "token",
  }));
  const { mapApiError } = await import(`${errorsModuleUrl}?test=${Math.random()}`);
  const apiError = Object.assign(new Error("Network error while calling community API."), {
    name: "CommunityApiError",
    status: 0,
    payload: { failureKind: "aborted" },
  });

  expect(mapApiError(apiError)).toMatchObject({
    name: "CommunityServiceError",
    code: "REQUEST_CANCELLED",
    status: 0,
  });
  expect(clearCommunitySession).not.toHaveBeenCalled();
});

test("still clears an expired authenticated session", async () => {
  const clearCommunitySession = mock(() => {});
  mock.module(sessionModuleUrl, () => ({
    clearCommunitySession,
    getCommunityAccessToken: () => "token",
  }));
  const { mapApiError } = await import(`${errorsModuleUrl}?test=${Math.random()}`);
  const apiError = Object.assign(new Error("Unauthorized"), {
    name: "CommunityApiError",
    status: 401,
    payload: null,
  });

  expect(mapApiError(apiError, { expectedToken: "token" })).toMatchObject({
    code: "AUTH_EXPIRED",
    status: 401,
  });
  expect(clearCommunitySession).toHaveBeenCalledTimes(1);
});

test("does not clear a newer session for a stale request's 401", async () => {
  const clearCommunitySession = mock(() => {});
  mock.module(sessionModuleUrl, () => ({
    clearCommunitySession,
    getCommunityAccessToken: () => "new-token",
  }));
  const { mapApiError } = await import(`${errorsModuleUrl}?test=${Math.random()}`);
  const apiError = Object.assign(new Error("Unauthorized"), {
    name: "CommunityApiError",
    status: 401,
    payload: null,
  });

  expect(mapApiError(apiError, { expectedToken: "old-token" })).toMatchObject({
    code: "AUTH_EXPIRED",
    status: 401,
  });
  expect(clearCommunitySession).not.toHaveBeenCalled();
});
