import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BUILD_MANIFEST_FILENAME, hashArtifact, listArtifactFiles } from "./build-provenance.js";
import { RUNTIME_PERFORMANCE_BUDGETS, RUNTIME_PERFORMANCE_PROFILE } from "./performance-budgets.js";
import { validateReleaseReport } from "./release-report-provenance.js";
import { RELEASE_SUITES, hashReleaseTestInventory } from "./release-suite-policy.js";

export { RELEASE_SUITES } from "./release-suite-policy.js";

export const PERFORMANCE_ATTACHMENT_GROUPS = Object.freeze({
  "performance-baseline.json": "startup",
  "critical-journey-performance.json": "criticalJourney",
  "service-worker-performance.json": "serviceWorker",
});

function normalizeTestFile(file) {
  return String(file || "")
    .replaceAll("\\", "/")
    .replace(/^.*\/(tests\/)/, "$1");
}

function describeTest(test) {
  const project = test.parent.project()?.name ?? "";
  const file = normalizeTestFile(test.location.file);
  const title = test.title;
  return {
    key: `${project}::${file}::${title}`,
    project,
    file,
    title,
  };
}

function getTestKey(test) {
  return describeTest(test).key;
}

function describeInventoryDifference(expectedKeys, actualKeys) {
  const remaining = new Map();
  for (const key of expectedKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const unexpected = [];
  for (const key of actualKeys) {
    const count = remaining.get(key) ?? 0;
    if (count === 0) unexpected.push(key);
    else remaining.set(key, count - 1);
  }
  const missing = [];
  for (const [key, count] of remaining) {
    for (let index = 0; index < count; index += 1) missing.push(key);
  }
  return { missing: missing.sort(), unexpected: unexpected.sort() };
}

export function evaluateReleaseSuite(suiteName, tests) {
  const policy = RELEASE_SUITES[suiteName];
  if (!policy) return null;

  const failures = [];
  const testOutcomes = tests.map((test) => ({
    test,
    expectedStatus: test.expectedStatus,
    finalStatus: test.results?.at(-1)?.status,
    outcome: test.outcome(),
  }));
  const actualTestKeys = tests.map(getTestKey).sort();
  const inventoryDifference = describeInventoryDifference(policy.expectedTestKeys, actualTestKeys);
  const skippedTests = testOutcomes
    .filter(({ outcome }) => outcome === "skipped")
    .map(({ test }) => describeTest(test))
    .sort((left, right) => left.key.localeCompare(right.key));
  const actualSkipped = new Set(skippedTests.map(({ key }) => key));
  const flaky = testOutcomes
    .filter(({ outcome }) => outcome === "flaky")
    .map(({ test }) => getTestKey(test))
    .sort();
  const failed = testOutcomes
    .filter(({ outcome }) => outcome === "unexpected")
    .map(({ test }) => getTestKey(test))
    .sort();

  if (tests.length !== policy.expectedTests) {
    failures.push(`scheduled ${tests.length} tests; expected ${policy.expectedTests}`);
  }
  for (const missingTest of inventoryDifference.missing) {
    failures.push(`missing expected test: ${missingTest}`);
  }
  for (const unexpectedTest of inventoryDifference.unexpected) {
    failures.push(`unexpected scheduled test: ${unexpectedTest}`);
  }
  for (const expectedSkip of policy.skipped) {
    if (!actualSkipped.has(expectedSkip)) failures.push(`missing expected skip: ${expectedSkip}`);
  }
  for (const { key } of skippedTests) {
    if (!policy.skipped.includes(key)) failures.push(`unexpected skip: ${key}`);
  }
  for (const { test, expectedStatus, finalStatus, outcome } of testOutcomes) {
    if (outcome === "expected" && (expectedStatus !== "passed" || finalStatus !== "passed")) {
      failures.push(
        `non-passing expected status: ${getTestKey(test)} (${expectedStatus ?? "missing"}/${finalStatus ?? "missing"})`,
      );
    }
  }
  for (const failedTest of failed) failures.push(`failed test: ${failedTest}`);
  for (const flakyTest of flaky) failures.push(`flaky test: ${flakyTest}`);

  const counts = {
    expected: policy.expectedTests,
    scheduled: tests.length,
    passed: testOutcomes.filter(({ outcome }) => outcome === "expected").length,
    skipped: skippedTests.length,
    failed: testOutcomes.filter(({ outcome }) => outcome === "unexpected").length,
    flaky: flaky.length,
  };

  return {
    failures,
    summary: {
      schemaVersion: 3,
      suite: suiteName,
      status: failures.length === 0 && counts.failed === 0 ? "passed" : "failed",
      counts,
      testInventorySha256: hashReleaseTestInventory(actualTestKeys),
      allowlistedSkips: skippedTests
        .filter(({ key }) => policy.skipped.includes(key))
        .map(({ key: _key, ...details }) => details),
    },
  };
}

function hasExactKeys(value, expectedKeys) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()),
  );
}

