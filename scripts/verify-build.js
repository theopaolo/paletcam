import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { createContentBuildId } from "./build-id.js";
import {
  isForbiddenProductionArtifactPath,
  validatePrecacheManifestCoverage,
} from "./build-policy.js";
import {
  BUILD_MANIFEST_FILENAME,
  normalizeCommitHash,
  validateBuildManifest,
} from "./build-provenance.js";
import { ARTIFACT_PERFORMANCE_BUDGETS } from "./performance-budgets.js";
import { collectInitialJsFiles } from "./initial-js-graph.js";

const root = process.cwd();
const dist = join(root, "dist");
const maxDistBytes =
  Number(process.env.MAX_PRODUCTION_DIST_BYTES) || ARTIFACT_PERFORMANCE_BUDGETS.distBytes;
const maxPrecacheBytes =
  Number(process.env.MAX_PRECACHE_BYTES) || ARTIFACT_PERFORMANCE_BUDGETS.precacheBytes;
const maxPrecacheEntries =
  Number(process.env.MAX_PRECACHE_ENTRIES) || ARTIFACT_PERFORMANCE_BUDGETS.precacheEntries;
const maxInitialJsBytes =
  Number(process.env.MAX_INITIAL_JS_BYTES) || ARTIFACT_PERFORMANCE_BUDGETS.initialJsBytes;
const maxCssBytes = Number(process.env.MAX_CSS_BYTES) || ARTIFACT_PERFORMANCE_BUDGETS.cssBytes;
const maxFontBytes = Number(process.env.MAX_FONT_BYTES) || ARTIFACT_PERFORMANCE_BUDGETS.fontBytes;

async function listFiles(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(directory, path)));
    else files.push(relative(directory, path).split("\\").join("/"));
  }
  return files;
}

function fail(message) {
  console.error(`Build verification failed: ${message}`);
  process.exitCode = 1;
}

function resolveExpectedCommit() {
  const environmentCommit = String(process.env.COMMIT_HASH || "").trim();
  let repositoryCommit = "";
  try {
    repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    repositoryCommit = "";
  }
  const expectedCommit = environmentCommit || repositoryCommit;
  return normalizeCommitHash(expectedCommit, { required: true, full: true });
}

const files = await listFiles(dist);
const requiredArtifactFiles = [
  "index.html",
  "offline.html",
  "manifest.json",
  "service-worker.js",
  "precache-manifest.json",
  BUILD_MANIFEST_FILENAME,
];
for (const requiredFile of requiredArtifactFiles) {
  if (!files.includes(requiredFile)) fail(`required artifact file is missing: ${requiredFile}`);
}
const sizes = new Map();
let totalBytes = 0;
for (const file of files) {
  const size = (await stat(join(dist, file))).size;
  sizes.set(file, size);
  totalBytes += size;
}

for (const file of files) {
  if (isForbiddenProductionArtifactPath(file)) {
    fail(`debug-only file present in production output: ${file}`);
  }
}

if (totalBytes > maxDistBytes) {
  fail(`dist is ${totalBytes} bytes; budget is ${maxDistBytes}`);
}

const initialJsFiles = await collectInitialJsFiles({
  entrypoints: ["app.js", "pwa-install.js"],
  hasFile: async (file) => sizes.has(file),
  readSource: async (file) => readFile(join(dist, file), "utf8"),
});
const initialJsBytes = [...initialJsFiles].reduce(
  (total, file) => total + (sizes.get(file) ?? 0),
  0,
);
const cssBytes = files
  .filter((file) => file.endsWith(".css"))
  .reduce((total, file) => total + (sizes.get(file) ?? 0), 0);
const fontBytes = files
  .filter((file) => file.startsWith("assets/fonts/"))
  .reduce((total, file) => total + (sizes.get(file) ?? 0), 0);

