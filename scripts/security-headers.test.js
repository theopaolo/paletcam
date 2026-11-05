import { describe, expect, test } from "bun:test";
import { resolveCommunityApiBaseUrl } from "./community-api-config.js";
import { resolveLogApiBaseUrl } from "./log-api-config.js";
import {
  createBuildNetlifyHeadersFile,
  createNetlifyHeadersFile,
  isConnectOriginAllowed,
  SECURITY_HEADERS,
  withSecurityHeaders,
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

  test("lets the CSP load catch images only from the community origin", () => {
    const policy = SECURITY_HEADERS["Content-Security-Policy"];

    expect(policy).toContain("img-src 'self' data: blob: https://colorcatchers.co;");
    expect(policy).not.toContain("https://cclogs.ludique.dev;");
  });

  test("adds the preprod community origin to img-src but not the log origin", () => {
    const headersFile = createBuildNetlifyHeadersFile({
      deployBranchName: "pwa/preprod",
      communityBaseUrl: "https://preprod-api.example.test",
      logApiBaseUrl: "https://preprod-logs.example.test",
    });
    const imgSrc = headersFile.match(/img-src ([^;]+);/)?.[1] ?? "";

    expect(imgSrc).toContain("https://preprod-api.example.test");
    expect(imgSrc).not.toContain("preprod-logs.example.test");
  });

  test("lets a dev server extend connect-src and img-src for a local community API", () => {
    const policy = withSecurityHeaders(
      {},
      {
        additionalConnectUrls: ["https://ccs.test", ""],
        additionalImageUrls: ["https://ccs.test"],
      },
    ).get("Content-Security-Policy");

    expect(policy).toContain("connect-src 'self' https://colorcatchers.co");
    expect(policy).toMatch(/connect-src [^;]*https:\/\/ccs\.test/);
    expect(policy).toMatch(/img-src [^;]*https:\/\/ccs\.test/);
    expect(withSecurityHeaders().get("Content-Security-Policy")).toBe(
      SECURITY_HEADERS["Content-Security-Policy"],
    );
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toContain("ccs.test");
  });

  test("rejects an unsafe dev extension", () => {
    expect(() => withSecurityHeaders({}, { additionalConnectUrls: ["ftp://x.test"] })).toThrow();
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
    // Once in connect-src, once in img-src.
    expect(headersFile.match(/https:\/\/preprod-api\.example\.test/g)).toHaveLength(2);
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

    // The shared origin appears once per directive (connect-src, img-src), never twice in one.
    expect(headersFile.match(/http:\/\/127\.0\.0\.1:8787/g)).toHaveLength(2);
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

    expect(headersFile.match(/https:\/\/colorcatchers\.co/g)).toHaveLength(2);
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
