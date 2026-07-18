import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createContentBuildId } from "./build-id.js";
import {
  DEBUG_ONLY_PUBLIC_EXACT_PATHS,
  DEBUG_ONLY_PUBLIC_PREFIXES,
  PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS,
  isPreprodDeploy,
  isProductionDeploy,
  shouldCopyPublicPath,
  shouldIncludeInPrecache,
} from "./build-policy.js";
import {
  BUILD_MANIFEST_FILENAME,
  createBuildManifest,
  normalizeCommitHash,
} from "./build-provenance.js";
import { resolveCommunityApiBaseUrl } from "./community-api-config.js";
import { createBuildNetlifyHeadersFile, createNetlifyHeadersFile } from "./security-headers.js";
import { resolveDeployBranchName } from "./git-utils.js";
import { resolveLogApiBaseUrl } from "./log-api-config.js";

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
const serviceWorkerPrecacheUrlsPlaceholder = "__PRECACHE_URLS__";
const serviceWorkerRequiredShellUrlsPlaceholder = "__REQUIRED_SHELL_URLS__";
const serviceWorkerDebugBypassPathsPlaceholder = "__DEBUG_CACHE_BYPASS_PATHS__";
const serviceWorkerDebugBypassPrefixesPlaceholder = "__DEBUG_CACHE_BYPASS_PREFIXES__";
const bundleNodeEnv = "production";
const deployBranchName = resolveDeployBranchName();
const logApiBaseUrl = resolveLogApiBaseUrl(process.env.PALETCAM_LOG_API_BASE_URL, deployBranchName);
const communityBaseUrl = resolveCommunityApiBaseUrl(
  process.env.COMMUNITY_API_PROXY_TARGET,
  deployBranchName,
);
const appVersion =
  JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version || "";
const fullCommitHash = getGitCommitHash();
const sourceTreeState = getGitWorktreeState();
const commitHash = fullCommitHash === "unknown" ? fullCommitHash : fullCommitHash.slice(0, 12);
const browserBuildConfig = {
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: isPreprodDeploy(deployBranchName) ? "external" : "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify(bundleNodeEnv),
    __COMMUNITY_BASE_URL__: JSON.stringify(communityBaseUrl),
    __PALETCAM_DEPLOY_BRANCH__: JSON.stringify(deployBranchName),
    __PALETCAM_DEBUG_TOOLS__: JSON.stringify(isPreprodDeploy(deployBranchName)),
    __PALETCAM_BUILD_ARTIFACT__: "true",
    __PALETCAM_LOG_API_BASE_URL__: JSON.stringify(logApiBaseUrl),
    __APP_VERSION__: JSON.stringify(appVersion),
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
};

const debugPublicModuleResolver = {
  name: "debug-public-module-resolver",
  setup(build) {
    build.onResolve({ filter: /^\/modules\// }, ({ path }) => ({
      path: join(sourceRoot, path.replace(/^\/+/, "")),
    }));
  },
};

function exitWithBuildErrors(logs) {
  for (const log of logs) {
    console.error(log.message);
  }

  process.exit(1);
}

