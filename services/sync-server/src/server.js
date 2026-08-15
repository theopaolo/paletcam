import { getConnInfo } from "hono/bun";
import { mkdir } from "node:fs/promises";
import { createAccountRegistry } from "./accounts.js";
import { createSyncApp } from "./app.js";
import { resolveClientIp } from "./client-ip.js";
import { createSyncServerConfig } from "./config.js";
import { createIpRateLimiter } from "./rate-limiter.js";
import { createBackupStore } from "./store.js";

const config = createSyncServerConfig(process.env);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_BUCKET_TTL_MS = Math.max(
  config.rateLimitWindowMs * 5,
  config.pairRateLimitWindowMs,
);

await mkdir(config.dataDir, { recursive: true });

const accounts = createAccountRegistry({ dataDir: config.dataDir });
const store = createBackupStore({
  dataDir: config.dataDir,
  maxPaletteVersions: config.maxPaletteVersions,
  maxAccountBytes: config.maxAccountBytes,
  tombstoneRetentionDays: config.tombstoneRetentionDays,
});
const rateLimiter = createIpRateLimiter({
  bucketTtlMs: RATE_LIMIT_BUCKET_TTL_MS,
  maxBuckets: config.rateLimitMaxBuckets,
  maxRequests: config.rateLimitMax,
  windowMs: config.rateLimitWindowMs,
});
const pairRateLimiter = createIpRateLimiter({
  bucketTtlMs: RATE_LIMIT_BUCKET_TTL_MS,
  maxBuckets: config.rateLimitMaxBuckets,
  maxRequests: config.pairRateLimitMax,
  windowMs: config.pairRateLimitWindowMs,
});

setInterval(() => {
  rateLimiter.prune();
  pairRateLimiter.prune();
}, RATE_LIMIT_BUCKET_TTL_MS).unref?.();

setInterval(() => {
  void store.sweepAllAccounts().catch((error) => {
    console.error("[sync-server] tombstone sweep failed:", error);
  });
}, SWEEP_INTERVAL_MS).unref?.();
await store.sweepAllAccounts();

function getClientIp(c) {
  return resolveClientIp((header) => c.req.header(header), {
    trustProxyHeaders: config.trustProxyHeaders,
    getSocketAddress: () => {
      try {
        return getConnInfo(c).remote?.address ?? "";
      } catch {
        return "";
      }
    },
  });
}

const app = createSyncApp({ config, accounts, store, rateLimiter, pairRateLimiter, getClientIp });

console.log(`[sync-server] listening on :${config.port}`);
console.log(`[sync-server] environment: ${config.environment}`);
console.log(`[sync-server] data dir: ${config.dataDir}`);
console.log(`[sync-server] pairing: ${config.pairingEnabled ? "enabled" : "disabled"}`);
console.log(
  `[sync-server] quota: ${config.maxAccountBytes} bytes/account; asset cap: ${config.maxAssetBytes} bytes`,
);
console.log(`[sync-server] tombstone retention: ${config.tombstoneRetentionDays} days`);
console.log(
  `[sync-server] allowed origins: ${config.allowedOrigins.length > 0 ? config.allowedOrigins.join(", ") : "(none — browser requests rejected)"}`,
);
console.log(
  `[sync-server] proxy headers: ${config.trustProxyHeaders ? "trusted (restrict direct network access)" : "ignored"}`,
);

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});
