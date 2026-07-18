import { describe, expect, test } from "bun:test";
import {
  PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS,
  isDebugOnlyPublicPath,
  isForbiddenProductionArtifactPath,
  isPreprodDeploy,
  isProductionDeploy,
  shouldCopyPublicPath,
  shouldIncludeInPrecache,
  validatePrecacheManifestCoverage,
} from "./build-policy.js";
import { createContentBuildId } from "./build-id.js";

describe("content build identity", () => {
  test("is stable across input order and changes with a path or byte", () => {
    const first = createContentBuildId([
      { path: "/app.js", content: "app-v1" },
      { path: "/index.html", content: "shell" },
    ]);
    const reordered = createContentBuildId([
      { path: "/index.html", content: "shell" },
      { path: "/app.js", content: "app-v1" },
    ]);

    expect(reordered).toBe(first);
    expect(
      createContentBuildId([
        { path: "/app.js", content: "app-v2" },
        { path: "/index.html", content: "shell" },
      ]),
    ).not.toBe(first);
    expect(
      createContentBuildId([
        { path: "/renamed-app.js", content: "app-v1" },
        { path: "/index.html", content: "shell" },
      ]),
    ).not.toBe(first);
  });
});

describe("build asset policy", () => {
  test("recognizes only the explicit preprod deploy branch", () => {
    expect(isPreprodDeploy("pwa/preprod")).toBe(true);
    expect(isPreprodDeploy("main")).toBe(false);
    expect(isPreprodDeploy("feature/preprod-fix")).toBe(false);
  });

  test("recognizes only the explicit production deploy branch", () => {
    expect(isProductionDeploy("pwa/prod")).toBe(true);
    expect(isProductionDeploy("prod")).toBe(false);
    expect(isProductionDeploy("main")).toBe(false);
    expect(isProductionDeploy("feature/prod-fix")).toBe(false);
  });

  test.each([
    "assets/img/01.jpg",
    "assets\\img\\sets\\reference.webp",
    "debug/performance-hud.js",
    "__gallery-preview.html",
    "__verso-preview.js",
    "components.html",
    "components.js",
    "debug-extraction.html",
    "debug-extraction.js",
  ])("classifies %s as debug-only", (filePath) => {
    expect(isDebugOnlyPublicPath(filePath)).toBe(true);
  });

  test.each([
    "index.html",
    "assets/fonts/snpro/font.woff2",
    "icons/camera.svg",
  ])("classifies %s as a production app asset", (filePath) => {
    expect(isDebugOnlyPublicPath(filePath)).toBe(false);
  });

  test("omits debug-only public content from production builds", () => {
    expect(shouldCopyPublicPath("assets/img", "main")).toBe(false);
    expect(shouldCopyPublicPath("debug/performance-hud.js", "main")).toBe(false);
    expect(shouldCopyPublicPath("debug-extraction.html", "main")).toBe(false);
    expect(shouldCopyPublicPath("__config-preview.html", "main")).toBe(false);
    expect(shouldCopyPublicPath("index.html", "main")).toBe(true);
  });

  test("keeps debug-only public content available on preprod", () => {
    expect(shouldCopyPublicPath("assets/img", "pwa/preprod")).toBe(true);
    expect(shouldCopyPublicPath("debug-extraction.html", "pwa/preprod")).toBe(true);
    expect(shouldCopyPublicPath("__config-preview.html", "pwa/preprod")).toBe(true);
  });

  test("keeps bundled preprod entrypoints inside the debug-only cache boundary", () => {
    expect(PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS).toEqual(["components.js", "__verso-preview.js"]);
    for (const entrypoint of PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS) {
      expect(isDebugOnlyPublicPath(entrypoint)).toBe(true);
      expect(shouldCopyPublicPath(entrypoint, "pwa/preprod")).toBe(true);
      expect(shouldCopyPublicPath(entrypoint, "pwa/prod")).toBe(false);
      expect(shouldIncludeInPrecache(entrypoint)).toBe(false);
    }
  });

  test("never copies filesystem metadata and only ships used modern fonts in production", () => {
    expect(shouldCopyPublicPath(".DS_Store", "pwa/preprod")).toBe(false);
    expect(shouldCopyPublicPath("assets/fonts/.DS_Store", "main")).toBe(false);
    expect(shouldCopyPublicPath("assets/fonts/Air/PPAir-Regular.woff2", "main")).toBe(false);
    expect(shouldCopyPublicPath("assets/fonts/snpro/SNPro-Regular.woff", "main")).toBe(false);
    expect(shouldCopyPublicPath("assets/fonts/snpro/SNPro-Regular.woff2", "main")).toBe(true);
    expect(shouldCopyPublicPath("assets/fonts/Air/PPAir-Regular.woff2", "pwa/preprod")).toBe(true);
  });

  test("never includes debug content or image corpus in the precache", () => {
    expect(shouldIncludeInPrecache("assets/img/01.jpg")).toBe(false);
    expect(shouldIncludeInPrecache("debug/performance-hud.js")).toBe(false);
    expect(shouldIncludeInPrecache("debug-extraction.js")).toBe(false);
    expect(shouldIncludeInPrecache("__gallery-preview.html")).toBe(false);
    expect(shouldIncludeInPrecache("components.html")).toBe(false);
    expect(shouldIncludeInPrecache("app.js")).toBe(true);
  });

  test("uses the same debug classification for production artifact rejection", () => {
    for (const filePath of [
      "assets/img/01.jpg",
      "debug/performance-hud.js",
      "__gallery-preview.html",
      "components.html",
      "debug-extraction.js",
    ]) {
      expect(isForbiddenProductionArtifactPath(filePath)).toBe(true);
    }
    expect(isForbiddenProductionArtifactPath("app.js.map")).toBe(true);
    expect(isForbiddenProductionArtifactPath("assets/.DS_Store")).toBe(true);
    expect(isForbiddenProductionArtifactPath("app.js")).toBe(false);
  });

  test("excludes service-worker metadata and source maps from precache", () => {
    expect(shouldIncludeInPrecache("_headers")).toBe(false);
    expect(shouldIncludeInPrecache("_redirects")).toBe(false);
    expect(shouldIncludeInPrecache("build-manifest.json")).toBe(false);
    expect(shouldIncludeInPrecache("service-worker.js")).toBe(false);
    expect(shouldIncludeInPrecache("precache-manifest.json")).toBe(false);
    expect(shouldIncludeInPrecache("app.js.map")).toBe(false);
  });

  test("accepts the exact policy-selected artifact manifest", () => {
    const artifactFiles = [
      "app.js",
      "index.html",
      "service-worker.js",
      "precache-manifest.json",
      "debug/performance-hud.js",
    ];

    expect(validatePrecacheManifestCoverage(artifactFiles, ["/index.html", "/app.js"])).toEqual([]);
  });

  test("reports missing, extra, and duplicate precache paths independently", () => {
    const failures = validatePrecacheManifestCoverage(
      ["app.js", "index.html", "service-worker.js"],
      ["/app.js", "/app.js", "/service-worker.js", "/unknown.js"],
    );

    expect(failures).toEqual([
      "duplicate precache path: /app.js",
      "precache manifest is missing eligible artifact path: /index.html",
      "precache manifest contains ineligible or absent artifact path: /service-worker.js",
      "precache manifest contains ineligible or absent artifact path: /unknown.js",
    ]);
  });

  test("rejects non-canonical aliases even when they resolve to an expected path", () => {
    expect(validatePrecacheManifestCoverage(["app.js"], ["app.js", "//app.js"])).toEqual([
      "precache path is not canonical root-relative: //app.js",
      "precache path is not canonical root-relative: app.js",
      "duplicate precache path: /app.js",
    ]);
  });
});
