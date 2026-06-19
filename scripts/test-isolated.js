import { Glob } from "bun";

// Bun shares a single global module registry across every test file in a run,
// and `mock.module()` overrides are never unregistered (not even by
// `mock.restore()`). That leaks mocks between files and makes otherwise-passing
// suites fail when run together. Until Bun ships per-file isolation, we run each
// test file in its own process so mocks can't bleed across files.

const projectRoot = process.cwd();
const glob = new Glob("**/*.test.js");

const testFiles = [];
for await (const file of glob.scan({ cwd: projectRoot })) {
  if (file.startsWith("node_modules/") || file.startsWith("dist/")) continue;
  testFiles.push(file);
}
testFiles.sort();

const failed = [];
for (const file of testFiles) {
  const result = Bun.spawnSync(["bun", "test", file], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) failed.push(file);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} test file(s) failed:`);
  for (const file of failed) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`\nAll ${testFiles.length} test files passed.`);
