import { describe, expect, test } from "bun:test";
import { resolveCommunityApiBaseUrl } from "./community-api-config.js";

describe("community API build configuration", () => {
  test("uses the authorized community origin by default for production", () => {
    expect(resolveCommunityApiBaseUrl("", "pwa/prod")).toBe("https://colorcatchers.co");
  });

  test("normalizes the authorized production community endpoint", () => {
    expect(resolveCommunityApiBaseUrl(" https://colorcatchers.co/ ", "pwa/prod")).toBe(
      "https://colorcatchers.co",
    );
  });

  test.each([
    ["not-a-url", "absolute URL"],
    ["http://colorcatchers.co", "must use HTTPS"],
    ["https://user:password@colorcatchers.co", "embedded credentials"],
    ["https://colorcatchers.co?token=secret", "query string or fragment"],
    ["https://colorcatchers.co/#private", "query string or fragment"],
    ["https://colorcatchers.co/api/v1", "origin root path"],
    ["https://api.colorcatchers.co", "authorized production origin"],
    ["ftp://colorcatchers.co", "HTTP or HTTPS"],
  ])("rejects unsafe production value %s", (value, expectedMessage) => {
    expect(() => resolveCommunityApiBaseUrl(value, "pwa/prod")).toThrow(expectedMessage);
  });

  test("allows normalized local and custom absolute targets outside production", () => {
    expect(resolveCommunityApiBaseUrl("", "pwa/preprod")).toBe("");
    expect(resolveCommunityApiBaseUrl("http://127.0.0.1:8787/", "pwa/preprod")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(
      resolveCommunityApiBaseUrl("https://community.example.test/api///", "feature/test"),
    ).toBe("https://community.example.test/api");
  });

  test.each([
    "https://user:password@community.example.test",
    "https://community.example.test?token=secret",
    "https://community.example.test/#private",
    "file:///tmp/community",
  ])("rejects unsafe nonproduction value %s", (value) => {
    expect(() => resolveCommunityApiBaseUrl(value, "pwa/preprod")).toThrow();
  });
});
