import { describe, expect, test } from "bun:test";
import { createLogServerConfig, LogServerConfigurationError } from "./config.js";

const productionEnv = {
  NODE_ENV: "production",
  PORT: "3030",
  LOG_DIR: "/var/lib/paletcam-logs",
  ALLOWED_ORIGINS: "https://app.example,https://preprod.example",
  DASHBOARD_USER: "operator",
  DASHBOARD_PASSWORD: "correct-horse-battery-staple",
  PUBLIC_BASE_URL: "https://logs.example",
  TRUST_PROXY_HEADERS: "true",
  RATE_LIMIT_WINDOW_MS: "60000",
  RATE_LIMIT_MAX: "120",
  DASHBOARD_RATE_LIMIT_MAX: "30",
  RATE_LIMIT_MAX_BUCKETS: "5000",
  LOG_WRITE_QUEUE_MAX_PENDING: "750",
  MAX_BODY_BYTES: "16384",
  LOG_RETENTION_DAYS: "30",
  MAX_LOG_FILE_BYTES: "10485760",
};

describe("log server configuration", () => {
  test("normalizes a complete production contract", () => {
    expect(createLogServerConfig(productionEnv)).toMatchObject({
      isProduction: true,
      port: 3030,
      logDir: "/var/lib/paletcam-logs",
      allowedOrigins: ["https://app.example", "https://preprod.example"],
      dashboardEnabled: true,
      dashboardRateLimitMax: 30,
      rateLimitMaxBuckets: 5000,
      logWriteQueueMaxPending: 750,
      trustProxyHeaders: true,
    });
  });

  test("fails production startup with every unsafe missing boundary", () => {
    let error;
    try {
      createLogServerConfig({ NODE_ENV: "production" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LogServerConfigurationError);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        "ALLOWED_ORIGINS is required in production.",
        "LOG_DIR must be explicitly configured in production.",
        "TRUST_PROXY_HEADERS=true is required behind the production TLS proxy.",
      ]),
    );
    expect(error.message).toContain("DASHBOARD_PASSWORD");
    expect(error.message).toContain("PUBLIC_BASE_URL");
  });

  test.each([
    ["DASHBOARD_USER", "replace-with-operator-user"],
    ["DASHBOARD_USER", " REPLACE-WITH-OPERATOR-USER "],
    ["DASHBOARD_PASSWORD", "replace-with-at-least-16-random-characters"],
    ["DASHBOARD_PASSWORD", " REPLACE-WITH-AT-LEAST-16-RANDOM-CHARACTERS "],
  ])("rejects the documented production placeholder for %s", (key, value) => {
    expect(() => createLogServerConfig({ ...productionEnv, [key]: value })).toThrow(
      new RegExp(`${key} must not use the documented placeholder`),
    );
  });

  test("does not apply production placeholder restrictions in development", () => {
    expect(
      createLogServerConfig({
        DASHBOARD_USER: "replace-with-operator-user",
        DASHBOARD_PASSWORD: "replace-with-at-least-16-random-characters",
      }),
    ).toMatchObject({ dashboardEnabled: true, isProduction: false });
  });

  test("rejects malformed origins and unsafe numeric overrides", () => {
    expect(() =>
      createLogServerConfig({
        ALLOWED_ORIGINS: "https://app.example/path,not-a-url",
        MAX_BODY_BYTES: "999999",
        DASHBOARD_RATE_LIMIT_MAX: "0",
        PORT: "0",
        RATE_LIMIT_MAX_BUCKETS: "99",
        LOG_WRITE_QUEUE_MAX_PENDING: "0",
      }),
    ).toThrow(LogServerConfigurationError);
  });

  test("keeps safe development defaults and does not trust proxy headers", () => {
    expect(createLogServerConfig({})).toMatchObject({
      environment: "development",
      isProduction: false,
      port: 3030,
      logDir: "./logs",
      allowedOrigins: [],
      dashboardEnabled: false,
      dashboardRateLimitMax: 30,
      rateLimitMaxBuckets: 10000,
      logWriteQueueMaxPending: 1000,
      trustProxyHeaders: false,
    });
  });
});
