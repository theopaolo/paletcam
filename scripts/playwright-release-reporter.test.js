import { describe, expect, test } from "bun:test";
import { RUNTIME_PERFORMANCE_PROFILE } from "./performance-budgets.js";

import {
  collectPerformanceMeasurements,
  createPerformanceReleaseSummary,
  describeFullRunFailure,
  evaluateReleaseSuite,
  serializeReleaseSummary,
} from "./playwright-release-reporter.js";
import { RELEASE_SUITES } from "./release-suite-policy.js";

function createTest({
  file = "/workspace/tests/pwa/example.spec.js",
  outcome = "expected",
  project = "",
  title,
  attachments = [],
  expectedStatus = outcome === "skipped" ? "skipped" : "passed",
  finalStatus = outcome === "expected" ? "passed" : outcome === "skipped" ? "skipped" : "failed",
}) {
  return {
    expectedStatus,
    location: { file },
    outcome: () => outcome,
    parent: { project: () => ({ name: project }) },
    results: [{ attachments, status: finalStatus }],
    title,
  };
}

function createTestFromKey(key, overrides = {}) {
  const [project, file, ...titleParts] = key.split("::");
  return createTest({
    file: `/workspace/${file}`,
    project,
    title: titleParts.join("::"),
    ...overrides,
  });
}

function createSuiteTests(suite) {
  const policy = RELEASE_SUITES[suite];
  return policy.expectedTestKeys.map((key) =>
    createTestFromKey(key, policy.skipped.includes(key) ? { outcome: "skipped" } : {}),
  );
}

function performanceAttachment(name, metrics, overrides = {}) {
  return {
    name,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({ metrics, profile: RUNTIME_PERFORMANCE_PROFILE })),
    ...overrides,
  };
}

function createPerformanceTests() {
  const tests = RELEASE_SUITES.performance.expectedTestKeys.map((key) => createTestFromKey(key));
  const byTitle = new Map(tests.map((test) => [test.title, test]));
  byTitle.get(
    "cold mobile production startup stays within synthetic budgets",
  ).results[0].attachments = [
    performanceAttachment("performance-baseline.json", {
      appReadyMs: 4_000,
      collection250HydrationMs: 1_000,
      collection250InitialRenderMs: 900,
      cssDecodedBytes: 120_000,
      domContentLoadedMs: 3_900,
      extractionP50Ms: 1,
      extractionP95Ms: 2,
      fontDecodedBytes: 146_000,
      jsDecodedBytes: 430_000,
      loadMs: 4_000,
      longTaskCount: 1,
      maxLongTaskMs: 64,
      totalLongTaskMs: 64,
    }),
  ];
  byTitle.get(
    "critical capture, viewer, and backup journeys record synthetic timings",
  ).results[0].attachments = [
    performanceAttachment("critical-journey-performance.json", {
      backupExportMs: 110,
      backupHighCardinalityBytes: 337_306,
      backupHighCardinalityImportMs: 2_100,
      backupHighCardinalityMaxEventLoopGapMs: 60,
      backupHighCardinalityPaletteCount: 1_000,
      backupHighCardinalityResponsivenessTicks: 200,
      backupImportMs: 200,
      backupRoundTripMs: 360,
      cameraReadyMs: 4_400,
      captureToSaveMs: 190,
      previewFrameIntervalP95Ms: 10,
      viewerOpenMs: 1_450,
    }),
  ];
  byTitle.get(
    "initial install and immutable update record synthetic timings",
  ).results[0].attachments = [
    performanceAttachment("service-worker-performance.json", {
      serviceWorkerInitialControlMs: 4_500,
      serviceWorkerUpdateActivationMs: 1_930,
      serviceWorkerUpdateInstallMs: 420,
    }),
  ];
  return tests;
}