async function readPerformanceAttachment(attachment, readFileImpl) {
  if (attachment.contentType !== "application/json") {
    throw new Error(`${attachment.name} is not an application/json attachment`);
  }
  const rawBytes =
    attachment.body ?? (attachment.path ? await readFileImpl(attachment.path) : null);
  if (!rawBytes) throw new Error(`${attachment.name} has no readable body`);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawBytes).toString("utf8"));
  } catch (error) {
    throw new Error(`${attachment.name} is not valid JSON`, { cause: error });
  }
  if (!hasExactKeys(payload, ["metrics", "profile"])) {
    throw new Error(`${attachment.name} fields do not match the performance attachment contract`);
  }
  if (
    !hasExactKeys(payload.profile, Object.keys(RUNTIME_PERFORMANCE_PROFILE)) ||
    Object.entries(RUNTIME_PERFORMANCE_PROFILE).some(
      ([key, value]) => payload.profile[key] !== value,
    )
  ) {
    throw new Error(`${attachment.name} profile does not match the release performance profile`);
  }
  return payload.metrics;
}

export async function collectPerformanceMeasurements(tests, { readFileImpl = readFile } = {}) {
  const failures = [];
  const attachmentsByName = new Map(
    Object.keys(PERFORMANCE_ATTACHMENT_GROUPS).map((name) => [name, []]),
  );

  for (const test of tests) {
    const finalResult = test.results?.at(-1);
    for (const attachment of finalResult?.attachments ?? []) {
      if (attachmentsByName.has(attachment.name)) {
        attachmentsByName.get(attachment.name).push(attachment);
      }
    }
  }

  const measurements = {};
  for (const [attachmentName, group] of Object.entries(PERFORMANCE_ATTACHMENT_GROUPS)) {
    const attachments = attachmentsByName.get(attachmentName);
    if (attachments.length !== 1) {
      failures.push(
        `${attachmentName} appears ${attachments.length} times in final test results; expected exactly 1`,
      );
      continue;
    }
    try {
      measurements[group] = await readPerformanceAttachment(attachments[0], readFileImpl);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return { failures, measurements };
}

export async function createPerformanceReleaseSummary({
  baseSummary,
  tests,
  artifact,
  readFileImpl = readFile,
}) {
  const collected = await collectPerformanceMeasurements(tests, { readFileImpl });
  const summary = {
    ...baseSummary,
    schemaVersion: 3,
    artifact,
    profile: { ...RUNTIME_PERFORMANCE_PROFILE },
    budgets: { ...RUNTIME_PERFORMANCE_BUDGETS },
    measurements: collected.measurements,
  };
  const validationFailures = validateReleaseReport(
    { ...summary, status: "passed" },
    {
      suite: "performance",
      expectedArtifact: artifact,
    },
  );
  const failures = [...collected.failures, ...validationFailures];
  if (baseSummary.status !== "passed" || failures.length > 0) summary.status = "failed";
  return { failures, summary };
}

async function readReleaseArtifact(root) {
  const dist = join(root, "dist");
  const files = await listArtifactFiles(dist);
  const manifest = JSON.parse(await readFile(join(dist, BUILD_MANIFEST_FILENAME), "utf8"));
  return {
    sha256: await hashArtifact(dist, files),
    buildId: manifest.buildId,
    commit: manifest.commit,
    deployBranch: manifest.deployBranch,
  };
}

export function serializeReleaseSummary(summary) {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function describeFullRunFailure(status) {
  return status === "passed" ? null : `Playwright run ended with status ${status ?? "missing"}`;
}

export default class PlaywrightReleaseReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile;
  }

  onBegin(config, suite) {
    this.listOnly = Boolean(config.listOnly) || process.argv.includes("--list");
    this.suite = suite;
  }

  async onEnd(result) {
    if (this.listOnly) return undefined;

    const suiteName = process.env.PLAYWRIGHT_RELEASE_SUITE;
    const evaluation = evaluateReleaseSuite(suiteName, this.suite?.allTests() ?? []);
    if (!evaluation) {
      return {
        status: "failed",
        startTime: result.startTime,
        duration: result.duration,
      };
    }

    const failures = [...evaluation.failures];
    let summary = evaluation.summary;
    const fullRunFailure = describeFullRunFailure(result.status);
    if (fullRunFailure) failures.push(fullRunFailure);
    try {
      const artifact = await readReleaseArtifact(process.cwd());
      summary = { ...summary, artifact };
      if (suiteName === "performance") {
        const performance = await createPerformanceReleaseSummary({
          baseSummary: summary,
          tests: this.suite?.allTests() ?? [],
          artifact,
        });
        failures.push(...performance.failures);
        summary = performance.summary;
      } else {
        failures.push(
          ...validateReleaseReport(
            { ...summary, status: "passed" },
            {
              suite: suiteName,
              expectedArtifact: artifact,
            },
          ),
        );
      }
    } catch (error) {
      failures.push(`could not bind release report to the release artifact: ${error.message}`);
      summary = { ...summary, schemaVersion: 3, status: "failed" };
    }
    if (failures.length > 0) summary.status = "failed";
    try {
      if (!this.outputFile) throw new Error("release summary output path is not configured");
      await mkdir(dirname(this.outputFile), { recursive: true });
      await writeFile(this.outputFile, serializeReleaseSummary(summary), "utf8");
    } catch (error) {
      failures.push(`could not write release summary: ${error.message}`);
    }

    if (failures.length > 0) {
      console.error(`Release browser policy failed (${suiteName}):\n- ${failures.join("\n- ")}`);
      return {
        status: "failed",
        startTime: result.startTime,
        duration: result.duration,
      };
    }

    console.log(
      `Release browser policy passed (${suiteName}): ${summary.counts.passed} applicable, ${summary.counts.skipped} allowlisted skips.`,
    );
    return undefined;
  }
}
