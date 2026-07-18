import { describe, expect, test } from "bun:test";
import { RUNTIME_PERFORMANCE_BUDGETS, RUNTIME_PERFORMANCE_PROFILE } from "./performance-budgets.js";
import {
  RELEASE_REPORT_CONTRACTS,
  RELEASE_REPORT_FILENAMES,
  RELEASE_REPORT_PATHS,
  ReleaseReportProvenanceError,
  collectReleaseReportProvenance,
  compareReleaseReportBindings,
  inspectReleaseReportBytes,
  validateReleaseReport,
} from "./release-report-provenance.js";
import { RELEASE_SUITES } from "./release-suite-policy.js";

const ARTIFACT = Object.freeze({
  sha256: "a".repeat(64),
  buildId: "b".repeat(20),
  commit: "c".repeat(40),
  deployBranch: "pwa/prod",
});

const PREPROD_ARTIFACT = Object.freeze({
  sha256: "d".repeat(64),
  buildId: "e".repeat(20),
  commit: ARTIFACT.commit,
  deployBranch: "pwa/preprod",
});

function expectedSkips(suite) {
  if (suite === "e2e") {
    return [
      {
        project: "mobile-webkit",
        file: "tests/e2e/camera-capture.spec.js",
        title: "captures a synthetic camera frame and persists its palette with photo",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/capture-storage-recovery.spec.js",
        title: "recovers from a quota failure without leaving a partial palette",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/community.spec.js",
        title: "publishes and unpublishes a seeded photo palette through mocked APIs",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/import-export-roundtrip.spec.js",
        title: "exports and restores a collection backup with its photo",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/palette-persistence.spec.js",
        title: "upgrades a real version 1 database and separates its master photo",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/palette-persistence.spec.js",
        title: "upgrades a real version 2 database and separates its master photo",
      },
      {
        project: "mobile-webkit",
        file: "tests/e2e/storage-v4-migration.spec.js",
        title: "upgrades a same-origin version 3 database through the current asset schema",
      },
    ];
  }
  if (suite === "pwa") {
    return [
      {
        project: "",
        file: "tests/pwa/offline.spec.js",
        title: "preprod debug pages and image corpus remain network-only",
      },
    ];
  }
  return [];
}

function createCounts(expected, skipped) {
  return {
    expected,
    scheduled: expected,
    passed: expected - skipped,
    skipped,
    failed: 0,
    flaky: 0,
  };
}

function createSummary(suite) {
  const expected = RELEASE_SUITES[suite].expectedTests;
  const skips = expectedSkips(suite);
  return {
    schemaVersion: 3,
    suite,
    status: "passed",
    counts: createCounts(expected, skips.length),
    allowlistedSkips: skips,
    artifact: { ...(suite === "pwa-preprod" ? PREPROD_ARTIFACT : ARTIFACT) },
    testInventorySha256: RELEASE_SUITES[suite].testInventorySha256,
  };
}

function createPerformanceReport() {
  return {
    ...createSummary("performance"),
    artifact: { ...ARTIFACT },
    profile: { ...RUNTIME_PERFORMANCE_PROFILE },
    budgets: { ...RUNTIME_PERFORMANCE_BUDGETS },
    measurements: {
      startup: {
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
      },
      criticalJourney: {
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
      },
      serviceWorker: {
        serviceWorkerInitialControlMs: 4_500,
        serviceWorkerUpdateActivationMs: 1_930,
        serviceWorkerUpdateInstallMs: 420,
      },
    },
  };
}

function encode(report) {
  return new TextEncoder().encode(`${JSON.stringify(report)}\n`);
}

function createReportBySuite(suite) {
  return suite === "performance" ? createPerformanceReport() : createSummary(suite);
}

