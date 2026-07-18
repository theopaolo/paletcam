import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { RELEASE_REPORT_CONTRACTS, RELEASE_REPORT_PATHS } from "./release-report-provenance.js";

export const BUILD_MANIFEST_FILENAME = "build-manifest.json";
export const RELEASE_GATE_RECEIPT_FILENAME = ".release-gate-receipt.json";
export const BUILD_MANIFEST_SCHEMA_VERSION = 1;
export const RELEASE_GATE_RECEIPT_SCHEMA_VERSION = 3;
export const RELEASE_GATE_COMMANDS = Object.freeze(["bun run verify:release"]);

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;
const FULL_COMMIT_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function normalizeCommitHash(value, { required = false, full = false } = {}) {
  const commit = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!commit) {
    if (required) throw new Error("A Git commit hash is required for a production build.");
    return "unknown";
  }
  if (!COMMIT_HASH_PATTERN.test(commit)) {
    throw new Error("Git commit hash must contain 7-64 hexadecimal characters.");
  }
  if (full && !FULL_COMMIT_HASH_PATTERN.test(commit)) {
    throw new Error("Production Git commit hash must be a full 40- or 64-character identifier.");
  }
  return commit;
}

export function createBuildManifest({
  version,
  commit,
  deployBranch,
  bunVersion,
  buildId,
  sourceTreeState,
  logApiBaseUrl,
  communityBaseUrl,
}) {
  return {
    schemaVersion: BUILD_MANIFEST_SCHEMA_VERSION,
    version,
    commit,
    commitShort: commit === "unknown" ? commit : commit.slice(0, 12),
    deployBranch,
    bunVersion,
    buildId,
    sourceTreeState,
    endpoints: {
      logApiBaseUrl,
      communityBaseUrl,
    },
  };
}

export function validateBuildManifest(manifest, expected = {}) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["build manifest is not an object"];
  }
  if (manifest.schemaVersion !== BUILD_MANIFEST_SCHEMA_VERSION) {
    failures.push("build manifest schema is unsupported");
  }
  for (const field of [
    "version",
    "commit",
    "commitShort",
    "deployBranch",
    "bunVersion",
    "buildId",
    "sourceTreeState",
  ]) {
    if (typeof manifest[field] !== "string" || !manifest[field]) {
      failures.push(`build manifest ${field} is missing`);
    }
  }
  if (!manifest.endpoints || typeof manifest.endpoints !== "object") {
    failures.push("build manifest endpoints are missing");
  } else {
    for (const field of ["logApiBaseUrl", "communityBaseUrl"]) {
      if (typeof manifest.endpoints[field] !== "string") {
        failures.push(`build manifest endpoint ${field} is invalid`);
      }
    }
  }
  if (!new Set(["clean", "dirty", "unknown"]).has(manifest.sourceTreeState)) {
    failures.push("build manifest source tree state is invalid");
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue !== undefined && manifest[field] !== expectedValue) {
      failures.push(`build manifest ${field} does not match ${expectedValue}`);
    }
  }
  if (
    typeof manifest.commit === "string" &&
    manifest.commit !== "unknown" &&
    !FULL_COMMIT_HASH_PATTERN.test(manifest.commit)
  ) {
    failures.push("build manifest commit is not a full Git identifier");
  }
  if (
    typeof manifest.commit === "string" &&
    typeof manifest.commitShort === "string" &&
    manifest.commitShort !==
      (manifest.commit === "unknown" ? "unknown" : manifest.commit.slice(0, 12))
  ) {
    failures.push("build manifest short commit does not match its full commit");
  }
  return failures;
}

export async function listArtifactFiles(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listArtifactFiles(directory, path)));
    else files.push(relative(directory, path).split("\\").join("/"));
  }
  return files.sort();
}

