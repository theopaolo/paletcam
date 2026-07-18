import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { RUNTIME_PERFORMANCE_BUDGETS, RUNTIME_PERFORMANCE_PROFILE } from "./performance-budgets.js";
import { RELEASE_SUITES } from "./release-suite-policy.js";

export const RELEASE_REPORT_CONTRACTS = Object.freeze([
  Object.freeze({
    deployBranch: "pwa/prod",
    path: "release-reports/e2e.json",
    schemaVersion: 3,
    suite: "e2e",
  }),
  Object.freeze({
    deployBranch: "pwa/prod",
    path: "release-reports/pwa.json",
    schemaVersion: 3,
    suite: "pwa",
  }),
  Object.freeze({
    deployBranch: "pwa/preprod",
    path: "release-reports/pwa-preprod.json",
    schemaVersion: 3,
    suite: "pwa-preprod",
  }),
  Object.freeze({
    deployBranch: "pwa/prod",
    path: "release-reports/performance.json",
    schemaVersion: 3,
    suite: "performance",
  }),
]);

export const RELEASE_REPORT_PATHS = Object.freeze(RELEASE_REPORT_CONTRACTS.map(({ path }) => path));
export const RELEASE_REPORT_FILENAMES = Object.freeze(
  RELEASE_REPORT_PATHS.map((reportPath) => basename(reportPath)).sort(),
);

export const PERFORMANCE_MEASUREMENT_KEYS = Object.freeze({
  startup: Object.freeze([
    "appReadyMs",
    "collection250HydrationMs",
    "collection250InitialRenderMs",
    "cssDecodedBytes",
    "domContentLoadedMs",
    "extractionP50Ms",
    "extractionP95Ms",
    "fontDecodedBytes",
    "jsDecodedBytes",
    "loadMs",
    "longTaskCount",
    "maxLongTaskMs",
    "totalLongTaskMs",
  ]),
  criticalJourney: Object.freeze([
    "backupExportMs",
    "backupHighCardinalityBytes",
    "backupHighCardinalityImportMs",
    "backupHighCardinalityMaxEventLoopGapMs",
    "backupHighCardinalityPaletteCount",
    "backupHighCardinalityResponsivenessTicks",
    "backupImportMs",
    "backupRoundTripMs",
    "cameraReadyMs",
    "captureToSaveMs",
    "previewFrameIntervalP95Ms",
    "viewerOpenMs",
  ]),
  serviceWorker: Object.freeze([
    "serviceWorkerInitialControlMs",
    "serviceWorkerUpdateActivationMs",
    "serviceWorkerUpdateInstallMs",
  ]),
});

const PERFORMANCE_BUDGET_BY_METRIC = Object.freeze({
  appReadyMs: "appReadyMs",
  backupExportMs: "backupExportMs",
  backupHighCardinalityImportMs: "backupHighCardinalityImportMs",
  backupHighCardinalityMaxEventLoopGapMs: "backupHighCardinalityMaxEventLoopGapMs",
  backupImportMs: "backupImportMs",
  backupRoundTripMs: "backupRoundTripMs",
  cameraReadyMs: "cameraReadyMs",
  captureToSaveMs: "captureToSaveMs",
  collection250HydrationMs: "collection250HydrationMs",
  collection250InitialRenderMs: "collection250InitialRenderMs",
  domContentLoadedMs: "domContentLoadedMs",
  extractionP95Ms: "extractionP95Ms",
  loadMs: "loadMs",
  maxLongTaskMs: "maxLongTaskMs",
  previewFrameIntervalP95Ms: "previewFrameIntervalP95Ms",
  serviceWorkerInitialControlMs: "serviceWorkerInitialControlMs",
  serviceWorkerUpdateActivationMs: "serviceWorkerUpdateActivationMs",
  serviceWorkerUpdateInstallMs: "serviceWorkerUpdateInstallMs",
  totalLongTaskMs: "totalLongTaskMs",
  viewerOpenMs: "viewerOpenMs",
});

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BUILD_ID_PATTERN = /^[0-9a-f]{20}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class ReleaseReportProvenanceError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ReleaseReportProvenanceError";
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return JSON.stringify(actualKeys) === JSON.stringify([...expectedKeys].sort());
}