if (initialJsBytes > maxInitialJsBytes) {
  fail(`initial JS is ${initialJsBytes} bytes; budget is ${maxInitialJsBytes}`);
}
if (cssBytes > maxCssBytes) {
  fail(`CSS is ${cssBytes} bytes; budget is ${maxCssBytes}`);
}
if (fontBytes > maxFontBytes) {
  fail(`fonts are ${fontBytes} bytes; budget is ${maxFontBytes}`);
}

const manifest = JSON.parse(await readFile(join(dist, "precache-manifest.json"), "utf8"));
for (const coverageFailure of validatePrecacheManifestCoverage(files, manifest)) {
  fail(coverageFailure);
}

let precacheBytes = 0;
for (const url of Array.isArray(manifest) ? manifest : []) {
  const path = String(url).replace(/^\/+/, "");
  if (!sizes.has(path)) fail(`precache path is missing from the artifact: ${url}`);
  if (isForbiddenProductionArtifactPath(path)) {
    fail(`debug-only path present in precache: ${url}`);
  }
  precacheBytes += sizes.get(path) ?? 0;
}

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const buildManifest = JSON.parse(await readFile(join(dist, BUILD_MANIFEST_FILENAME), "utf8"));
  const manifestFailures = validateBuildManifest(buildManifest, {
    version: packageJson.version,
    commit: resolveExpectedCommit(),
    deployBranch: "pwa/prod",
    bunVersion: process.versions.bun ?? "unknown",
  });
  for (const failure of manifestFailures) fail(failure);
  if (buildManifest?.endpoints?.logApiBaseUrl !== "https://cclogs.ludique.dev") {
    fail("compiled telemetry endpoint is not the approved production endpoint");
  }
  if (buildManifest?.endpoints?.communityBaseUrl !== "https://colorcatchers.co") {
    fail("compiled community endpoint is not the approved production endpoint");
  }
  const buildIdEntries = await Promise.all(
    manifest.map(async (url) => ({
      path: url,
      content: await readFile(join(dist, String(url).replace(/^\/+/, ""))),
    })),
  );
  const expectedBuildId = createContentBuildId(buildIdEntries);
  if (buildManifest?.buildId !== expectedBuildId) {
    fail("build manifest content ID does not match the precache bytes");
  }
  const serviceWorkerSource = await readFile(join(dist, "service-worker.js"), "utf8");
  if (!serviceWorkerSource.includes(`colorcatcher-${expectedBuildId}`)) {
    fail("service worker cache ID does not match the content-derived build ID");
  }
} catch (error) {
  fail(`build manifest cannot be validated: ${error.message}`);
}

if (Array.isArray(manifest) && manifest.length > maxPrecacheEntries) {
  fail(`precache has ${manifest.length} entries; budget is ${maxPrecacheEntries}`);
}
if (precacheBytes > maxPrecacheBytes) {
  fail(`precache is ${precacheBytes} bytes; budget is ${maxPrecacheBytes}`);
}

const textFiles = files.filter((file) => [".html", ".js"].includes(extname(file)));
for (const file of textFiles) {
  const source = await readFile(join(dist, file), "utf8");
  if (file.endsWith(".js") && source.includes("paletcam:performance-hud-position")) {
    fail(`debug performance HUD present in production output: ${file}`);
  }
  for (const placeholder of [
    "__APP_VERSION__",
    "__COMMIT_HASH__",
    "__BUILD_ID__",
    "__PRECACHE_URLS__",
    "__REQUIRED_SHELL_URLS__",
    "__DEBUG_CACHE_BYPASS_PATHS__",
    "__DEBUG_CACHE_BYPASS_PREFIXES__",
  ]) {
    if (source.includes(placeholder)) fail(`unresolved ${placeholder} in ${file}`);
  }
}

if (!process.exitCode) {
  console.log(
    `Build verified: ${files.length} files, ${totalBytes} bytes; initial JS ${initialJsBytes} bytes; CSS ${cssBytes} bytes; fonts ${fontBytes} bytes; precache ${manifest.length} entries, ${precacheBytes} bytes.`,
  );
}
