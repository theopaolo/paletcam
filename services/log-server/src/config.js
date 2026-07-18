const DEFAULTS = Object.freeze({
  port: 3030,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 120,
  dashboardRateLimitMax: 30,
  rateLimitMaxBuckets: 10_000,
  logWriteQueueMaxPending: 1_000,
  maxBodyBytes: 16_384,
  logRetentionDays: 30,
  maxLogFileBytes: 10 * 1024 * 1024,
});

const KNOWN_PLACEHOLDER_DASHBOARD_USERS = new Set(["replace-with-operator-user"]);
const KNOWN_PLACEHOLDER_DASHBOARD_PASSWORDS = new Set([
  "replace-with-at-least-16-random-characters",
]);

function isKnownPlaceholder(value, placeholders) {
  return placeholders.has(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback, { key, min, max }, issues) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    issues.push(`${key} must be an integer from ${min} to ${max}.`);
    return fallback;
  }
  return parsed;
}

function parseBoolean(value) {
  return /^(?:1|true|yes)$/i.test(String(value || "").trim());
}

function parseAllowedOrigins(value, issues) {
  const origins = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || !new Set(["http:", "https:"]).has(url.protocol)) {
        issues.push(`ALLOWED_ORIGINS entry must be an exact HTTP(S) origin: ${origin}`);
      }
    } catch {
      issues.push(`ALLOWED_ORIGINS contains an invalid URL: ${origin}`);
    }
  }
  return [...new Set(origins)];
}

export class LogServerConfigurationError extends Error {
  constructor(issues) {
    super(`Invalid log-server configuration:\n- ${issues.join("\n- ")}`);
    this.name = "LogServerConfigurationError";
    this.issues = issues;
  }
}

export function createLogServerConfig(env = {}) {
  const issues = [];
  const environment = String(env.LOG_SERVER_ENV || env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  const isProduction = environment === "production";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS, issues);
  const dashboardUser = String(env.DASHBOARD_USER || "").trim();
  const dashboardPassword = String(env.DASHBOARD_PASSWORD || "");
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || "").trim();
  const logDir = String(env.LOG_DIR || "./logs").trim();

  const config = {
    environment,
    isProduction,
    port: parseInteger(env.PORT, DEFAULTS.port, { key: "PORT", min: 1, max: 65_535 }, issues),
    logDir,
    allowedOrigins,
    rateLimitWindowMs: parseInteger(
      env.RATE_LIMIT_WINDOW_MS,
      DEFAULTS.rateLimitWindowMs,
      { key: "RATE_LIMIT_WINDOW_MS", min: 1_000, max: 3_600_000 },
      issues,
    ),
    rateLimitMax: parseInteger(
      env.RATE_LIMIT_MAX,
      DEFAULTS.rateLimitMax,
      { key: "RATE_LIMIT_MAX", min: 1, max: 10_000 },
      issues,
    ),
    dashboardRateLimitMax: parseInteger(
      env.DASHBOARD_RATE_LIMIT_MAX,
      DEFAULTS.dashboardRateLimitMax,
      { key: "DASHBOARD_RATE_LIMIT_MAX", min: 1, max: 1_000 },
      issues,
    ),
    rateLimitMaxBuckets: parseInteger(
      env.RATE_LIMIT_MAX_BUCKETS,
      DEFAULTS.rateLimitMaxBuckets,
      { key: "RATE_LIMIT_MAX_BUCKETS", min: 100, max: 10_000 },
      issues,
    ),
    logWriteQueueMaxPending: parseInteger(
      env.LOG_WRITE_QUEUE_MAX_PENDING,
      DEFAULTS.logWriteQueueMaxPending,
      { key: "LOG_WRITE_QUEUE_MAX_PENDING", min: 1, max: 10_000 },
      issues,
    ),
    maxBodyBytes: parseInteger(
      env.MAX_BODY_BYTES,
      DEFAULTS.maxBodyBytes,
      { key: "MAX_BODY_BYTES", min: 1_024, max: 65_536 },
      issues,
    ),
    logRetentionDays: parseInteger(
      env.LOG_RETENTION_DAYS,
      DEFAULTS.logRetentionDays,
      { key: "LOG_RETENTION_DAYS", min: 1, max: 365 },
      issues,
    ),
    maxLogFileBytes: parseInteger(
      env.MAX_LOG_FILE_BYTES,
      DEFAULTS.maxLogFileBytes,
      { key: "MAX_LOG_FILE_BYTES", min: 1_048_576, max: 104_857_600 },
      issues,
    ),
    dashboardUser,
    dashboardPassword,
    dashboardEnabled: Boolean(dashboardUser && dashboardPassword),
    publicBaseUrl,
    trustProxyHeaders: parseBoolean(env.TRUST_PROXY_HEADERS),
  };

  if (isProduction) {
    if (allowedOrigins.length === 0) issues.push("ALLOWED_ORIGINS is required in production.");
    if (allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
      issues.push("Every production ALLOWED_ORIGINS entry must use HTTPS.");
    }
    if (!env.LOG_DIR || !logDir)
      issues.push("LOG_DIR must be explicitly configured in production.");
    if (!dashboardUser || dashboardUser.length < 3) {
      issues.push("DASHBOARD_USER must contain at least 3 characters in production.");
    }
    if (isKnownPlaceholder(dashboardUser, KNOWN_PLACEHOLDER_DASHBOARD_USERS)) {
      issues.push("DASHBOARD_USER must not use the documented placeholder in production.");
    }
    if (dashboardPassword.length < 16 || dashboardPassword === dashboardUser) {
      issues.push("DASHBOARD_PASSWORD must be at least 16 characters and differ from the user.");
    }
    if (isKnownPlaceholder(dashboardPassword, KNOWN_PLACEHOLDER_DASHBOARD_PASSWORDS)) {
      issues.push("DASHBOARD_PASSWORD must not use the documented placeholder in production.");
    }
    try {
      const url = new URL(publicBaseUrl);
      if (url.protocol !== "https:" || url.origin !== publicBaseUrl) {
        issues.push("PUBLIC_BASE_URL must be an exact HTTPS origin in production.");
      }
    } catch {
      issues.push("PUBLIC_BASE_URL must be an exact HTTPS origin in production.");
    }
    if (!config.trustProxyHeaders) {
      issues.push("TRUST_PROXY_HEADERS=true is required behind the production TLS proxy.");
    }
  }

  if (issues.length > 0) throw new LogServerConfigurationError(issues);
  return Object.freeze(config);
}
