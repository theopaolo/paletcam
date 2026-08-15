const DEFAULTS = Object.freeze({
  port: 3040,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 240,
  rateLimitMaxBuckets: 10_000,
  pairRateLimitWindowMs: 3_600_000,
  pairRateLimitMax: 5,
  maxMetadataBytes: 64 * 1024,
  maxAssetBytes: 25 * 1024 * 1024,
  maxAccountBytes: 2 * 1024 * 1024 * 1024,
  maxPaletteVersions: 5,
  tombstoneRetentionDays: 30,
});

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

export class SyncServerConfigurationError extends Error {
  constructor(issues) {
    super(`Invalid sync-server configuration:\n- ${issues.join("\n- ")}`);
    this.name = "SyncServerConfigurationError";
    this.issues = issues;
  }
}

export function createSyncServerConfig(env = {}) {
  const issues = [];

  const dataDir = String(env.DATA_DIR || "").trim();
  if (!dataDir) {
    issues.push("DATA_DIR is required and must point at a persistent volume.");
  }

  const config = {
    port: parseInteger(env.PORT, DEFAULTS.port, { key: "PORT", min: 1, max: 65_535 }, issues),
    dataDir,
    environment: String(env.NODE_ENV || "development").trim() || "development",
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS, issues),
    trustProxyHeaders: parseBoolean(env.TRUST_PROXY_HEADERS),
    // Pairing is the only unauthenticated write; disable it once the user's
    // devices hold their recovery codes so the instance stops minting accounts.
    pairingEnabled: env.PAIRING_ENABLED === undefined ? true : parseBoolean(env.PAIRING_ENABLED),
    rateLimitWindowMs: parseInteger(
      env.RATE_LIMIT_WINDOW_MS,
      DEFAULTS.rateLimitWindowMs,
      { key: "RATE_LIMIT_WINDOW_MS", min: 1_000, max: 3_600_000 },
      issues,
    ),
    rateLimitMax: parseInteger(
      env.RATE_LIMIT_MAX,
      DEFAULTS.rateLimitMax,
      { key: "RATE_LIMIT_MAX", min: 1, max: 100_000 },
      issues,
    ),
    rateLimitMaxBuckets: parseInteger(
      env.RATE_LIMIT_MAX_BUCKETS,
      DEFAULTS.rateLimitMaxBuckets,
      { key: "RATE_LIMIT_MAX_BUCKETS", min: 100, max: 10_000 },
      issues,
    ),
    pairRateLimitWindowMs: parseInteger(
      env.PAIR_RATE_LIMIT_WINDOW_MS,
      DEFAULTS.pairRateLimitWindowMs,
      { key: "PAIR_RATE_LIMIT_WINDOW_MS", min: 60_000, max: 86_400_000 },
      issues,
    ),
    pairRateLimitMax: parseInteger(
      env.PAIR_RATE_LIMIT_MAX,
      DEFAULTS.pairRateLimitMax,
      { key: "PAIR_RATE_LIMIT_MAX", min: 1, max: 1_000 },
      issues,
    ),
    maxMetadataBytes: parseInteger(
      env.MAX_METADATA_BYTES,
      DEFAULTS.maxMetadataBytes,
      { key: "MAX_METADATA_BYTES", min: 1_024, max: 10 * 1024 * 1024 },
      issues,
    ),
    maxAssetBytes: parseInteger(
      env.MAX_ASSET_BYTES,
      DEFAULTS.maxAssetBytes,
      { key: "MAX_ASSET_BYTES", min: 1_024, max: 200 * 1024 * 1024 },
      issues,
    ),
    maxAccountBytes: parseInteger(
      env.MAX_ACCOUNT_BYTES,
      DEFAULTS.maxAccountBytes,
      { key: "MAX_ACCOUNT_BYTES", min: 1024 * 1024, max: 64 * 1024 * 1024 * 1024 },
      issues,
    ),
    maxPaletteVersions: parseInteger(
      env.MAX_PALETTE_VERSIONS,
      DEFAULTS.maxPaletteVersions,
      { key: "MAX_PALETTE_VERSIONS", min: 1, max: 20 },
      issues,
    ),
    tombstoneRetentionDays: parseInteger(
      env.TOMBSTONE_RETENTION_DAYS,
      DEFAULTS.tombstoneRetentionDays,
      { key: "TOMBSTONE_RETENTION_DAYS", min: 1, max: 365 },
      issues,
    ),
  };

  if (issues.length > 0) {
    throw new SyncServerConfigurationError(issues);
  }

  return config;
}
