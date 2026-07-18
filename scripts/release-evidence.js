import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILD_MANIFEST_FILENAME,
  RELEASE_GATE_COMMANDS,
  RELEASE_GATE_RECEIPT_FILENAME,
  hashArtifact,
  listArtifactFiles,
  validateBuildManifest,
  validateReleaseGateReceipt,
} from "./build-provenance.js";
import { isForbiddenProductionArtifactPath } from "./build-policy.js";
import { collectInitialJsFiles } from "./initial-js-graph.js";
import { ARTIFACT_PERFORMANCE_BUDGETS } from "./performance-budgets.js";
import {
  collectReleaseReportProvenance,
  compareReleaseReportBindings,
} from "./release-report-provenance.js";

const root = process.cwd();
const dist = join(root, "dist");
export const RELEASE_EXTERNAL_SIGNOFF_KEYS = Object.freeze([
  "physicalIosSafariAndPwa",
  "physicalAndroidChromeAndPwa",
  "productionObservabilityConfiguration",
  "privacyNoticePublication",
  "releaseApprovalAndChangelog",
  "rollbackAndRecoveryRehearsal",
  "backendIdempotencyEnforcement",
  "exactProductionArtifactManualSmoke",
]);
export const RELEASE_EXTERNAL_SIGNOFF_STATUSES = Object.freeze(["pending", "complete"]);
const DEVICE_SIGNOFF_KEYS = new Set([
  "physicalIosSafariAndPwa",
  "physicalAndroidChromeAndPwa",
  "exactProductionArtifactManualSmoke",
]);