function describeSkip(skip) {
  return `${skip?.project ?? ""}::${skip?.file ?? ""}::${skip?.title ?? ""}`;
}

function validatePassedCounts(report, suite, failures) {
  const policy = RELEASE_SUITES[suite];
  const counts = report?.counts;
  if (!policy || !isRecord(counts)) {
    failures.push(`${suite} report counts are missing`);
    return;
  }

  const expectedSkipped = policy.skipped.length;
  const expectedPassed = policy.expectedTests - expectedSkipped;
  const expectedCounts = {
    expected: policy.expectedTests,
    scheduled: policy.expectedTests,
    passed: expectedPassed,
    skipped: expectedSkipped,
    failed: 0,
    flaky: 0,
  };
  if (!hasExactKeys(counts, Object.keys(expectedCounts))) {
    failures.push(`${suite} report count fields do not match the release contract`);
    return;
  }
  for (const [key, expectedValue] of Object.entries(expectedCounts)) {
    if (counts[key] !== expectedValue) {
      failures.push(`${suite} report count ${key} does not match ${expectedValue}`);
    }
  }
}

function validateAllowlistedSkips(report, suite, failures) {
  const policy = RELEASE_SUITES[suite];
  if (!Array.isArray(report?.allowlistedSkips)) {
    failures.push(`${suite} report allowlisted skips are missing`);
    return;
  }
  if (report.allowlistedSkips.some((skip) => !hasExactKeys(skip, ["file", "project", "title"]))) {
    failures.push(`${suite} report allowlisted skip fields do not match the release contract`);
  }
  const actualSkips = report.allowlistedSkips.map(describeSkip).sort();
  const expectedSkips = [...policy.skipped].sort();
  if (JSON.stringify(actualSkips) !== JSON.stringify(expectedSkips)) {
    failures.push(`${suite} report allowlisted skips do not match the release policy`);
  }
}

function validateBaseReport(report, contract, failures) {
  if (!isRecord(report)) {
    failures.push(`${contract.suite} report is not an object`);
    return false;
  }
  if (report.schemaVersion !== contract.schemaVersion) {
    failures.push(`${contract.suite} report schema is not ${contract.schemaVersion}`);
  }
  if (report.suite !== contract.suite) {
    failures.push(`${contract.suite} report identifies another suite`);
  }
  if (report.status !== "passed") {
    failures.push(`${contract.suite} report did not pass`);
  }
  const baseKeys = [
    "allowlistedSkips",
    "artifact",
    "counts",
    "schemaVersion",
    "status",
    "suite",
    "testInventorySha256",
  ];
  const expectedKeys =
    contract.suite === "performance"
      ? [...baseKeys, "budgets", "measurements", "profile"]
      : baseKeys;
  if (!hasExactKeys(report, expectedKeys)) {
    failures.push(`${contract.suite} report fields do not match the release contract`);
  }
  if (
    !SHA256_PATTERN.test(report.testInventorySha256 ?? "") ||
    report.testInventorySha256 !== RELEASE_SUITES[contract.suite]?.testInventorySha256
  ) {
    failures.push(`${contract.suite} report test inventory does not match the release policy`);
  }
  validatePassedCounts(report, contract.suite, failures);
  validateAllowlistedSkips(report, contract.suite, failures);
  return true;
}

function validateExactNumericObject(actual, expected, label, failures) {
  if (!hasExactKeys(actual, Object.keys(expected))) {
    failures.push(`${label} fields do not match the release contract`);
    return;
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      failures.push(`${label} ${key} does not match ${expectedValue}`);
    }
  }
}

function validateArtifactIdentity(actual, expected, expectedDeployBranch, failures) {
  const keys = ["sha256", "buildId", "commit", "deployBranch"];
  if (!hasExactKeys(actual, keys)) {
    failures.push("release report artifact fields do not match the release contract");
    return;
  }
  if (!SHA256_PATTERN.test(actual.sha256)) {
    failures.push("release report artifact sha256 is invalid");
  }
  if (!BUILD_ID_PATTERN.test(actual.buildId)) {
    failures.push("release report artifact buildId is invalid");
  }
  if (!COMMIT_PATTERN.test(actual.commit)) {
    failures.push("release report artifact commit is invalid");
  }
  if (actual.deployBranch !== expectedDeployBranch) {
    failures.push(`release report artifact deployBranch is not ${expectedDeployBranch}`);
  }
  if (expected) {
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && actual[key] !== expectedValue) {
        failures.push(`release report artifact ${key} does not match the expected artifact`);
      }
    }
  }
}

