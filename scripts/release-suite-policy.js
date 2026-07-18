import { createHash } from "node:crypto";

/**
 * Update path for an intentional browser-suite change:
 *
 * 1. Run the matching release command with `--list`, for example:
 *    `PLAYWRIGHT_RELEASE_SUITE=e2e bunx playwright test --list` or
 *    `PLAYWRIGHT_REUSE_DIST=1 PLAYWRIGHT_RELEASE_SUITE=pwa bunx playwright
 *    test --config playwright.pwa.config.js --list` (substitute the suite and
 *    configuration for preprod/performance).
 * 2. Copy the normalized `project::tests/...::title` identities into the
 *    relevant inventory below.
 * 3. Run `bun test scripts/playwright-release-reporter.test.js
 *    scripts/release-report-provenance.test.js`.
 *
 * The reporter also prints exact missing/unexpected identities when this
 * inventory is stale, so a changed count alone can never approve new coverage.
 */

export function hashReleaseTestInventory(testKeys) {
  const canonical = [...testKeys].sort().join("\n");
  return createHash("sha256").update(canonical).update("\n").digest("hex");
}

function defineSuite(expectedTestKeys, allowlistedSkipKeys = []) {
  const inventory = Object.freeze([...expectedTestKeys].sort());
  const skips = Object.freeze([...allowlistedSkipKeys].sort());
  return Object.freeze({
    expectedTestKeys: inventory,
    expectedTests: inventory.length,
    skipped: skips,
    testInventorySha256: hashReleaseTestInventory(inventory),
  });
}

const E2E_TITLES = Object.freeze([
  "tests/e2e/accessibility.spec.js::collection dialog traps focus and Escape restores its opener",
  "tests/e2e/accessibility.spec.js::viewer exposes named actions, contains focus, and restores the capture trigger",
  "tests/e2e/app-boot.spec.js::boots into a usable shell when camera permission is denied",
  "tests/e2e/camera-capture.spec.js::captures a synthetic camera frame and persists its palette with photo",
  "tests/e2e/camera-lifecycle.spec.js::recovers after denial and applies the platform background policy",
  "tests/e2e/capture-storage-recovery.spec.js::recovers from a quota failure without leaving a partial palette",
  "tests/e2e/community.spec.js::login reports a mocked API failure, then persists a verified session",
  "tests/e2e/community.spec.js::publishes and unpublishes a seeded photo palette through mocked APIs",
  "tests/e2e/community.spec.js::retains a failed cleanup outbox across reload and flushes it after reconnect",
  "tests/e2e/delete-undo.spec.js::an expired deletion removes metadata and its master photo across reload",
  "tests/e2e/delete-undo.spec.js::app teardown cancels a staged deletion without losing durable data",
  "tests/e2e/delete-undo.spec.js::bulk selection commits several deletions through the bounded runner",
  "tests/e2e/delete-undo.spec.js::cancelling a running bulk deletion preserves work that has not started",
  "tests/e2e/delete-undo.spec.js::swiping the undo toast commits the staged deletion across reload",
  "tests/e2e/delete-undo.spec.js::undo restores a staged local deletion without losing metadata or image assets",
  "tests/e2e/import-export-roundtrip.spec.js::exports and restores a collection backup with its photo",
  "tests/e2e/import-failure.spec.js::rejects a corrupt backup without changing the collection",
  "tests/e2e/palette-persistence.spec.js::renders an IndexedDB palette again after a full reload",
  "tests/e2e/palette-persistence.spec.js::startup maintenance atomically freezes legacy render settings",
  "tests/e2e/palette-persistence.spec.js::upgrades a real version 1 database and separates its master photo",
  "tests/e2e/palette-persistence.spec.js::upgrades a real version 2 database and separates its master photo",
  "tests/e2e/storage-v4-migration.spec.js::upgrades a same-origin version 3 database through the current asset schema",
]);

const E2E_TESTS = Object.freeze(
  ["chromium", "mobile-webkit"].flatMap((project) =>
    E2E_TITLES.map((identity) => `${project}::${identity}`),
  ),
);

const PWA_TESTS = Object.freeze(
  [
    "installs a bounded app shell without debug resources and reloads offline",
    "activation removes only older Paletcam caches",
    "does not runtime-cache same-origin resources outside the manifest",
    "does not cache query-bearing variants of allowlisted resources",
    "keeps direct document navigations from poisoning the cached app shell",
    "preprod debug pages and image corpus remain network-only",
    "does not activate or retain a partial cache when required app code fails",
    "still activates when an optional precache asset fails",
    "keeps an updated worker waiting until the user accepts activation",
    "defers user-approved activation until an active capture finishes",
  ].map((title) => `::tests/pwa/offline.spec.js::${title}`),
);

const PERFORMANCE_TESTS = Object.freeze([
  "::tests/performance/startup.spec.js::cold mobile production startup stays within synthetic budgets",
  "::tests/performance/startup.spec.js::critical capture, viewer, and backup journeys record synthetic timings",
  "::tests/performance/startup.spec.js::initial install and immutable update record synthetic timings",
]);

const E2E_SKIPS = Object.freeze([
  "mobile-webkit::tests/e2e/camera-capture.spec.js::captures a synthetic camera frame and persists its palette with photo",
  "mobile-webkit::tests/e2e/capture-storage-recovery.spec.js::recovers from a quota failure without leaving a partial palette",
  "mobile-webkit::tests/e2e/community.spec.js::publishes and unpublishes a seeded photo palette through mocked APIs",
  "mobile-webkit::tests/e2e/import-export-roundtrip.spec.js::exports and restores a collection backup with its photo",
  "mobile-webkit::tests/e2e/palette-persistence.spec.js::upgrades a real version 1 database and separates its master photo",
  "mobile-webkit::tests/e2e/palette-persistence.spec.js::upgrades a real version 2 database and separates its master photo",
  "mobile-webkit::tests/e2e/storage-v4-migration.spec.js::upgrades a same-origin version 3 database through the current asset schema",
]);

export const RELEASE_SUITES = Object.freeze({
  e2e: defineSuite(E2E_TESTS, E2E_SKIPS),
  performance: defineSuite(PERFORMANCE_TESTS),
  pwa: defineSuite(PWA_TESTS, [
    "::tests/pwa/offline.spec.js::preprod debug pages and image corpus remain network-only",
  ]),
  "pwa-preprod": defineSuite(PWA_TESTS),
});
