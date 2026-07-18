import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REQUIRED_UNRELEASED_SECTIONS = ["Added", "Changed", "Fixed", "Known limitations"];
const REQUIRED_CHANGELOG_CONTRACTS = [/backup schema/i, /physical iOS/i, /Android Chrome/i];

export function extractCurrentDatabaseSchemaVersion(databaseSource) {
  const versions = [...String(databaseSource || "").matchAll(/\bdb\.version\(\s*(\d+)\s*\)/g)].map(
    (match) => Number(match[1]),
  );
  if (versions.length === 0 || versions.some((version) => !Number.isSafeInteger(version))) {
    throw new Error("palette database source has no valid db.version declaration");
  }
  return Math.max(...versions);
}

function mentionsDatabaseSchemaVersion(changelog, version) {
  const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `database schema\\s+advances\\s+to\\s+version\\s+${escapedVersion}\\b`,
    "i",
  ).test(changelog);
}

export function validateReleaseMetadata({ changelog, packageJson, currentDatabaseSchemaVersion }) {
  const failures = [];
  const version = String(packageJson?.version || "");
  if (!SEMVER_PATTERN.test(version))
    failures.push("package version is not valid semantic versioning");
  if (!/^# Changelog/m.test(changelog)) failures.push("CHANGELOG.md is missing its title");
  if (!/^## \[Unreleased\]/m.test(changelog)) failures.push("CHANGELOG.md is missing Unreleased");
  if (!new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(changelog)) {
    failures.push(`CHANGELOG.md is missing the current ${version} release baseline`);
  }
  for (const section of REQUIRED_UNRELEASED_SECTIONS) {
    if (!new RegExp(`^### ${section}$`, "m").test(changelog)) {
      failures.push(`CHANGELOG.md is missing the ${section} section`);
    }
  }
  for (const contract of REQUIRED_CHANGELOG_CONTRACTS) {
    if (!contract.test(changelog))
      failures.push(`CHANGELOG.md is missing ${contract} release notes`);
  }
  if (!Number.isSafeInteger(currentDatabaseSchemaVersion) || currentDatabaseSchemaVersion < 1) {
    failures.push("current database schema version is unavailable");
  } else if (!mentionsDatabaseSchemaVersion(changelog, currentDatabaseSchemaVersion)) {
    failures.push(
      `CHANGELOG.md does not identify current database schema version ${currentDatabaseSchemaVersion}`,
    );
  }
  return failures;
}

export async function verifyReleaseMetadata(root = process.cwd()) {
  const [packageSource, changelog, databaseSource] = await Promise.all([
    readFile(new URL("package.json", pathToFileURL(`${root}/`)), "utf8"),
    readFile(new URL("CHANGELOG.md", pathToFileURL(`${root}/`)), "utf8"),
    readFile(new URL("src/palette-storage/db.js", pathToFileURL(`${root}/`)), "utf8"),
  ]);
  const currentDatabaseSchemaVersion = extractCurrentDatabaseSchemaVersion(databaseSource);
  const failures = validateReleaseMetadata({
    changelog,
    packageJson: JSON.parse(packageSource),
    currentDatabaseSchemaVersion,
  });
  if (failures.length > 0) throw new Error(`Release metadata failed: ${failures.join("; ")}.`);
  return { currentDatabaseSchemaVersion, version: JSON.parse(packageSource).version };
}

if (import.meta.main) {
  const result = await verifyReleaseMetadata();
  console.log(
    `Release metadata verified for ${result.version} (database schema ${result.currentDatabaseSchemaVersion}).`,
  );
}
