import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  PREPROD_BRANCH,
  PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS,
  isDebugOnlyPublicPath,
  shouldCopyPublicPath,
  validatePrecacheManifestCoverage,
} from "./build-policy.js";
import {
  EXPECTED_IMAGE_CORPUS_FILES,
  IMAGE_CORPUS_MANIFEST,
  buildImageCorpusManifest,
  readImageCorpusManifest,
  serializeImageCorpusManifest,
} from "./preprod-image-corpus.js";

const root = process.cwd();
const publicRoot = join(root, "public");
const distRoot = join(root, "dist");

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
  console.error(`Preprod verification failed: ${message}`);
  process.exitCode = 1;
}

const [publicFiles, distFiles] = await Promise.all([listFiles(publicRoot), listFiles(distRoot)]);
const distFileSet = new Set(distFiles);
const bundledPublicEntrypoints = new Set(PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS);
const expectedDebugFiles = publicFiles.filter(
  (file) => isDebugOnlyPublicPath(file) && shouldCopyPublicPath(file, PREPROD_BRANCH),
);

for (const file of expectedDebugFiles) {
  if (!distFileSet.has(file)) {
    fail(`missing debug-only file copied from public/: ${file}`);
    continue;
  }

  if (bundledPublicEntrypoints.has(file)) continue;

  const [sourceStat, outputStat] = await Promise.all([
    stat(join(publicRoot, file)),
    stat(join(distRoot, file)),
  ]);
  if (sourceStat.size !== outputStat.size) {
    fail(`debug-only file differs from public/ source: ${file}`);
  }
}

for (const entrypoint of PREPROD_BUNDLED_PUBLIC_ENTRYPOINTS) {
  if (!distFileSet.has(entrypoint)) {
    fail(`missing bundled preprod debug entrypoint: ${entrypoint}`);
    continue;
  }
  const outputSource = await readFile(join(distRoot, entrypoint), "utf8");
  if (/(?:\bfrom\s*|\bimport\s*)["']\/modules\//.test(outputSource)) {
    fail(`preprod debug entrypoint retains an unresolved /modules/ import: ${entrypoint}`);
  }
}

for (const requiredFile of [
  "components.html",
  "components.js",
  "debug-extraction.html",
  "debug-extraction.js",
  "debug/performance-hud.js",
  IMAGE_CORPUS_MANIFEST.replace(/^public\//, ""),
]) {
  if (!distFileSet.has(requiredFile)) fail(`missing required debug tool: ${requiredFile}`);
}

const imageCorpus = expectedDebugFiles.filter((file) => file.startsWith("assets/img/"));
if (imageCorpus.length !== EXPECTED_IMAGE_CORPUS_FILES) {
  fail(
    `debug image corpus contains ${imageCorpus.length} files; expected ${EXPECTED_IMAGE_CORPUS_FILES}`,
  );
}

try {
  const [expectedCorpus, publicCorpus, distCorpus] = await Promise.all([
    readImageCorpusManifest(root),
    buildImageCorpusManifest(root),
    buildImageCorpusManifest(root, { directory: "dist/assets/img" }),
  ]);
  const expectedJson = serializeImageCorpusManifest(expectedCorpus);
  if (serializeImageCorpusManifest(publicCorpus) !== expectedJson) {
    fail(
      `source image corpus differs from ${IMAGE_CORPUS_MANIFEST}; run bun run generate:preprod-image-manifest and review the change`,
    );
  }
  if (serializeImageCorpusManifest(distCorpus) !== expectedJson) {
    fail("built image corpus differs from the reviewed source manifest");
  }
  if (expectedCorpus.totals.files !== EXPECTED_IMAGE_CORPUS_FILES) {
    fail(
      `${IMAGE_CORPUS_MANIFEST} declares ${expectedCorpus.totals.files} files; expected ${EXPECTED_IMAGE_CORPUS_FILES}`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const manifest = JSON.parse(await Bun.file(join(distRoot, "precache-manifest.json")).text());
for (const coverageFailure of validatePrecacheManifestCoverage(distFiles, manifest)) {
  fail(coverageFailure);
}
if (Array.isArray(manifest)) {
  for (const url of manifest) {
    const path = String(url).replace(/^\/+/, "");
    if (isDebugOnlyPublicPath(path)) fail(`debug-only path present in precache: ${url}`);
  }
}

if (!process.exitCode) {
  console.log(
    `Preprod verified: ${expectedDebugFiles.length} debug files, including ${imageCorpus.length} image files; none are precached.`,
  );
}