export function createPendingExternalSignoffs() {
  return Object.fromEntries(
    RELEASE_EXTERNAL_SIGNOFF_KEYS.map((key) => [
      key,
      {
        status: "pending",
        owner: "",
        completedAt: null,
        evidence: [],
        notes: "",
        devices: [],
      },
    ]),
  );
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIsoTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function validateExternalSignoffs(signoffs, { requireAllComplete = false } = {}) {
  const failures = [];
  if (!signoffs || typeof signoffs !== "object" || Array.isArray(signoffs)) {
    return ["externalSignoffs must be an object"];
  }

  const keys = Object.keys(signoffs);
  for (const key of RELEASE_EXTERNAL_SIGNOFF_KEYS) {
    const signoff = signoffs[key];
    if (!signoff || typeof signoff !== "object" || Array.isArray(signoff)) {
      failures.push(`externalSignoffs.${key} must be an object`);
      continue;
    }
    const expectedFields = ["status", "owner", "completedAt", "evidence", "notes", "devices"];
    const unexpectedFields = Object.keys(signoff).filter(
      (field) => !expectedFields.includes(field),
    );
    const missingFields = expectedFields.filter((field) => !(field in signoff));
    if (missingFields.length > 0) {
      failures.push(`externalSignoffs.${key} is missing ${missingFields.join(", ")}`);
    }
    if (unexpectedFields.length > 0) {
      failures.push(`externalSignoffs.${key} has unknown fields: ${unexpectedFields.join(", ")}`);
    }
    if (!RELEASE_EXTERNAL_SIGNOFF_STATUSES.includes(signoff.status)) {
      failures.push(`externalSignoffs.${key}.status must be pending or complete`);
    }
    if (typeof signoff.owner !== "string") {
      failures.push(`externalSignoffs.${key}.owner must be a string`);
    }
    if (signoff.completedAt !== null && !isIsoTimestamp(signoff.completedAt)) {
      failures.push(`externalSignoffs.${key}.completedAt must be null or an ISO timestamp`);
    }
    if (!isStringArray(signoff.evidence)) {
      failures.push(`externalSignoffs.${key}.evidence must be an array of strings`);
    } else if (signoff.evidence.some((entry) => entry.trim() === "")) {
      failures.push(`externalSignoffs.${key}.evidence cannot contain blank entries`);
    }
    if (typeof signoff.notes !== "string") {
      failures.push(`externalSignoffs.${key}.notes must be a string`);
    }
    if (!isStringArray(signoff.devices)) {
      failures.push(`externalSignoffs.${key}.devices must be an array of strings`);
    } else if (signoff.devices.some((entry) => entry.trim() === "")) {
      failures.push(`externalSignoffs.${key}.devices cannot contain blank entries`);
    }

    if (signoff.status === "complete") {
      if (typeof signoff.owner !== "string" || signoff.owner.trim() === "") {
        failures.push(`externalSignoffs.${key}.owner is required when complete`);
      }
      if (!isIsoTimestamp(signoff.completedAt)) {
        failures.push(`externalSignoffs.${key}.completedAt is required when complete`);
      }
      if (!isStringArray(signoff.evidence) || signoff.evidence.length === 0) {
        failures.push(`externalSignoffs.${key}.evidence is required when complete`);
      }
      if (
        DEVICE_SIGNOFF_KEYS.has(key) &&
        (!isStringArray(signoff.devices) || signoff.devices.length === 0)
      ) {
        failures.push(`externalSignoffs.${key}.devices is required when complete`);
      }
    } else if (requireAllComplete) {
      failures.push(`externalSignoffs.${key} is not complete`);
    }
  }

  const unknownKeys = keys.filter((key) => !RELEASE_EXTERNAL_SIGNOFF_KEYS.includes(key));
  if (unknownKeys.length > 0)
    failures.push(`externalSignoffs has unknown keys: ${unknownKeys.join(", ")}`);
  return failures;
}

export function validateReleaseEvidenceArtifact(
  evidence,
  { requireAllExternalSignoffs = false, requireVerifiedAutomation = false } = {},
) {
  const failures = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["release evidence must be a JSON object"];
  }
  if (evidence.schemaVersion !== 3) failures.push("schemaVersion must be 3");
  if (
    typeof evidence.release?.commit !== "string" ||
    !/^[0-9a-f]{40}$/.test(evidence.release.commit)
  ) {
    failures.push("release.commit must be a full lowercase Git commit SHA");
  }
  if (
    typeof evidence.artifact?.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(evidence.artifact.sha256)
  ) {
    failures.push("artifact.sha256 must be a lowercase SHA-256 digest");
  }
  failures.push(
    ...validateExternalSignoffs(evidence.externalSignoffs, {
      requireAllComplete: requireAllExternalSignoffs,
    }),
  );
  if (requireVerifiedAutomation) {
    try {
      assertVerifiedEvidence(evidence);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return failures;
}

function readGit(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function assertVerifiedEvidence(evidence) {
  const failures = [];
  if (!evidence.release.worktreeClean) failures.push("worktree is not clean");
  if (evidence.release.bunVersion !== evidence.release.expectedBunVersion) {
    failures.push(
      `Bun ${evidence.release.bunVersion} does not match ${evidence.release.expectedBunVersion}`,
    );
  }
  if (evidence.artifact.forbiddenArtifactPaths.length > 0) {
    failures.push("production artifact contains forbidden paths");
  }
  if (evidence.artifact.forbiddenPrecachePaths.length > 0) {
    failures.push("precache contains forbidden paths");
  }
  if (evidence.artifact.totalBytes > ARTIFACT_PERFORMANCE_BUDGETS.distBytes) {
    failures.push("production artifact exceeds its byte budget");
  }
  if (evidence.artifact.initialJsBytes > ARTIFACT_PERFORMANCE_BUDGETS.initialJsBytes) {
    failures.push("initial JavaScript exceeds its byte budget");
  }
  if (evidence.artifact.precacheBytes > ARTIFACT_PERFORMANCE_BUDGETS.precacheBytes) {
    failures.push("precache exceeds its byte budget");
  }
  if (evidence.artifact.precacheEntries > ARTIFACT_PERFORMANCE_BUDGETS.precacheEntries) {
    failures.push("precache exceeds its entry budget");
  }
  if (evidence.artifact.cssBytes > ARTIFACT_PERFORMANCE_BUDGETS.cssBytes) {
    failures.push("CSS exceeds its byte budget");
  }
  if (evidence.artifact.fontBytes > ARTIFACT_PERFORMANCE_BUDGETS.fontBytes) {
    failures.push("fonts exceed their byte budget");
  }
  failures.push(...evidence.provenance.failures);
  if (evidence.automatedGates.some((gate) => gate.status !== "passed-and-bound")) {
    failures.push("automated gates are not bound to this exact artifact");
  }
  if (failures.length > 0) {
    throw new Error(`Cannot assert verified release evidence: ${failures.join("; ")}.`);
  }
}

export function parseReleaseEvidenceArgs(args) {
  const options = {
    format: "json",
    output: "",
    verified: false,
    validate: false,
    input: "",
    requireExternalSignoffs: false,
    requireVerifiedAutomation: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--verified") options.verified = true;
    else if (argument === "--validate") options.validate = true;
    else if (argument === "--input") options.input = args[++index] || "";
    else if (argument === "--require-external-signoffs") options.requireExternalSignoffs = true;
    else if (argument === "--require-verified-automation") options.requireVerifiedAutomation = true;
    else if (argument === "--format") options.format = args[++index] || "json";
    else if (argument === "--output") options.output = args[++index] || "";
  }
  if (!new Set(["json", "markdown"]).has(options.format)) {
    throw new Error(`Unsupported release evidence format: ${options.format}`);
  }
  if (options.validate && !options.input) throw new Error("--validate requires --input <file>");
  return options;
}

export function createRuntimePerformanceEvidence(performanceReport) {
  if (!performanceReport) return null;
  return {
    profile: performanceReport.profile,
    budgets: performanceReport.budgets,
    measurements: performanceReport.measurements,
  };
}

export async function collectReleaseEvidence({ automatedGatesPassed = false } = {}) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = await listArtifactFiles(dist);
  const sizes = new Map();
  for (const file of files) sizes.set(file, (await stat(join(dist, file))).size);
  const initialJsFiles = await collectInitialJsFiles({
    entrypoints: ["app.js", "pwa-install.js"],
    hasFile: async (file) => sizes.has(file),
    readSource: async (file) => readFile(join(dist, file), "utf8"),
  });
  const manifest = JSON.parse(await readFile(join(dist, "precache-manifest.json"), "utf8"));
  const precachePaths = manifest.map((url) => String(url).replace(/^\/+/, ""));
  const forbiddenArtifactPaths = files.filter((file) => isForbiddenProductionArtifactPath(file));
  const forbiddenPrecachePaths = precachePaths.filter((file) =>
    isForbiddenProductionArtifactPath(file),
  );
  const commit = readGit("rev-parse", "HEAD").toLowerCase();
  const bunVersion = process.versions.bun ?? "unknown";
  let buildManifest = null;
  let gateReceipt = null;
  let releaseReportProvenance = null;
  const provenanceFailures = [];
  try {
    buildManifest = JSON.parse(await readFile(join(dist, BUILD_MANIFEST_FILENAME), "utf8"));
    provenanceFailures.push(
      ...validateBuildManifest(buildManifest, {
        version: packageJson.version,
        commit,
        deployBranch: "pwa/prod",
        bunVersion,
      }),
    );
    if (buildManifest?.endpoints?.logApiBaseUrl !== "https://cclogs.ludique.dev") {
      provenanceFailures.push("build manifest telemetry endpoint is not production-approved");
    }
    if (buildManifest?.endpoints?.communityBaseUrl !== "https://colorcatchers.co") {
      provenanceFailures.push("build manifest community endpoint is not production-approved");
    }
    if (buildManifest?.sourceTreeState !== "clean") {
      provenanceFailures.push("build manifest was not created from a clean source tree");
    }
  } catch (error) {
    provenanceFailures.push(`build manifest cannot be read: ${error.message}`);
  }

  const artifactSha256 = await hashArtifact(dist, files);
  if (automatedGatesPassed) {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true") {
      provenanceFailures.push("verified release evidence may only be generated by GitHub Actions");
    }
    try {
      releaseReportProvenance = await collectReleaseReportProvenance({
        root,
        expectedArtifact: {
          sha256: artifactSha256,
          buildId: buildManifest?.buildId,
          commit,
          deployBranch: "pwa/prod",
        },
      });
    } catch (error) {
      provenanceFailures.push(`release reports cannot be independently verified: ${error.message}`);
    }
    try {
      gateReceipt = JSON.parse(await readFile(join(root, RELEASE_GATE_RECEIPT_FILENAME), "utf8"));
      provenanceFailures.push(
        ...validateReleaseGateReceipt(gateReceipt, {
          commit,
          artifactSha256,
          bunVersion,
        }),
      );
      if (JSON.stringify(gateReceipt?.gates) !== JSON.stringify(RELEASE_GATE_COMMANDS)) {
        provenanceFailures.push("release gate receipt commands do not match the release policy");
      }
      if (
        gateReceipt?.ci?.runId !== String(process.env.GITHUB_RUN_ID || "") ||
        gateReceipt?.ci?.runAttempt !== String(process.env.GITHUB_RUN_ATTEMPT || "")
      ) {
        provenanceFailures.push("release gate receipt belongs to another CI run");
      }
    } catch (error) {
      provenanceFailures.push(`release gate receipt cannot be read: ${error.message}`);
    }
    if (releaseReportProvenance) {
      provenanceFailures.push(
        ...compareReleaseReportBindings(gateReceipt?.reports, releaseReportProvenance.bindings),
      );
    }
  }

  const gatesAreBound = automatedGatesPassed && provenanceFailures.length === 0;

  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    release: {
      version: packageJson.version,
      branch: readGit("branch", "--show-current"),
      commit,
      commitShort: readGit("rev-parse", "--short", "HEAD"),
      worktreeClean: readGit("status", "--porcelain") === "",
      bunVersion,
      expectedBunVersion: packageJson.engines?.bun ?? packageJson.packageManager?.split("@").at(-1),
    },
    artifact: {
      sha256: artifactSha256,
      fileCount: files.length,
      totalBytes: [...sizes.values()].reduce((total, size) => total + size, 0),
      initialJsBytes: [...initialJsFiles].reduce(
        (total, file) => total + (sizes.get(file) ?? 0),
        0,
      ),
      initialJsFiles: [...initialJsFiles].sort(),
      cssBytes: files
        .filter((file) => file.endsWith(".css"))
        .reduce((total, file) => total + (sizes.get(file) ?? 0), 0),
      fontBytes: files
        .filter((file) => file.startsWith("assets/fonts/"))
        .reduce((total, file) => total + (sizes.get(file) ?? 0), 0),
      precacheBytes: precachePaths.reduce((total, file) => total + (sizes.get(file) ?? 0), 0),
      precacheEntries: precachePaths.length,
      forbiddenArtifactPaths,
      forbiddenPrecachePaths,
    },
    provenance: {
      buildManifest,
      gateReceipt,
      releaseReports: releaseReportProvenance?.bindings ?? null,
      failures: provenanceFailures,
    },
    performance: createRuntimePerformanceEvidence(releaseReportProvenance?.reports.performance),
    automatedGates: RELEASE_GATE_COMMANDS.map((command) => ({
      command,
      status: gatesAreBound ? "passed-and-bound" : "not-asserted",
    })),
    externalSignoffs: createPendingExternalSignoffs(),
  };
}

