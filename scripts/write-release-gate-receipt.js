import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILD_MANIFEST_FILENAME,
  RELEASE_GATE_COMMANDS,
  RELEASE_GATE_RECEIPT_FILENAME,
  createReleaseGateReceipt,
  hashArtifact,
  listArtifactFiles,
  validateBuildManifest,
} from "./build-provenance.js";
import { collectReleaseReportProvenance } from "./release-report-provenance.js";

const root = process.cwd();
const dist = join(root, "dist");

function readGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .toLowerCase();
}

function assertCleanWorktree() {
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (status) throw new Error("Cannot record release gates from a dirty worktree.");
}

function readCiContext(commit) {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Release gate receipts may only be recorded by GitHub Actions.");
  }
  const githubSha = String(process.env.GITHUB_SHA || "")
    .trim()
    .toLowerCase();
  const runId = String(process.env.GITHUB_RUN_ID || "").trim();
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();
  if (githubSha !== commit || !runId || !runAttempt) {
    throw new Error("GitHub Actions release context does not match the checked-out commit.");
  }
  return { provider: "github-actions", runId, runAttempt };
}

assertCleanWorktree();
const commit = readGitCommit();
const ci = readCiContext(commit);
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const buildManifest = JSON.parse(await readFile(join(dist, BUILD_MANIFEST_FILENAME), "utf8"));
const manifestFailures = validateBuildManifest(buildManifest, {
  version: packageJson.version,
  commit,
  deployBranch: "pwa/prod",
  bunVersion: process.versions.bun ?? "unknown",
  sourceTreeState: "clean",
});
if (manifestFailures.length > 0) {
  throw new Error(`Cannot record release gates: ${manifestFailures.join("; ")}.`);
}

const files = await listArtifactFiles(dist);
const artifactSha256 = await hashArtifact(dist, files);
const reportProvenance = await collectReleaseReportProvenance({
  root,
  expectedArtifact: {
    sha256: artifactSha256,
    buildId: buildManifest.buildId,
    commit,
    deployBranch: "pwa/prod",
  },
});
const receipt = createReleaseGateReceipt({
  commit,
  artifactSha256,
  bunVersion: process.versions.bun ?? "unknown",
  gates: RELEASE_GATE_COMMANDS,
  recordedAt: new Date().toISOString(),
  ci,
  reports: reportProvenance.bindings,
});
await writeFile(
  join(root, RELEASE_GATE_RECEIPT_FILENAME),
  `${JSON.stringify(receipt, null, 2)}\n`,
  "utf8",
);
console.log(`Release gate receipt recorded for ${artifactSha256}.`);
