import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const projectRoot = process.cwd();
const outDir = join(projectRoot, 'dist');

const staticFiles = [
  'index.html',
  'offline.html',
  'app.css',
  'pwa-install.css',
  'reset.css',
  'zoom.css',
  'manifest.json',
  'service-worker.js',
  'palette-storage.js',
  'pwa-install.js',
  'filters.js',
];

const staticDirectories = ['icons', 'logo', 'modules'];

function exitWithBuildErrors(logs) {
  for (const log of logs) {
    console.error(log.message);
  }

  process.exit(1);
}

async function copyStaticAssets() {
  for (const filePath of staticFiles) {
    await cp(join(projectRoot, filePath), join(outDir, filePath));
  }

  for (const directoryPath of staticDirectories) {
    await cp(join(projectRoot, directoryPath), join(outDir, directoryPath), {
      recursive: true,
    });
  }

  // Keep the import-map target available in dist.
  await cp(
    join(projectRoot, 'node_modules/dexie/dist'),
    join(outDir, 'node_modules/dexie/dist'),
    { recursive: true }
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const buildResult = await Bun.build({
  entrypoints: ['app.js', 'collection-ui.js'],
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

await copyStaticAssets();

console.log(`Build completed in ${outDir}`);