describe("Playwright release reporter", () => {
  test("creates deterministic passing PWA evidence with only allowlisted skip metadata", () => {
    const tests = createSuiteTests("pwa");
    tests.find((test) => test.outcome() === "skipped").location.file =
      "/private/build/tests/pwa/offline.spec.js";

    const evaluation = evaluateReleaseSuite("pwa", tests);

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.summary).toEqual({
      schemaVersion: 3,
      suite: "pwa",
      status: "passed",
      counts: {
        expected: 10,
        scheduled: 10,
        passed: 9,
        skipped: 1,
        failed: 0,
        flaky: 0,
      },
      testInventorySha256: RELEASE_SUITES.pwa.testInventorySha256,
      allowlistedSkips: [
        {
          project: "",
          file: "tests/pwa/offline.spec.js",
          title: "preprod debug pages and image corpus remain network-only",
        },
      ],
    });
    expect(serializeReleaseSummary(evaluation.summary)).not.toContain("/private/build");
  });

  test("requires every preprod PWA test without allowlisted skips", () => {
    const tests = createSuiteTests("pwa-preprod");

    const evaluation = evaluateReleaseSuite("pwa-preprod", tests);

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.summary.counts).toEqual({
      expected: 10,
      scheduled: 10,
      passed: 10,
      skipped: 0,
      failed: 0,
      flaky: 0,
    });
  });

  test("retains existing cardinality and flaky-test enforcement in the summary", () => {
    const tests = createSuiteTests("performance");
    tests[0] = createTestFromKey(RELEASE_SUITES.performance.expectedTestKeys[0], {
      outcome: "flaky",
    });
    const evaluation = evaluateReleaseSuite("performance", tests);

    expect(evaluation.failures).toEqual([
      `flaky test: ${RELEASE_SUITES.performance.expectedTestKeys[0]}`,
    ]);
    expect(evaluation.summary.status).toBe("failed");
    expect(evaluation.summary.counts).toEqual({
      expected: 3,
      scheduled: 3,
      passed: 2,
      skipped: 0,
      failed: 0,
      flaky: 1,
    });
  });

  test("rejects a failed test even when suite cardinality is exact", () => {
    const tests = createSuiteTests("performance");
    const failedKey = RELEASE_SUITES.performance.expectedTestKeys[2];
    tests[2] = createTestFromKey(failedKey, { outcome: "unexpected" });
    const evaluation = evaluateReleaseSuite("performance", tests);

    expect(evaluation.failures).toEqual([`failed test: ${failedKey}`]);
    expect(evaluation.summary.status).toBe("failed");
    expect(evaluation.summary.counts).toMatchObject({
      expected: 3,
      scheduled: 3,
      passed: 2,
      failed: 1,
    });
  });

  test("rejects unknown release-suite policies", () => {
    expect(evaluateReleaseSuite("unknown", [])).toBeNull();
  });

  test("fails closed when Playwright reports a run-level failure", () => {
    expect(describeFullRunFailure("passed")).toBeNull();
    expect(describeFullRunFailure("failed")).toBe("Playwright run ended with status failed");
    expect(describeFullRunFailure("interrupted")).toContain("interrupted");
  });

  test("keeps every release policy layer immutable", () => {
    expect(Object.isFrozen(RELEASE_SUITES)).toBe(true);
    expect(Object.isFrozen(RELEASE_SUITES.e2e)).toBe(true);
    expect(Object.isFrozen(RELEASE_SUITES.e2e.expectedTestKeys)).toBe(true);
    expect(Object.isFrozen(RELEASE_SUITES.e2e.skipped)).toBe(true);
    expect(() => RELEASE_SUITES.e2e.skipped.push("unexpected")).toThrow();
  });

  test("rejects expected failures and one-for-one inventory substitutions", () => {
    const expectedFailureTests = createSuiteTests("performance");
    expectedFailureTests[0] = createTestFromKey(RELEASE_SUITES.performance.expectedTestKeys[0], {
      expectedStatus: "failed",
      finalStatus: "failed",
    });
    expect(evaluateReleaseSuite("performance", expectedFailureTests).failures.join("; ")).toContain(
      "non-passing expected status",
    );

    const replacedTests = createSuiteTests("performance");
    replacedTests[0] = createTestFromKey(
      "::tests/performance/startup.spec.js::replacement coverage",
    );
    const failures = evaluateReleaseSuite("performance", replacedTests).failures.join("; ");
    expect(failures).toContain("missing expected test");
    expect(failures).toContain("unexpected scheduled test");
  });

  test("emits a validated schema-3 performance summary from final-result attachments", async () => {
    const tests = createPerformanceTests();
    const base = evaluateReleaseSuite("performance", tests);
    const artifact = {
      sha256: "a".repeat(64),
      buildId: "b".repeat(20),
      commit: "c".repeat(40),
      deployBranch: "pwa/prod",
    };
    const result = await createPerformanceReleaseSummary({
      baseSummary: base.summary,
      tests,
      artifact,
    });

    expect(result.failures).toEqual([]);
    expect(result.summary).toMatchObject({
      schemaVersion: 3,
      suite: "performance",
      status: "passed",
      artifact,
    });
    expect(result.summary.measurements.criticalJourney.viewerOpenMs).toBe(1_450);
  });

  test("fails closed on missing, duplicate, malformed, and non-final attachments", async () => {
    const tests = createPerformanceTests();
    tests[0].results.unshift({
      attachments: [performanceAttachment("performance-baseline.json", { stale: 1 })],
    });
    tests[1].results[0].attachments.push(
      performanceAttachment("critical-journey-performance.json", { duplicate: 1 }),
    );
    tests[2].results[0].attachments[0] = {
      name: "service-worker-performance.json",
      contentType: "application/json",
      body: Buffer.from("not-json"),
    };
    tests[0].results.at(-1).attachments = [];

    const result = await collectPerformanceMeasurements(tests);
    expect(result.failures.join("; ")).toContain("performance-baseline.json appears 0 times");
    expect(result.failures.join("; ")).toContain(
      "critical-journey-performance.json appears 2 times",
    );
    expect(result.failures.join("; ")).toContain(
      "service-worker-performance.json is not valid JSON",
    );
  });
});
