import { extname } from "node:path";

export const PREPROD_BRANCH = "pwa/preprod";
export const PRODUCTION_BRANCH = "pwa/prod";

export const DEBUG_ONLY_PUBLIC_EXACT_PATHS = Object.freeze([
  "assets/img",
  "components.html",
  "components.js",
  "debug",
  "debug-extraction.html",
  "debug-extraction.js",
]);
export const DEBUG_ONLY_PUBLIC_PREFIXES = Object.freeze(["assets/img/", "debug/", "__"]);
export const PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS = Object.freeze([
  "components.js",
  "__verso-preview.js",
]);
const DEBUG_ONLY_EXACT_PATH_SET = new Set(DEBUG_ONLY_PUBLIC_EXACT_PATHS);

const PRECACHE_EXCLUDED_FILES = new Set([
  "_headers",
  "_redirects",
  "build-manifest.json",
  "service-worker.js",
  "precache-manifest.json",
]);
const PRECACHE_EXCLUDED_EXTENSIONS = new Set([".map"]);
const PRODUCTION_FONT_FILES = new Set([
  "assets/fonts/snpro/SNPro-Light.woff2",
  "assets/fonts/snpro/SNPro-Regular.woff2",
  "assets/fonts/snpro/SNPro-Semibold.woff2",
]);

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/").replace(/^\/+/, "");
}

export function isPreprodDeploy(deployBranchName) {
  return String(deployBranchName || "").trim() === PREPROD_BRANCH;
}

export function isProductionDeploy(deployBranchName) {
  return String(deployBranchName || "").trim() === PRODUCTION_BRANCH;
}

export function isDebugOnlyPublicPath(filePath) {
  const normalizedPath = normalizePath(filePath);
  const rootFilename = normalizedPath.split("/", 1)[0];

  return (
    DEBUG_ONLY_EXACT_PATH_SET.has(normalizedPath) ||
    DEBUG_ONLY_EXACT_PATH_SET.has(rootFilename) ||
    DEBUG_ONLY_PUBLIC_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
  );
}

export function isForbiddenProductionArtifactPath(filePath) {
  const normalizedPath = normalizePath(filePath);
  return (
    normalizedPath.split("/").includes(".DS_Store") ||
    normalizedPath.endsWith(".map") ||
    isDebugOnlyPublicPath(normalizedPath)
  );
}

export function shouldCopyPublicPath(filePath, deployBranchName) {
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath.split("/").includes(".DS_Store")) {
    return false;
  }
  if (isPreprodDeploy(deployBranchName)) {
    return true;
  }
  if (normalizedPath.startsWith("assets/fonts/")) {
    return PRODUCTION_FONT_FILES.has(normalizedPath);
  }
  return !isDebugOnlyPublicPath(normalizedPath);
}

export function shouldIncludeInPrecache(filePath) {
  const normalizedPath = normalizePath(filePath);

  if (
    PRECACHE_EXCLUDED_FILES.has(normalizedPath) ||
    PRECACHE_EXCLUDED_EXTENSIONS.has(extname(normalizedPath))
  ) {
    return false;
  }

  // Debug tools are available on preprod, but are deliberately never part of
  // the offline app shell. In production they are not copied at all.
  return !isDebugOnlyPublicPath(normalizedPath);
}

/**
 * Independently proves that a generated precache manifest is the exact set of
 * artifact files admitted by the cache policy. This intentionally does not
 * trust the build's manifest generator: release verification calls it against
 * a fresh recursive artifact listing.
 *
 * @param {string[]} artifactFiles
 * @param {unknown} precacheUrls
 * @returns {string[]}
 */
export function validatePrecacheManifestCoverage(artifactFiles, precacheUrls) {
  if (!Array.isArray(precacheUrls)) {
    return ["precache manifest is not an array"];
  }

  const expectedPaths = new Set(
    artifactFiles
      .map(normalizePath)
      .filter(shouldIncludeInPrecache)
      .map((path) => `/${path}`),
  );
  const actualPaths = new Set();
  const duplicatePaths = new Set();
  const nonCanonicalPaths = new Set();

  for (const value of precacheUrls) {
    const source = String(value);
    const canonicalPath = `/${normalizePath(source)}`;
    if (source !== canonicalPath) nonCanonicalPaths.add(source);
    if (actualPaths.has(canonicalPath)) duplicatePaths.add(canonicalPath);
    actualPaths.add(canonicalPath);
  }

  const failures = [];
  for (const path of [...nonCanonicalPaths].sort()) {
    failures.push(`precache path is not canonical root-relative: ${path}`);
  }
  for (const path of [...duplicatePaths].sort()) {
    failures.push(`duplicate precache path: ${path}`);
  }
  for (const path of [...expectedPaths].filter((path) => !actualPaths.has(path)).sort()) {
    failures.push(`precache manifest is missing eligible artifact path: ${path}`);
  }
  for (const path of [...actualPaths].filter((path) => !expectedPaths.has(path)).sort()) {
    failures.push(`precache manifest contains ineligible or absent artifact path: ${path}`);
  }
  return failures;
}
