import { describe, expect, test } from "bun:test";
import {
  RELEASE_EXTERNAL_SIGNOFF_KEYS,
  assertVerifiedEvidence,
  createPendingExternalSignoffs,
  createRuntimePerformanceEvidence,
  formatReleaseEvidenceMarkdown,
  parseReleaseEvidenceArgs,
  validateExternalSignoffs,
  validateReleaseEvidenceArtifact,
} from "./release-evidence.js";

function completeSignoffs() {
  const signoffs = createPendingExternalSignoffs();
  for (const key of RELEASE_EXTERNAL_SIGNOFF_KEYS) {
    signoffs[key] = {
      status: "complete",
      owner: "Release Owner",
      completedAt: "2026-07-17T12:00:00.000Z",
      evidence: [`ticket:${key}`],
      notes: "Checked against the release candidate.",
      devices: key.includes("physical") || key.includes("ManualSmoke") ? ["Test device"] : [],
    };
  }
  return signoffs;
}

describe("release evidence", () => {
  test("parses explicit output, format, and verified state", () => {
    expect(
      parseReleaseEvidenceArgs(["--verified", "--format", "markdown", "--output", "release.md"]),
    ).toEqual({
      format: "markdown",
      output: "release.md",
      verified: true,
      validate: false,
      input: "",
      requireExternalSignoffs: false,
      requireVerifiedAutomation: false,
    });
  });

  test("parses strict filled-evidence validation", () => {
    expect(
      parseReleaseEvidenceArgs([
        "--validate",
        "--input",
        "release.json",
        "--require-external-signoffs",
        "--require-verified-automation",
      ]),
    ).toMatchObject({
      validate: true,
      input: "release.json",
      requireExternalSignoffs: true,
      requireVerifiedAutomation: true,
    });
    expect(() => parseReleaseEvidenceArgs(["--validate"])).toThrow("--validate requires --input");
  });

  test("rejects unsupported formats", () => {
    expect(() => parseReleaseEvidenceArgs(["--format", "xml"])).toThrow(
      "Unsupported release evidence format",
    );
  });

  test("formats machine evidence as a human sign-off record", () => {
    const externalSignoffs = createPendingExternalSignoffs();
    const markdown = formatReleaseEvidenceMarkdown({
      generatedAt: "2026-07-12T20:00:00.000Z",
      release: {
        version: "0.1.0",
        commit: "abc123",
        branch: "pwa/preprod",
        worktreeClean: true,
        bunVersion: "1.3.11",
      },
      artifact: {
        sha256: "abc123hash",
        fileCount: 100,
        totalBytes: 1000,
        initialJsBytes: 300,
        cssBytes: 200,
        fontBytes: 100,
        precacheBytes: 900,
        precacheEntries: 90,
        forbiddenArtifactPaths: [],
        forbiddenPrecachePaths: [],
      },
      automatedGates: [{ command: "bun run verify", status: "passed-before-generation" }],
      externalSignoffs,
    });
    expect(markdown).toContain("- [x] `bun run verify`");
    expect(markdown).toContain("- [ ] physicalIosSafariAndPwa");
    expect(markdown).toContain("- [ ] backendIdempotencyEnforcement");
    expect(markdown).toContain("- [ ] exactProductionArtifactManualSmoke");
    expect(markdown).toContain("Initial JavaScript: 300 bytes");
    expect(markdown).toContain("Artifact SHA-256: `abc123hash`");
  });

  test("formats completed sign-off metadata", () => {
    const externalSignoffs = completeSignoffs();
    const markdown = formatReleaseEvidenceMarkdown({
      generatedAt: "2026-07-17T12:00:00.000Z",
      release: {
        version: "0.1.0",
        commit: "abc123",
        branch: "pwa/prod",
        worktreeClean: true,
        bunVersion: "1.3.11",
      },
      artifact: {
        sha256: "abc123hash",
        fileCount: 1,
        totalBytes: 1,
        initialJsBytes: 1,
        cssBytes: 1,
        fontBytes: 1,
        precacheBytes: 1,
        precacheEntries: 1,
        forbiddenArtifactPaths: [],
        forbiddenPrecachePaths: [],
      },
      automatedGates: [],
      externalSignoffs,
    });
    expect(markdown).toContain(
      "- [x] physicalIosSafariAndPwa — Release Owner · 2026-07-17T12:00:00.000Z",
    );
    expect(markdown).toContain("  - Devices: Test device");
    expect(markdown).toContain("  - Evidence: ticket:physicalIosSafariAndPwa");
  });

  test("keeps backend enforcement and exact-artifact smoke in the sign-off contract", () => {
    expect(RELEASE_EXTERNAL_SIGNOFF_KEYS).toContain("backendIdempotencyEnforcement");
    expect(RELEASE_EXTERNAL_SIGNOFF_KEYS).toContain("exactProductionArtifactManualSmoke");
    expect(new Set(RELEASE_EXTERNAL_SIGNOFF_KEYS).size).toBe(RELEASE_EXTERNAL_SIGNOFF_KEYS.length);
  });

  test("creates independent structured pending sign-offs", () => {
    const signoffs = createPendingExternalSignoffs();
    expect(signoffs.physicalIosSafariAndPwa).toEqual({
      status: "pending",
      owner: "",
      completedAt: null,
      evidence: [],
      notes: "",
      devices: [],
    });
    signoffs.physicalIosSafariAndPwa.evidence.push("ticket:1");
    expect(signoffs.physicalAndroidChromeAndPwa.evidence).toEqual([]);
  });

  test("requires complete sign-offs to carry ownership, time, evidence, and devices", () => {
    const signoffs = completeSignoffs();
    expect(validateExternalSignoffs(signoffs, { requireAllComplete: true })).toEqual([]);

    signoffs.physicalIosSafariAndPwa.owner = "";
    signoffs.physicalIosSafariAndPwa.devices = [];
    signoffs.backendIdempotencyEnforcement.status = "pending";
    expect(validateExternalSignoffs(signoffs, { requireAllComplete: true })).toEqual(
      expect.arrayContaining([
        "externalSignoffs.physicalIosSafariAndPwa.owner is required when complete",
        "externalSignoffs.physicalIosSafariAndPwa.devices is required when complete",
        "externalSignoffs.backendIdempotencyEnforcement is not complete",
      ]),
    );
  });

  test("validates the stable filled evidence schema", () => {
    const failures = validateReleaseEvidenceArtifact(
      {
        schemaVersion: 3,
        release: { commit: "a".repeat(40) },
        artifact: { sha256: "b".repeat(64) },
        externalSignoffs: completeSignoffs(),
      },
      { requireAllExternalSignoffs: true },
    );
    expect(failures).toEqual([]);
  });

  test("exposes independently verified runtime measurements", () => {
    const performance = createRuntimePerformanceEvidence({
      profile: { latencyMs: 40 },
      budgets: { appReadyMs: 10_000 },
      measurements: { startup: { appReadyMs: 1_000 } },
    });
    expect(performance).toEqual({
      profile: { latencyMs: 40 },
      budgets: { appReadyMs: 10_000 },
      measurements: { startup: { appReadyMs: 1_000 } },
    });
    expect(createRuntimePerformanceEvidence(null)).toBeNull();
  });

  test("refuses to assert dirty or forbidden release evidence", () => {
    expect(() =>
      assertVerifiedEvidence({
        release: {
          worktreeClean: false,
          bunVersion: "1.3.11",
          expectedBunVersion: "1.3.11",
        },
        artifact: {
          totalBytes: 1,
          initialJsBytes: 1,
          cssBytes: 1,
          fontBytes: 1,
          precacheBytes: 1,
          precacheEntries: 1,
          forbiddenArtifactPaths: ["debug-extraction.html"],
          forbiddenPrecachePaths: [],
        },
        provenance: { failures: ["build manifest commit does not match HEAD"] },
        automatedGates: [{ command: "bun run verify:release", status: "not-asserted" }],
      }),
    ).toThrow("worktree is not clean");
  });

  test("refuses a clean artifact without a matching gate receipt", () => {
    expect(() =>
      assertVerifiedEvidence({
        release: {
          worktreeClean: true,
          bunVersion: "1.3.11",
          expectedBunVersion: "1.3.11",
        },
        artifact: {
          totalBytes: 1,
          initialJsBytes: 1,
          cssBytes: 1,
          fontBytes: 1,
          precacheBytes: 1,
          precacheEntries: 1,
          forbiddenArtifactPaths: [],
          forbiddenPrecachePaths: [],
        },
        provenance: { failures: ["release gate receipt artifact does not match"] },
        automatedGates: [{ command: "bun run verify:release", status: "not-asserted" }],
      }),
    ).toThrow("not bound to this exact artifact");
  });
});
