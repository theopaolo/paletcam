import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PERFORMANCE_E2E_PORT ?? 4175);
const baseURL = `http://127.0.0.1:${port}`;
const reuseDist = Boolean(process.env.PLAYWRIGHT_REUSE_DIST);
if (!reuseDist && !String(process.env.PALETCAM_LOG_API_BASE_URL || "").trim()) {
  throw new Error(
    "Performance tests build a pwa/prod artifact. Set PALETCAM_LOG_API_BASE_URL to the real CSP-authorized HTTPS telemetry base URL, or set PLAYWRIGHT_REUSE_DIST=1 after building a verified artifact.",
  );
}
const buildCommand = reuseDist ? "" : "PALETCAM_DEPLOY_BRANCH=pwa/prod bun run build && ";
const releaseGateSuite = process.env.PLAYWRIGHT_RELEASE_SUITE;

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: "./test-results/playwright-performance",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: releaseGateSuite
    ? [
        ["line"],
        [
          "./scripts/playwright-release-reporter.js",
          { outputFile: "release-reports/performance.json" },
        ],
      ]
    : process.env.CI
      ? [["line"], ["html", { outputFolder: "playwright-report-performance", open: "never" }]]
      : "list",
  use: {
    ...devices["Pixel 5"],
    baseURL,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `${buildCommand}PWA_E2E=1 PORT=${port} bun run scripts/dist-server.js`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
