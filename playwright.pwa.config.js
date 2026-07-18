import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PWA_E2E_PORT ?? 4174);
const baseURL = `http://127.0.0.1:${port}`;
const reuseDist = Boolean(process.env.PLAYWRIGHT_REUSE_DIST);
if (!reuseDist && !String(process.env.PALETCAM_LOG_API_BASE_URL || "").trim()) {
  throw new Error(
    "PWA tests build a pwa/prod artifact. Set PALETCAM_LOG_API_BASE_URL to the real CSP-authorized HTTPS telemetry base URL, or set PLAYWRIGHT_REUSE_DIST=1 after building a verified artifact.",
  );
}
const buildCommand = reuseDist ? "" : "PALETCAM_DEPLOY_BRANCH=pwa/prod bun run build && ";
const releaseGateSuite = process.env.PLAYWRIGHT_RELEASE_SUITE;

export default defineConfig({
  testDir: "./tests/pwa",
  outputDir: "./test-results/playwright-pwa",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: releaseGateSuite
    ? [
        ["line"],
        [
          "./scripts/playwright-release-reporter.js",
          { outputFile: `release-reports/${releaseGateSuite}.json` },
        ],
      ]
    : process.env.CI
      ? [["line"], ["html", { outputFolder: "playwright-report-pwa", open: "never" }]]
      : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `${buildCommand}PWA_E2E=1 PORT=${port} bun run scripts/dist-server.js`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
