import { describe, expect, test } from "bun:test";
import { resolveLogApiBaseUrl } from "./log-api-config.js";

describe("production log API build configuration", () => {
  test("requires an explicit endpoint only for production artifacts", () => {
    expect(() => resolveLogApiBaseUrl("", "pwa/prod")).toThrow(
      "PALETCAM_LOG_API_BASE_URL: is required",
    );
    expect(resolveLogApiBaseUrl("", "pwa/preprod")).toBe("");
    expect(resolveLogApiBaseUrl(undefined, "feature/local-dev")).toBe("");
  });

  test("normalizes the authorized production telemetry endpoint", () => {
    expect(resolveLogApiBaseUrl(" https://cclogs.ludique.dev/ ", "pwa/prod")).toBe(
      "https://cclogs.ludique.dev",
    );
  });

  test.each([
    ["not-a-url", "absolute URL"],
    ["http://cclogs.ludique.dev", "must use HTTPS"],
    ["https://user:password@cclogs.ludique.dev", "embedded credentials"],
    ["https://cclogs.ludique.dev?token=secret", "query string or fragment"],
    ["https://cclogs.ludique.dev/#private", "query string or fragment"],
    ["https://cclogs.ludique.dev/v1/", "origin root path"],
    ["https://logs.example.com", "authorized production origin"],
    ["ftp://cclogs.ludique.dev", "HTTP or HTTPS"],
  ])("rejects unsafe production value %s", (value, expectedMessage) => {
    expect(() => resolveLogApiBaseUrl(value, "pwa/prod")).toThrow(expectedMessage);
  });

  test("allows normalized local and custom absolute targets outside production", () => {
    expect(resolveLogApiBaseUrl("http://127.0.0.1:3030/", "pwa/preprod")).toBe(
      "http://127.0.0.1:3030",
    );
    expect(resolveLogApiBaseUrl("https://logs.example.test/v1///", "feature/test")).toBe(
      "https://logs.example.test/v1",
    );
  });

  test.each([
    "https://user:password@logs.example.test",
    "https://logs.example.test?token=secret",
    "https://logs.example.test/#private",
    "file:///tmp/logs",
  ])("rejects unsafe nonproduction value %s", (value) => {
    expect(() => resolveLogApiBaseUrl(value, "pwa/preprod")).toThrow();
  });
});
