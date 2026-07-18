import { describe, expect, test } from "bun:test";
import { resolveCommunityApiBaseUrl } from "./community-api-config.js";
import { resolveLogApiBaseUrl } from "./log-api-config.js";
import {
  createBuildNetlifyHeadersFile,
  createNetlifyHeadersFile,
  isConnectOriginAllowed,
  SECURITY_HEADERS,
} from "./security-headers.js";

describe("production security headers", () => {
  test("limits connect-src to the app's two production services", () => {
    const policy = SECURITY_HEADERS["Content-Security-Policy"];

    expect(policy).toContain(
      "connect-src 'self' https://colorcatchers.co https://cclogs.ludique.dev",
    );
    expect(policy).not.toContain("https://ccs.test");
    expect(policy).not.toContain("https://api.color.pizza");
  });

  test("reports only configured production connect origins as allowed", () => {
    expect(isConnectOriginAllowed("https://colorcatchers.co/api/v1")).toBe(true);
    expect(isConnectOriginAllowed("https://cclogs.ludique.dev/health")).toBe(true);
    expect(isConnectOriginAllowed("https://ccs.test")).toBe(false);
    expect(isConnectOriginAllowed("https://api.color.pizza")).toBe(false);
    expect(isConnectOriginAllowed("not-a-url")).toBe(false);
  });

  test("writes the restricted CSP to the generated Netlify headers", () => {
    const headersFile = createNetlifyHeadersFile();

    expect(headersFile).toContain(SECURITY_HEADERS["Content-Security-Policy"]);
    expect(headersFile).not.toContain("https://ccs.test");
    expect(headersFile).not.toContain("https://api.color.pizza");
  });

  test("adds validated custom preprod endpoint origins to generated build headers", () => {
    const deployBranch = "pwa/preprod";
    const communityBaseUrl = resolveCommunityApiBaseUrl(
      "https://preprod-api.example.test/api/v1///",
      deployBranch,
    );
    const logApiBaseUrl = resolveLogApiBaseUrl(
      "https://preprod-logs.example.test/events///",
      deployBranch,
    );
    const headersFile = createBuildNetlifyHeadersFile({
      deployBranchName: deployBranch,
      communityBaseUrl,
      logApiBaseUrl,
    });

    expect(headersFile).toContain("https://preprod-api.example.test");
    expect(headersFile).toContain("https://preprod-logs.example.test");
    expect(headersFile.match(/https:\/\/preprod-api\.example\.test/g)).toHaveLength(1);
    expect(headersFile).not.toContain("https://preprod-api.example.test/api/v1");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toContain(
      "https://preprod-api.example.test",
    );
    expect(createNetlifyHeadersFile()).not.toContain("https://preprod-api.example.test");
  });

  test("deduplicates configured nonproduction endpoints that share an origin", () => {
    const headersFile = createBuildNetlifyHeadersFile({
      deployBranchName: "pwa/preprod",
      communityBaseUrl: "http://127.0.0.1:8787/community",
      logApiBaseUrl: "http://127.0.0.1:8787/logs",
    });

    expect(headersFile.match(/http:\/\/127\.0\.0\.1:8787/g)).toHaveLength(1);
    expect(headersFile).not.toContain("/community");
    expect(headersFile).not.toContain("/logs");
  });

  test("cannot widen production headers through endpoint configuration", () => {
    expect(() => resolveCommunityApiBaseUrl("https://community.example.test", "pwa/prod")).toThrow(
      "authorized production origin",
    );
    expect(() => resolveLogApiBaseUrl("https://logs.example.test", "pwa/prod")).toThrow(
      "authorized production origin",
    );

    const communityBaseUrl = resolveCommunityApiBaseUrl("https://colorcatchers.co", "pwa/prod");
    const logApiBaseUrl = resolveLogApiBaseUrl("https://cclogs.ludique.dev", "pwa/prod");
    const headersFile = createBuildNetlifyHeadersFile({
      deployBranchName: "pwa/prod",
      communityBaseUrl,
      logApiBaseUrl,
    });

    expect(headersFile.match(/https:\/\/colorcatchers\.co/g)).toHaveLength(1);
    expect(headersFile.match(/https:\/\/cclogs\.ludique\.dev/g)).toHaveLength(1);
    expect(headersFile).not.toContain("example.test");
    expect(
      createBuildNetlifyHeadersFile({
        deployBranchName: "pwa/prod",
        communityBaseUrl: "https://community.example.test",
        logApiBaseUrl: "https://logs.example.test",
      }),
    ).not.toContain("example.test");
  });

  test.each([
    "ftp://preprod.example.test",
    "https://user:password@preprod.example.test",
    "https://preprod.example.test?token=secret",
    "not-a-url",
  ])("rejects unsafe direct CSP extension %s", (value) => {
    expect(() => createNetlifyHeadersFile({ additionalConnectUrls: [value] })).toThrow();
  });
});
