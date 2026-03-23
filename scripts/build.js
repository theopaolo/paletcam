import { execSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { createNetlifyHeadersFile } from "./security-headers.js";

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, "src");
const publicRoot = join(projectRoot, "public");
const outDir = join(projectRoot, "dist");
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
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const commitHash = getGitCommitHash();
  const indexPath = join(outDir, "index.html");
  const source = await readFile(indexPath, "utf8");
  const stamped = source
    .replaceAll(appVersionPlaceholder, packageJson.version)
    .replaceAll(appCommitHashPlaceholder, commitHash);
  await writeFile(indexPath, stamped, "utf8");
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

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const buildResult = await Bun.build({
  entrypoints: [
    join(sourceRoot, "app.js"),
  ],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: false,
  minify: true,
  sourcemap: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify(bundleNodeEnv),
  },
});

if (!buildResult.success) {
  exitWithBuildErrors(buildResult.logs);
}

await copyPublicAssets();
await writeNetlifyHeaders();
await stampAppVersion();
await stampServiceWorkerBuildId(createBuildId());
await writePrecacheManifest();

console.log(`Build completed in ${outDir}`);
