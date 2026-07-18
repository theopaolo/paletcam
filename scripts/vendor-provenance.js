import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(`Invalid vendored dependency provenance: ${message}`);
}

/**
 * Validates one provenance record against the exact vendored bytes.
 *
 * @param {unknown} candidate
 * @param {Uint8Array} fileBytes
 */
export function verifyVendoredDependency(candidate, fileBytes) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("record must be a JSON object");
  }

  const record = /** @type {Record<string, unknown>} */ (candidate);
  const packageName = String(record.package || "");
  const version = String(record.version || "");
  const expectedSha256 = String(record.sha256 || "").toLowerCase();
  const vendoredPath = String(record.vendoredPath || "");
  const sourceArchivePath = String(record.sourceArchivePath || "");
  const sourceArchiveUrl = String(record.sourceArchiveUrl || "");

  if (record.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!PACKAGE_NAME_PATTERN.test(packageName)) fail("package is invalid");
  if (!VERSION_PATTERN.test(version)) fail("version is invalid");
  if (record.license !== "Apache-2.0") fail("license must be Apache-2.0");
  if (!vendoredPath.startsWith("src/vendor/") || vendoredPath.includes("..")) {
    fail("vendoredPath must stay inside src/vendor");
  }
  if (!sourceArchivePath || sourceArchivePath.includes("..")) {
    fail("sourceArchivePath is invalid");
  }
  if (!SHA256_PATTERN.test(expectedSha256)) fail("sha256 must be 64 lowercase hex characters");

  let archiveUrl;
  try {
    archiveUrl = new URL(sourceArchiveUrl);
  } catch {
    fail("sourceArchiveUrl must be an absolute URL");
  }
  const expectedArchivePath = `/${packageName}/-/${packageName}-${version}.tgz`;
  if (
    archiveUrl.protocol !== "https:" ||
    archiveUrl.hostname !== "registry.npmjs.org" ||
    archiveUrl.pathname !== expectedArchivePath ||
    archiveUrl.search ||
    archiveUrl.hash ||
    archiveUrl.username ||
    archiveUrl.password
  ) {
    fail("sourceArchiveUrl must be the canonical versioned npm archive URL");
  }

  const actualSha256 = createHash("sha256").update(fileBytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    fail(`checksum mismatch for ${vendoredPath}: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const header = new TextDecoder().decode(fileBytes.slice(0, 1024));
  if (!header.includes(`Version ${version}`))
    fail(`source header does not declare version ${version}`);
  if (!header.includes("Apache License Version 2.0")) {
    fail("source header does not declare Apache License Version 2.0");
  }

  return { package: packageName, sha256: actualSha256, vendoredPath, version };
}