async function copyPublicAssets() {
  const publicFiles = await listFilesRecursively(publicRoot);

  for (const relativePath of publicFiles) {
    if (!shouldCopyPublicPath(relativePath, deployBranchName)) {
      continue;
    }

    const outputPath = join(outDir, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await cp(join(publicRoot, relativePath), outputPath);
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

  return precacheUrls;
}

async function collectRequiredShellUrls(precacheUrls) {
  // Every executable/style output is required because core offline journeys
  // intentionally cross dynamic collection, viewer, and backup boundaries.
  // Fonts, icons, and branding remain optional cosmetics.
  const requiredPaths = new Set([
    "index.html",
    "offline.html",
    ...precacheUrls
      .map((url) => String(url).replace(/^\/+/, ""))
      .filter((path) => path.endsWith(".js") || path.endsWith(".css")),
  ]);

  return [...requiredPaths]
    .map((path) => `/${path}`)
    .sort((left, right) => left.localeCompare(right));
}

async function createBuildId(precacheUrls) {
  const entries = await Promise.all(
    precacheUrls.map(async (url) => ({
      path: url,
      content: await readFile(join(outDir, url.replace(/^\/+/, ""))),
    })),
  );
  return createContentBuildId(entries);
}

function getGitCommitHash() {
  const envCommitHash = String(process.env.COMMIT_HASH || "").trim();
  let repositoryCommitHash = "";
  try {
    repositoryCommitHash = normalizeCommitHash(
      execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
      { required: true, full: true },
    );
  } catch {
    repositoryCommitHash = "";
  }

  if (envCommitHash) {
    const normalizedEnvironmentCommit = normalizeCommitHash(envCommitHash, {
      required: isProductionDeploy(deployBranchName),
      full: isProductionDeploy(deployBranchName),
    });
    const matchesRepositoryCommit =
      normalizedEnvironmentCommit === repositoryCommitHash ||
      (!isProductionDeploy(deployBranchName) &&
        repositoryCommitHash.startsWith(normalizedEnvironmentCommit));
    if (repositoryCommitHash && !matchesRepositoryCommit) {
      throw new Error("COMMIT_HASH does not match the checked-out Git commit.");
    }
    return normalizedEnvironmentCommit;
  }

  if (repositoryCommitHash) {
    return repositoryCommitHash;
  }
  if (isProductionDeploy(deployBranchName)) {
    throw new Error("Unable to resolve a valid Git commit for the production build.");
  }
  console.warn("Unable to resolve git commit hash. Using fallback.");
  return "unknown";
}

function getGitWorktreeState() {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim() ? "dirty" : "clean";
  } catch {
    return "unknown";
  }
}

async function writeBuildManifest(buildId) {
  const manifest = createBuildManifest({
    version: appVersion,
    commit: fullCommitHash,
    deployBranch: deployBranchName,
    bunVersion: process.versions.bun ?? "unknown",
    buildId,
    sourceTreeState,
    logApiBaseUrl,
    communityBaseUrl,
  });
  await writeFile(
    join(outDir, BUILD_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
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

async function stampServiceWorker({ buildId, precacheUrls, requiredShellUrls }) {
  const serviceWorkerPath = join(outDir, serviceWorkerFilename);
  const source = await readFile(serviceWorkerPath, "utf8");

  for (const placeholder of [
    serviceWorkerBuildIdPlaceholder,
    serviceWorkerPrecacheUrlsPlaceholder,
    serviceWorkerRequiredShellUrlsPlaceholder,
    serviceWorkerDebugBypassPathsPlaceholder,
    serviceWorkerDebugBypassPrefixesPlaceholder,
  ]) {
    if (!source.includes(placeholder)) {
      throw new Error(`Missing ${placeholder} placeholder in ${serviceWorkerFilename}.`);
    }
  }

  const stampedSource = source
    .replaceAll(serviceWorkerBuildIdPlaceholder, buildId)
    .replaceAll(serviceWorkerPrecacheUrlsPlaceholder, JSON.stringify(precacheUrls))
    .replaceAll(serviceWorkerRequiredShellUrlsPlaceholder, JSON.stringify(requiredShellUrls))
    .replaceAll(
      serviceWorkerDebugBypassPathsPlaceholder,
      JSON.stringify(DEBUG_ONLY_PUBLIC_EXACT_PATHS),
    )
    .replaceAll(
      serviceWorkerDebugBypassPrefixesPlaceholder,
      JSON.stringify(DEBUG_ONLY_PUBLIC_PREFIXES),
    );
  await writeFile(serviceWorkerPath, stampedSource, "utf8");
}

async function writeNetlifyHeaders() {
  const staticHeadersFile = createNetlifyHeadersFile();
  const buildHeadersFile = createBuildNetlifyHeadersFile({
    deployBranchName,
    communityBaseUrl,
    logApiBaseUrl,
  });
  await writeFile(join(publicRoot, netlifyHeadersFilename), staticHeadersFile, "utf8");
  await writeFile(join(outDir, netlifyHeadersFilename), buildHeadersFile, "utf8");
}

async function buildBrowserEntrypoints(entrypoints, buildOutDir, overrides = {}) {
  const buildResult = await Bun.build({
    entrypoints,
    outdir: buildOutDir,
    ...browserBuildConfig,
    ...overrides,
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

const debugEntrypoints = isPreprodDeploy(deployBranchName)
  ? [join(sourceRoot, "debug-extraction.js")]
  : [];
if (debugEntrypoints.length > 0) {
  await buildBrowserEntrypoints(debugEntrypoints, outDir);
  await buildBrowserEntrypoints(
    [join(sourceRoot, "modules", "performance-hud.js")],
    join(outDir, "debug"),
    { splitting: false },
  );
}

await copyPublicAssets();
if (isPreprodDeploy(deployBranchName)) {
  await buildBrowserEntrypoints(
    PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS.map((entrypoint) => join(publicRoot, entrypoint)),
    outDir,
    { plugins: [debugPublicModuleResolver], splitting: false },
  );
}
await writeNetlifyHeaders();
await stampAppVersion();
const precacheUrls = await writePrecacheManifest();
const requiredShellUrls = await collectRequiredShellUrls(precacheUrls);
const buildId = await createBuildId(precacheUrls);
await stampServiceWorker({
  buildId,
  precacheUrls,
  requiredShellUrls,
});
await writeBuildManifest(buildId);

console.log(`Build completed in ${outDir}`);
console.log(`Resolved deploy branch: ${deployBranchName || "unknown"}`);