export async function hashArtifact(directory, files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(directory, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function createReleaseGateReceipt({
  commit,
  artifactSha256,
  bunVersion,
  gates,
  recordedAt,
  ci,
  reports,
}) {
  return {
    schemaVersion: RELEASE_GATE_RECEIPT_SCHEMA_VERSION,
    recordedAt,
    commit,
    artifactSha256,
    bunVersion,
    gates: [...gates],
    ci: { ...ci },
    reports: reports.map((binding) => ({
      ...binding,
      artifact: { ...binding.artifact },
    })),
  };
}

export function validateReleaseGateReceipt(receipt, expected = {}) {
  const failures = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["release gate receipt is not an object"];
  }
  if (receipt.schemaVersion !== RELEASE_GATE_RECEIPT_SCHEMA_VERSION) {
    failures.push("release gate receipt schema is unsupported");
  }
  if (typeof receipt.recordedAt !== "string" || !Number.isFinite(Date.parse(receipt.recordedAt))) {
    failures.push("release gate receipt timestamp is invalid");
  }
  if (!Array.isArray(receipt.gates) || receipt.gates.length === 0) {
    failures.push("release gate receipt has no gates");
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.artifactSha256 ?? "")) {
    failures.push("release gate receipt artifactSha256 is invalid");
  }
  if (!FULL_COMMIT_HASH_PATTERN.test(receipt.commit ?? "")) {
    failures.push("release gate receipt commit is invalid");
  }
  let productionBuildId = null;
  if (!Array.isArray(receipt.reports) || receipt.reports.length !== RELEASE_REPORT_PATHS.length) {
    failures.push("release gate receipt report bindings are missing or incomplete");
  } else {
    for (let index = 0; index < RELEASE_REPORT_PATHS.length; index += 1) {
      const binding = receipt.reports[index];
      if (binding?.path !== RELEASE_REPORT_PATHS[index]) {
        failures.push(
          `release gate receipt report ${index + 1} is not ${RELEASE_REPORT_PATHS[index]}`,
        );
      }
      if (!/^[0-9a-f]{64}$/.test(binding?.sha256 ?? "")) {
        failures.push(
          `release gate receipt report hash is invalid for ${RELEASE_REPORT_PATHS[index]}`,
        );
      }
      if (
        !binding ||
        typeof binding !== "object" ||
        Array.isArray(binding) ||
        Object.keys(binding).sort().join(",") !== "artifact,path,sha256"
      ) {
        failures.push(
          `release gate receipt report binding fields are invalid for ${RELEASE_REPORT_PATHS[index]}`,
        );
      }
      const artifact = binding?.artifact;
      if (
        !artifact ||
        typeof artifact !== "object" ||
        Array.isArray(artifact) ||
        Object.keys(artifact).sort().join(",") !== "buildId,commit,deployBranch,sha256"
      ) {
        failures.push(
          `release gate receipt report artifact fields are invalid for ${RELEASE_REPORT_PATHS[index]}`,
        );
        continue;
      }
      const contract = RELEASE_REPORT_CONTRACTS[index];
      if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) {
        failures.push(`release gate receipt report artifact hash is invalid for ${contract.path}`);
      }
      if (!/^[0-9a-f]{20}$/.test(artifact.buildId ?? "")) {
        failures.push(`release gate receipt report buildId is invalid for ${contract.path}`);
      }
      if (artifact.commit !== receipt.commit) {
        failures.push(`release gate receipt report commit does not match for ${contract.path}`);
      }
      if (artifact.deployBranch !== contract.deployBranch) {
        failures.push(
          `release gate receipt report deployBranch is not ${contract.deployBranch} for ${contract.path}`,
        );
      }
      if (contract.deployBranch === "pwa/prod") {
        if (artifact.sha256 !== receipt.artifactSha256) {
          failures.push(
            `release gate receipt report artifact does not match production for ${contract.path}`,
          );
        }
        productionBuildId ??= artifact.buildId;
        if (artifact.buildId !== productionBuildId) {
          failures.push(
            `release gate receipt production report buildId differs for ${contract.path}`,
          );
        }
      } else if (artifact.sha256 === receipt.artifactSha256) {
        failures.push("release gate receipt preprod artifact is not distinct from production");
      }
    }
  }
  if (
    !receipt.ci ||
    receipt.ci.provider !== "github-actions" ||
    typeof receipt.ci.runId !== "string" ||
    !receipt.ci.runId ||
    typeof receipt.ci.runAttempt !== "string" ||
    !receipt.ci.runAttempt
  ) {
    failures.push("release gate receipt has no trusted CI run context");
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (receipt[field] !== expectedValue) {
      failures.push(`release gate receipt ${field} does not match ${expectedValue}`);
    }
  }
  return failures;
}
