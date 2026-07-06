import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { createNetlifyHeadersFile } from "./security-headers.js";
import { resolveDeployBranchName } from "./git-utils.js";

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, "src");
const publicRoot = join(projectRoot, "public");
const outDir = join(projectRoot, "dist");
const workersOutDir = join(outDir, "workers");
const netlifyHeadersFilename = "_headers";
const precacheManifestFilename = "precache-manifest.json";
const serviceWorkerFilename = "service-worker.js";
const appVersionPlaceholder = "__APP_VERSION__";
const appCommitHashPlaceholder = "__COMMIT_HASH__";
const serviceWorkerBuildIdPlaceholder = "__BUILD_ID__";
const unknownCommitHash = "unknown";
const precacheExcludedFiles = new Set(["service-worker.js", precacheManifestFilename]);
const precacheExcludedExtensions = new Set([".map"]);
const bundleNodeEnv = "production";
const deployBranchName = resolveDeployBranchName();
const logApiBaseUrl = process.env.PALETCAM_LOG_API_BASE_URL ?? "";
const communityBaseUrl = (process.env.COMMUNITY_API_PROXY_TARGET ?? "").replace(/\/+$/, "");
const appVersion =
  JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version || "";
const commitHash = getGitCommitHash();
const browserBuildConfig = {
  target: "browser",
  format: "esm",
  splitting: false,
  minify: true,
  sourcemap: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify(bundleNodeEnv),
    __COMMUNITY_BASE_URL__: JSON.stringify(communityBaseUrl),
    __PALETCAM_DEPLOY_BRANCH__: JSON.stringify(deployBranchName),
    __PALETCAM_LOG_API_BASE_URL__: JSON.stringify(logApiBaseUrl),
    __APP_VERSION__: JSON.stringify(appVersion),
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
};

function exitWithBuildErrors(logs) {
  for (const log of logs) {
    console.error(log.message);
  }

  process.exit(1);
}

async function copyPublicAssets() {
  const publicEntries = await readdir(publicRoot);

  for (const entryName of publicEntries) {
    await cp(join(publicRoot, entryName), join(outDir, entryName), {
      recursive: true,
    });
  }
}

async function listFilesRecursively(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(rootDir, entryPath)));
      continue;
    }

    files.push(relative(rootDir, entryPath).split("\\").join("/"));
  }

  return files;
}

function shouldIncludeInPrecache(relativePath) {
  if (precacheExcludedFiles.has(relativePath)) {
    return false;
  }

  return !precacheExcludedExtensions.has(extname(relativePath));
}

async function writePrecacheManifest() {
  const outputFiles = await listFilesRecursively(outDir);
  const precacheUrls = outputFiles
    .filter(shouldIncludeInPrecache)
    .map((filePath) => `/${filePath}`)
    .sort((left, right) => left.localeCompare(right));

  await writeFile(
    join(outDir, precacheManifestFilename),
    `${JSON.stringify(precacheUrls, null, 2)}\n`,
    "utf8",
  );
}

function createBuildId() {
  return Date.now().toString(36);
}

function getGitCommitHash() {
  const envCommitHash = String(process.env.COMMIT_HASH || "").trim();
  if (envCommitHash) {
    return envCommitHash.slice(0, 12);
  }

  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (_error) {
    console.warn("Unable to resolve git commit hash. Using fallback.");
    return unknownCommitHash;
  }
}

async function stampAppVersion() {
  const stampFile = async (filePath) => {
    const source = await readFile(filePath, "utf8");
    const stamped = source
      .replaceAll(appVersionPlaceholder, appVersion)
      .replaceAll(appCommitHashPlaceholder, commitHash);
    await writeFile(filePath, stamped, "utf8");
  };

  const allFiles = await listFilesRecursively(outDir);
  const stampTargets = allFiles
    .filter((f) => f.endsWith(".html") || f.endsWith(".js"))
    .map((f) => join(outDir, f));

  await Promise.all(stampTargets.map(stampFile));
}

async function stampServiceWorkerBuildId(buildId) {
  const serviceWorkerPath = join(outDir, serviceWorkerFilename);
  const source = await readFile(serviceWorkerPath, "utf8");

  if (!source.includes(serviceWorkerBuildIdPlaceholder)) {
    throw new Error(
      `Missing ${serviceWorkerBuildIdPlaceholder} placeholder in ${serviceWorkerFilename}.`,
    );
  }

  const stampedSource = source.replaceAll(serviceWorkerBuildIdPlaceholder, buildId);
  await writeFile(serviceWorkerPath, stampedSource, "utf8");
}

async function writeNetlifyHeaders() {
  const headersFile = createNetlifyHeadersFile();
  await writeFile(join(publicRoot, netlifyHeadersFilename), headersFile, "utf8");
  await writeFile(join(outDir, netlifyHeadersFilename), headersFile, "utf8");
}

async function buildBrowserEntrypoints(entrypoints, buildOutDir) {
  const buildResult = await Bun.build({
    entrypoints,
    outdir: buildOutDir,
    ...browserBuildConfig,
  });

  if (!buildResult.success) {
    exitWithBuildErrors(buildResult.logs);
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(workersOutDir, { recursive: true });

await buildBrowserEntrypoints(
  [join(sourceRoot, "app.js"), join(sourceRoot, "offline.js"), join(sourceRoot, "pwa-install.js")],
  outDir,
);
await buildBrowserEntrypoints(
  [
    join(sourceRoot, "workers", "palette-extraction.worker.js"),
    join(sourceRoot, "workers", "palette-json-transfer.worker.js"),
  ],
  workersOutDir,
);

const debugEntrypoints =
  deployBranchName === "pwa/preprod" ? [join(sourceRoot, "debug-extraction.js")] : [];
if (debugEntrypoints.length > 0) {
  await buildBrowserEntrypoints(debugEntrypoints, outDir);
}

await copyPublicAssets();
await writeNetlifyHeaders();
await stampAppVersion();
await stampServiceWorkerBuildId(createBuildId());
await writePrecacheManifest();

console.log(`Build completed in ${outDir}`);
console.log(`Resolved deploy branch: ${deployBranchName || "unknown"}`);
