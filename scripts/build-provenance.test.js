import { describe, expect, test } from "bun:test";
import {
  createBuildManifest,
  createReleaseGateReceipt,
  normalizeCommitHash,
  validateBuildManifest,
  validateReleaseGateReceipt,
} from "./build-provenance.js";

describe("build provenance", () => {
  const commit = "a".repeat(40);
  const artifactSha256 = "f".repeat(64);
  const reports = ["e2e", "pwa", "pwa-preprod", "performance"].map((suite, index) => ({
    path: `release-reports/${suite}.json`,
    sha256: String(index + 1).repeat(64),
    artifact:
      suite === "pwa-preprod"
        ? {
            sha256: "d".repeat(64),
            buildId: "e".repeat(20),
            commit,
            deployBranch: "pwa/preprod",
          }
        : {
            sha256: artifactSha256,
            buildId: "b".repeat(20),
            commit,
            deployBranch: "pwa/prod",
          },
  }));
  test("normalizes valid commit hashes and rejects ambiguous production identity", () => {
    expect(normalizeCommitHash("ABCDEF1234567")).toBe("abcdef1234567");
    expect(normalizeCommitHash("a".repeat(40), { required: true, full: true })).toBe(
      "a".repeat(40),
    );
    expect(() => normalizeCommitHash("abcdef1234567", { required: true, full: true })).toThrow(
      "full 40- or 64-character",
    );
    expect(() => normalizeCommitHash("release-latest", { required: true })).toThrow(
      "7-64 hexadecimal",
    );
    expect(() => normalizeCommitHash("", { required: true })).toThrow("required");
    expect(normalizeCommitHash("")).toBe("unknown");
  });

  test("creates deterministic build metadata without a timestamp", () => {
    const input = {
      version: "0.1.0",
      commit: "a".repeat(40),
      deployBranch: "pwa/prod",
      bunVersion: "1.3.11",
      buildId: "content-id",
      sourceTreeState: "clean",
      logApiBaseUrl: "https://cclogs.ludique.dev",
      communityBaseUrl: "",
    };
    expect(createBuildManifest(input)).toEqual(createBuildManifest(input));
    expect(createBuildManifest(input)).not.toHaveProperty("generatedAt");
    expect(createBuildManifest(input).commitShort).toBe("aaaaaaaaaaaa");
  });

  test("finds stale or internally inconsistent build metadata", () => {
    const manifest = createBuildManifest({
      version: "0.1.0",
      commit: "a".repeat(40),
      deployBranch: "pwa/prod",
      bunVersion: "1.3.11",
      buildId: "content-id",
      sourceTreeState: "clean",
      logApiBaseUrl: "https://cclogs.ludique.dev",
      communityBaseUrl: "",
    });
    expect(validateBuildManifest(manifest, { commit: "a".repeat(40) })).toEqual([]);
    expect(validateBuildManifest({ ...manifest, commitShort: "wrong" })).toContain(
      "build manifest short commit does not match its full commit",
    );
    expect(validateBuildManifest(manifest, { commit: "1234567" })).toContain(
      "build manifest commit does not match 1234567",
    );
  });

  test("binds gate receipts to an exact commit, runtime, and artifact", () => {
    const receipt = createReleaseGateReceipt({
      commit,
      artifactSha256,
      bunVersion: "1.3.11",
      gates: ["bun run verify:release"],
      recordedAt: "2026-07-13T12:00:00.000Z",
      ci: { provider: "github-actions", runId: "123", runAttempt: "1" },
      reports,
    });
    expect(
      validateReleaseGateReceipt(receipt, {
        commit,
        artifactSha256,
        bunVersion: "1.3.11",
      }),
    ).toEqual([]);
    expect(validateReleaseGateReceipt(receipt, { artifactSha256: "changed" })).toContain(
      "release gate receipt artifactSha256 does not match changed",
    );
    expect(validateReleaseGateReceipt({ ...receipt, ci: null })).toContain(
      "release gate receipt has no trusted CI run context",
    );
    expect(validateReleaseGateReceipt({ ...receipt, reports: reports.slice(1) })).toContain(
      "release gate receipt report bindings are missing or incomplete",
    );
    expect(
      validateReleaseGateReceipt({
        ...receipt,
        reports: [reports[1], reports[0], ...reports.slice(2)],
      }),
    ).toContain("release gate receipt report 1 is not release-reports/e2e.json");
    const wrongPreprod = reports.map((binding) => ({
      ...binding,
      artifact: { ...binding.artifact },
    }));
    wrongPreprod[2].artifact.deployBranch = "pwa/prod";
    expect(validateReleaseGateReceipt({ ...receipt, reports: wrongPreprod })).toContain(
      "release gate receipt report deployBranch is not pwa/preprod for release-reports/pwa-preprod.json",
    );
  });
});
