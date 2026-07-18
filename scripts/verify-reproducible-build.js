import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { hashArtifact, listArtifactFiles } from "./build-provenance.js";

const root = process.cwd();
const dist = join(root, "dist");

export function assertMatchingBuildSnapshots(first, second) {
  if (first.sha256 !== second.sha256) {
    throw new Error(`Production build is not reproducible: ${first.sha256} != ${second.sha256}.`);
  }
  if (JSON.stringify(first.files) !== JSON.stringify(second.files)) {
    throw new Error("Production build file lists differ between identical builds.");
  }
}

async function collectSnapshot() {
  const files = await listArtifactFiles(dist);
  return { files, sha256: await hashArtifact(dist, files) };
}

function buildProduction() {
  execFileSync(process.execPath, ["run", "build:production"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
}

if (import.meta.main) {
  buildProduction();
  const first = await collectSnapshot();
  buildProduction();
  const second = await collectSnapshot();
  assertMatchingBuildSnapshots(first, second);
  console.log(`Production build is reproducible: ${second.sha256}.`);
}