export function formatReleaseEvidenceMarkdown(evidence) {
  const lines = [
    "# Paletcam release evidence",
    "",
    `- Generated: ${evidence.generatedAt}`,
    `- Version: ${evidence.release.version}`,
    `- Commit: \`${evidence.release.commit}\``,
    `- Branch: \`${evidence.release.branch}\``,
    `- Worktree clean: ${evidence.release.worktreeClean ? "yes" : "no"}`,
    `- Bun: ${evidence.release.bunVersion}`,
    `- Artifact SHA-256: \`${evidence.artifact.sha256}\``,
    "",
    "## Verified artifact",
    "",
    `- Files: ${evidence.artifact.fileCount}`,
    `- Total: ${evidence.artifact.totalBytes} bytes`,
    `- Initial JavaScript: ${evidence.artifact.initialJsBytes} bytes`,
    `- CSS: ${evidence.artifact.cssBytes} bytes`,
    `- Fonts: ${evidence.artifact.fontBytes} bytes`,
    `- Precache: ${evidence.artifact.precacheBytes} bytes / ${evidence.artifact.precacheEntries} entries`,
    `- Forbidden production files: ${evidence.artifact.forbiddenArtifactPaths.length}`,
    `- Forbidden precache files: ${evidence.artifact.forbiddenPrecachePaths.length}`,
    ...(evidence.performance
      ? [
          "",
          "## Runtime performance",
          "",
          `- Measurements: \`${JSON.stringify(evidence.performance.measurements)}\``,
        ]
      : []),
    "",
    "## Automated gates",
    "",
    ...evidence.automatedGates.map(
      (gate) => `- [${gate.status.startsWith("passed") ? "x" : " "}] \`${gate.command}\``,
    ),
    "",
    "## External sign-offs",
    "",
    ...Object.entries(evidence.externalSignoffs).flatMap(([key, signoff]) => {
      const complete = signoff.status === "complete";
      const detail = complete ? ` — ${signoff.owner} · ${signoff.completedAt}` : " — pending";
      return [
        `- [${complete ? "x" : " "}] ${key}${detail}`,
        ...(signoff.devices.length > 0 ? [`  - Devices: ${signoff.devices.join("; ")}`] : []),
        ...(signoff.evidence.length > 0 ? [`  - Evidence: ${signoff.evidence.join("; ")}`] : []),
        ...(signoff.notes ? [`  - Notes: ${signoff.notes}`] : []),
      ];
    }),
    "",
    "Record device/OS/browser versions, owner, timestamp, evidence links, and any approved exception beside each external sign-off.",
  ];
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const options = parseReleaseEvidenceArgs(Bun.argv.slice(2));
  if (options.validate) {
    const evidence = JSON.parse(await readFile(options.input, "utf8"));
    const failures = validateReleaseEvidenceArtifact(evidence, {
      requireAllExternalSignoffs: options.requireExternalSignoffs,
      requireVerifiedAutomation: options.requireVerifiedAutomation,
    });
    if (failures.length > 0) {
      throw new Error(`Release evidence validation failed: ${failures.join("; ")}.`);
    }
    console.log(`Release evidence is valid: ${options.input}`);
    process.exit(0);
  }
  const evidence = await collectReleaseEvidence({ automatedGatesPassed: options.verified });
  if (options.verified) assertVerifiedEvidence(evidence);
  const output =
    options.format === "markdown"
      ? formatReleaseEvidenceMarkdown(evidence)
      : `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, output, "utf8");
    console.log(`Release evidence written to ${options.output}`);
  } else {
    process.stdout.write(output);
  }
}