function validateMeasurements(measurements, failures) {
  if (!hasExactKeys(measurements, Object.keys(PERFORMANCE_MEASUREMENT_KEYS))) {
    failures.push("performance measurement groups do not match the release contract");
    return;
  }

  for (const [group, expectedKeys] of Object.entries(PERFORMANCE_MEASUREMENT_KEYS)) {
    const values = measurements[group];
    if (!hasExactKeys(values, expectedKeys)) {
      failures.push(`performance ${group} measurement fields do not match the release contract`);
      continue;
    }
    for (const key of expectedKeys) {
      const value = values[key];
      if (!Number.isFinite(value) || value < 0) {
        failures.push(`performance measurement ${key} is not a finite nonnegative number`);
        continue;
      }
      const budgetKey = PERFORMANCE_BUDGET_BY_METRIC[key];
      if (budgetKey && value > RUNTIME_PERFORMANCE_BUDGETS[budgetKey]) {
        failures.push(
          `performance measurement ${key} exceeds ${RUNTIME_PERFORMANCE_BUDGETS[budgetKey]}`,
        );
      }
    }
  }
}

/**
 * Validates one parsed release report against its suite policy.
 *
 * @param {unknown} report
 * @param {{suite: string, expectedArtifact?: {sha256: string, buildId: string, commit: string}}} options
 * @returns {string[]}
 */
export function validateReleaseReport(report, { suite, expectedArtifact } = {}) {
  const contract = RELEASE_REPORT_CONTRACTS.find((candidate) => candidate.suite === suite);
  if (!contract) return [`unknown release report suite: ${suite}`];

  const failures = [];
  if (!validateBaseReport(report, contract, failures)) return failures;
  validateArtifactIdentity(report.artifact, expectedArtifact, contract.deployBranch, failures);
  if (suite !== "performance") return failures;
  validateExactNumericObject(
    report.profile,
    RUNTIME_PERFORMANCE_PROFILE,
    "performance profile",
    failures,
  );
  validateExactNumericObject(
    report.budgets,
    RUNTIME_PERFORMANCE_BUDGETS,
    "performance budgets",
    failures,
  );
  validateMeasurements(report.measurements, failures);
  return failures;
}

export function hashReleaseReportBytes(rawBytes) {
  return createHash("sha256").update(rawBytes).digest("hex");
}

/**
 * Parses, validates, and hashes one exact report payload.
 *
 * @param {string | Uint8Array} rawBytes
 * @param {{path: string, suite: string, expectedArtifact?: {sha256: string, buildId: string, commit: string}}} options
 */
export function inspectReleaseReportBytes(rawBytes, { path, suite, expectedArtifact } = {}) {
  let report;
  try {
    const source = typeof rawBytes === "string" ? rawBytes : new TextDecoder().decode(rawBytes);
    report = JSON.parse(source);
  } catch (error) {
    throw new ReleaseReportProvenanceError(`${path} is not valid JSON`, { cause: error });
  }
  const failures = validateReleaseReport(report, { suite, expectedArtifact });
  if (failures.length > 0) {
    throw new ReleaseReportProvenanceError(`${path} is invalid: ${failures.join("; ")}.`);
  }
  return {
    binding: {
      path,
      sha256: hashReleaseReportBytes(rawBytes),
      artifact: { ...report.artifact },
    },
    report,
  };
}

async function assertExactReleaseReportDirectory(root, readdirImpl) {
  let actualNames;
  try {
    actualNames = (await readdirImpl(join(root, "release-reports"))).sort();
  } catch (error) {
    throw new ReleaseReportProvenanceError("release-reports directory cannot be read", {
      cause: error,
    });
  }
  if (JSON.stringify(actualNames) !== JSON.stringify(RELEASE_REPORT_FILENAMES)) {
    throw new ReleaseReportProvenanceError(
      `release-reports directory entries do not match the contract: expected ${RELEASE_REPORT_FILENAMES.join(", ")}; found ${actualNames.join(", ") || "none"}`,
    );
  }
}

