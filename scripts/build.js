import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');
const publicRoot = join(projectRoot, 'public');
const outDir = join(projectRoot, 'dist');
const precacheManifestFilename = 'precache-manifest.json';
const precacheExcludedFiles = new Set([
  'service-worker.js',
  precacheManifestFilename,
]);
const precacheExcludedExtensions = new Set(['.map']);

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

    files.push(relative(rootDir, entryPath).split('\\').join('/'));
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
    'utf8'
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const buildResult = await Bun.build({
  entrypoints: [join(sourceRoot, 'app.js'), join(sourceRoot, 'collection-ui.js')],
  outdir: outDir,
  target: 'browser',
  format: 'esm',
  splitting: false,
  minify: true,
  sourcemap: 'external',
});

if (!buildResult.success) {
  exitWithBuildErrors(buildResult.logs);
}

await copyPublicAssets();
await writePrecacheManifest();

console.log(`Build completed in ${outDir}`);
