import { describe, expect, test } from "bun:test";
import {
  extractCurrentDatabaseSchemaVersion,
  validateReleaseMetadata,
} from "./verify-release-metadata.js";

const validChangelog = `# Changelog
## [Unreleased]
### Added
Backup schema support.
### Changed
Database schema advances to version 7.
### Fixed
Production fixes.
### Known limitations
Physical iOS and Android Chrome checks remain.
## [1.2.3] - 2026-07-13
Baseline.`;

describe("release metadata policy", () => {
  test("accepts a semantic version with explicit compatibility and device notes", () => {
    expect(
      validateReleaseMetadata({
        changelog: validChangelog,
        packageJson: { version: "1.2.3" },
        currentDatabaseSchemaVersion: 7,
      }),
    ).toEqual([]);
  });

  test("derives the highest explicitly declared database schema version", () => {
    expect(
      extractCurrentDatabaseSchemaVersion(
        `db.version(1).stores({});\n db.version(7)\n  .stores({});`,
      ),
    ).toBe(7);
    expect(() => extractCurrentDatabaseSchemaVersion("const version = 7;")).toThrow(
      "no valid db.version declaration",
    );
  });

  test("rejects release notes that name a stale database schema", () => {
    const staleChangelog = `${validChangelog.replace("advances to version 7", "advances to version 6")}\nDatabase schema version 7 is documented elsewhere.`;
    expect(
      validateReleaseMetadata({
        changelog: staleChangelog,
        packageJson: { version: "1.2.3" },
        currentDatabaseSchemaVersion: 7,
      }),
    ).toContain("CHANGELOG.md does not identify current database schema version 7");
  });

  test("rejects invalid versions and incomplete release notes", () => {
    const failures = validateReleaseMetadata({
      changelog: "# Changelog",
      packageJson: { version: "v1" },
      currentDatabaseSchemaVersion: 7,
    });
    expect(failures).toContain("package version is not valid semantic versioning");
    expect(failures.length).toBeGreaterThan(4);
  });
});
