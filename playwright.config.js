import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const reuseDist = Boolean(process.env.PLAYWRIGHT_REUSE_DIST);
const releaseGateSuite = process.env.PLAYWRIGHT_RELEASE_SUITE;
const sourceModuleOnlyTests =
  /switches a live synthetic stream|real extraction worker|worker construction failure|worker runtime failure/;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: true,
  grepInvert: releaseGateSuite === "e2e" ? sourceModuleOnlyTests : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: releaseGateSuite ? 2 : process.env.CI ? 2 : undefined,
  reporter: releaseGateSuite
    ? [
        ["line"],
        ["./scripts/playwright-release-reporter.js", { outputFile: "release-reports/e2e.json" }],
      ]
    : process.env.CI
      ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
      : "list",
  use: {
    baseURL,
    // UI and business-flow tests mock API calls at the page boundary. WebKit
    // can route controlled-page fetches through an active service worker and
    // bypass those mocks, so service-worker behavior is isolated to the
    // dedicated production PWA suite.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // A production release gate may carry the production telemetry URL in
        // its environment. Keep synthetic events on this local test server.
        command: reuseDist
          ? `PORT=${port} bun run scripts/dist-server.js`
          : `PALETCAM_LOG_API_BASE_URL=${baseURL} PORT=${port} bun run scripts/dev-server.js`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