/**
 * Reads all release reports in the one canonical order used by gate receipts.
 *
 * @param {{root?: string, expectedArtifact?: {sha256: string, buildId: string, commit: string}, readFileImpl?: typeof readFile}} options
 */
export async function collectReleaseReportProvenance({
  root = process.cwd(),
  expectedArtifact,
  readFileImpl = readFile,
  readdirImpl = readdir,
} = {}) {
  const bindings = [];
  const reports = {};

  await assertExactReleaseReportDirectory(root, readdirImpl);

  for (const contract of RELEASE_REPORT_CONTRACTS) {
    let rawBytes;
    try {
      rawBytes = await readFileImpl(join(root, contract.path));
    } catch (error) {
      throw new ReleaseReportProvenanceError(
        `required release report is missing: ${contract.path}`,
        {
          cause: error,
        },
      );
    }
    const inspected = inspectReleaseReportBytes(rawBytes, {
      path: contract.path,
      suite: contract.suite,
      expectedArtifact:
        contract.deployBranch === "pwa/prod"
          ? expectedArtifact
          : {
              commit: expectedArtifact?.commit,
              deployBranch: contract.deployBranch,
            },
    });
    bindings.push(inspected.binding);
    reports[contract.suite] = inspected.report;
  }

  return { bindings, reports };
}

/**
 * Compares receipt bindings with freshly hashed report bytes. Ordering, path
 * cardinality, and every digest are part of the contract.
 *
 * @param {unknown} receiptBindings
 * @param {Array<{path: string, sha256: string}>} currentBindings
 * @returns {string[]}
 */
export function compareReleaseReportBindings(receiptBindings, currentBindings) {
  const failures = [];
  if (!Array.isArray(receiptBindings)) {
    return ["release gate receipt report bindings are missing"];
  }
  if (!Array.isArray(currentBindings)) {
    return ["current release report bindings are missing"];
  }
  if (receiptBindings.length !== RELEASE_REPORT_PATHS.length) {
    failures.push(
      `release gate receipt has ${receiptBindings.length} report bindings; expected ${RELEASE_REPORT_PATHS.length}`,
    );
  }
  if (currentBindings.length !== RELEASE_REPORT_PATHS.length) {
    failures.push(
      `current evidence has ${currentBindings.length} report bindings; expected ${RELEASE_REPORT_PATHS.length}`,
    );
  }

  for (let index = 0; index < RELEASE_REPORT_PATHS.length; index += 1) {
    const expectedPath = RELEASE_REPORT_PATHS[index];
    const receiptBinding = receiptBindings[index];
    const currentBinding = currentBindings[index];
    if (receiptBinding?.path !== expectedPath) {
      failures.push(`release gate receipt report ${index + 1} is not ${expectedPath}`);
    }
    if (currentBinding?.path !== expectedPath) {
      failures.push(`current release report ${index + 1} is not ${expectedPath}`);
    }
    if (!SHA256_PATTERN.test(receiptBinding?.sha256 ?? "")) {
      failures.push(`release gate receipt hash is invalid for ${expectedPath}`);
    }
    if (!SHA256_PATTERN.test(currentBinding?.sha256 ?? "")) {
      failures.push(`current release report hash is invalid for ${expectedPath}`);
    }
    if (!hasExactKeys(receiptBinding, ["artifact", "path", "sha256"])) {
      failures.push(`release gate receipt binding fields are invalid for ${expectedPath}`);
    }
    if (!hasExactKeys(currentBinding, ["artifact", "path", "sha256"])) {
      failures.push(`current release report binding fields are invalid for ${expectedPath}`);
    }
    if (
      typeof receiptBinding?.sha256 === "string" &&
      typeof currentBinding?.sha256 === "string" &&
      receiptBinding.sha256 !== currentBinding.sha256
    ) {
      failures.push(`release report changed after the gate receipt: ${expectedPath}`);
    }
    if (
      isRecord(receiptBinding?.artifact) &&
      isRecord(currentBinding?.artifact) &&
      JSON.stringify(receiptBinding.artifact) !== JSON.stringify(currentBinding.artifact)
    ) {
      failures.push(
        `release report artifact identity changed after the gate receipt: ${expectedPath}`,
      );
    }
  }

  return failures;
}