describe("release report provenance", () => {
  test("defines the one ordered four-report receipt contract", () => {
    expect(RELEASE_REPORT_PATHS).toEqual([
      "release-reports/e2e.json",
      "release-reports/pwa.json",
      "release-reports/pwa-preprod.json",
      "release-reports/performance.json",
    ]);
  });

  test("collects validated reports and exact raw-byte hashes in canonical order", async () => {
    const bytesByPath = new Map(
      RELEASE_REPORT_CONTRACTS.map((contract) => [
        `/repo/${contract.path}`,
        encode(createReportBySuite(contract.suite)),
      ]),
    );
    const result = await collectReleaseReportProvenance({
      root: "/repo",
      expectedArtifact: ARTIFACT,
      readFileImpl: async (path) => {
        if (!bytesByPath.has(path)) throw new Error("missing");
        return bytesByPath.get(path);
      },
      readdirImpl: async () => [...RELEASE_REPORT_FILENAMES],
    });

    expect(result.bindings.map(({ path }) => path)).toEqual(RELEASE_REPORT_PATHS);
    expect(result.bindings.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256))).toBe(true);
    expect(Object.keys(result.reports)).toEqual(["e2e", "pwa", "pwa-preprod", "performance"]);

    expect(
      inspectReleaseReportBytes(`${JSON.stringify(createSummary("pwa-preprod"))}\n`, {
        path: "release-reports/pwa-preprod.json",
        suite: "pwa-preprod",
      }).report.status,
    ).toBe("passed");
  });

  test("rejects missing, wrong-suite, and failed reports", async () => {
    await expect(
      collectReleaseReportProvenance({
        root: "/repo",
        expectedArtifact: ARTIFACT,
        readFileImpl: async () => {
          throw new Error("ENOENT");
        },
        readdirImpl: async () => [...RELEASE_REPORT_FILENAMES],
      }),
    ).rejects.toBeInstanceOf(ReleaseReportProvenanceError);

    const wrongSuite = createSummary("pwa");
    expect(validateReleaseReport(wrongSuite, { suite: "e2e" })).toContain(
      "e2e report identifies another suite",
    );

    const failed = { ...createSummary("e2e"), status: "failed" };
    expect(validateReleaseReport(failed, { suite: "e2e" })).toContain("e2e report did not pass");
  });

  test("detects extra, missing, reordered, and mutated receipt bindings", () => {
    const current = RELEASE_REPORT_PATHS.map((path, index) => ({
      path,
      sha256: String(index + 1).repeat(64),
      artifact: {
        ...(path.endsWith("pwa-preprod.json") ? PREPROD_ARTIFACT : ARTIFACT),
      },
    }));
    expect(compareReleaseReportBindings(current, current)).toEqual([]);

    expect(compareReleaseReportBindings(current.slice(0, 3), current).join(" ")).toContain(
      "3 report bindings",
    );
    expect(compareReleaseReportBindings([...current, current[0]], current).join(" ")).toContain(
      "5 report bindings",
    );

    const reordered = [current[1], current[0], current[2], current[3]];
    expect(compareReleaseReportBindings(reordered, current).join(" ")).toContain(
      "report 1 is not release-reports/e2e.json",
    );

    const mutated = current.map((binding) => ({ ...binding }));
    mutated[3].sha256 = "f".repeat(64);
    expect(compareReleaseReportBindings(current, mutated)).toContain(
      "release report changed after the gate receipt: release-reports/performance.json",
    );

    const changedArtifact = current.map((binding) => ({
      ...binding,
      artifact: { ...binding.artifact },
    }));
    changedArtifact[2].artifact.buildId = "f".repeat(20);
    expect(compareReleaseReportBindings(current, changedArtifact)).toContain(
      "release report artifact identity changed after the gate receipt: release-reports/pwa-preprod.json",
    );
  });

  test("binds performance evidence to the exact artifact", () => {
    expect(
      validateReleaseReport(createPerformanceReport(), {
        suite: "performance",
        expectedArtifact: ARTIFACT,
      }),
    ).toEqual([]);

    const expectedArtifact = { ...ARTIFACT, sha256: "d".repeat(64) };
    expect(
      validateReleaseReport(createPerformanceReport(), {
        suite: "performance",
        expectedArtifact,
      }),
    ).toContain("release report artifact sha256 does not match the expected artifact");
  });

  test("binds production and preprod reports to distinct branch identities", () => {
    expect(
      validateReleaseReport(createSummary("e2e"), {
        suite: "e2e",
        expectedArtifact: ARTIFACT,
      }),
    ).toEqual([]);
    expect(
      validateReleaseReport(createSummary("pwa-preprod"), {
        suite: "pwa-preprod",
        expectedArtifact: {
          commit: ARTIFACT.commit,
          deployBranch: "pwa/preprod",
        },
      }),
    ).toEqual([]);

    const wrongBranch = createSummary("pwa-preprod");
    wrongBranch.artifact.deployBranch = "pwa/prod";
    expect(validateReleaseReport(wrongBranch, { suite: "pwa-preprod" })).toContain(
      "release report artifact deployBranch is not pwa/preprod",
    );
  });

  test("rejects malformed, nonfinite, and over-budget performance measurements", () => {
    const malformed = createPerformanceReport();
    delete malformed.measurements.startup.appReadyMs;
    expect(validateReleaseReport(malformed, { suite: "performance" })).toContain(
      "performance startup measurement fields do not match the release contract",
    );

    const nonfinite = createPerformanceReport();
    nonfinite.measurements.criticalJourney.viewerOpenMs = Number.NaN;
    expect(validateReleaseReport(nonfinite, { suite: "performance" })).toContain(
      "performance measurement viewerOpenMs is not a finite nonnegative number",
    );

    const overBudget = createPerformanceReport();
    overBudget.measurements.serviceWorker.serviceWorkerUpdateInstallMs =
      RUNTIME_PERFORMANCE_BUDGETS.serviceWorkerUpdateInstallMs + 1;
    expect(validateReleaseReport(overBudget, { suite: "performance" })).toContain(
      `performance measurement serviceWorkerUpdateInstallMs exceeds ${RUNTIME_PERFORMANCE_BUDGETS.serviceWorkerUpdateInstallMs}`,
    );
  });

  test("rejects malformed performance profile, budgets, and raw JSON", () => {
    const wrongProfile = createPerformanceReport();
    wrongProfile.profile.cpuSlowdownRate += 1;
    expect(validateReleaseReport(wrongProfile, { suite: "performance" })).toContain(
      `performance profile cpuSlowdownRate does not match ${RUNTIME_PERFORMANCE_PROFILE.cpuSlowdownRate}`,
    );

    const wrongBudgets = createPerformanceReport();
    wrongBudgets.budgets.viewerOpenMs += 1;
    expect(validateReleaseReport(wrongBudgets, { suite: "performance" })).toContain(
      `performance budgets viewerOpenMs does not match ${RUNTIME_PERFORMANCE_BUDGETS.viewerOpenMs}`,
    );

    expect(() =>
      inspectReleaseReportBytes(new TextEncoder().encode("not-json"), {
        path: "release-reports/performance.json",
        suite: "performance",
      }),
    ).toThrow("is not valid JSON");
  });

  test("rejects extra report fields and a substituted test inventory digest", () => {
    const extraField = { ...createSummary("e2e"), generatedAt: new Date().toISOString() };
    expect(validateReleaseReport(extraField, { suite: "e2e" })).toContain(
      "e2e report fields do not match the release contract",
    );

    const substitutedInventory = createSummary("pwa");
    substitutedInventory.testInventorySha256 = "f".repeat(64);
    expect(validateReleaseReport(substitutedInventory, { suite: "pwa" })).toContain(
      "pwa report test inventory does not match the release policy",
    );
  });

  test("rejects extra release-report directory entries", async () => {
    await expect(
      collectReleaseReportProvenance({
        root: "/repo",
        expectedArtifact: ARTIFACT,
        readFileImpl: async () => encode(createSummary("e2e")),
        readdirImpl: async () => [...RELEASE_REPORT_FILENAMES, "stale.json"],
      }),
    ).rejects.toThrow("directory entries do not match the contract");
  });
});
