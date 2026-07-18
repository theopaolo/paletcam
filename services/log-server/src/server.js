import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";
import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createBoundedWriteQueue } from "./bounded-write-queue.js";
import { createLogServerConfig } from "./config.js";
import { resolveClientIp } from "./client-ip.js";
import { createDashboardSecurityHeaders } from "./dashboard-security.js";
import { probeLogDirectoryWritable } from "./log-directory-probe.js";
import { readDailyLogEntries } from "./log-reader.js";
import { pruneExpiredLogFiles, rotateLogFileIfNeeded } from "./log-retention.js";
import { sanitizeLogPayload } from "./log-sanitize.js";
import { createIpRateLimiter } from "./rate-limiter.js";
import { readBoundedRequestText, RequestBodyTooLargeError } from "./request-body.js";

const config = createLogServerConfig(process.env);
const {
  allowedOrigins: ALLOWED_ORIGINS,
  dashboardRateLimitMax: DASHBOARD_RATE_LIMIT_MAX,
  dashboardEnabled: DASHBOARD_ENABLED,
  dashboardPassword: DASHBOARD_PASSWORD,
  dashboardUser: DASHBOARD_USER,
  environment: ENVIRONMENT,
  logDir: LOG_DIR,
  logRetentionDays: LOG_RETENTION_DAYS,
  logWriteQueueMaxPending: LOG_WRITE_QUEUE_MAX_PENDING,
  maxBodyBytes: MAX_BODY_BYTES,
  maxLogFileBytes: MAX_LOG_FILE_BYTES,
  port: PORT,
  rateLimitMax: RATE_LIMIT_MAX,
  rateLimitMaxBuckets: RATE_LIMIT_MAX_BUCKETS,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  trustProxyHeaders: TRUST_PROXY_HEADERS,
} = config;
const LOG_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_READINESS_INTERVAL_MS = 30_000;
const RATE_LIMIT_BUCKET_TTL_MS = RATE_LIMIT_WINDOW_MS * 5;
const LOGS_QUERY_MAX_LIMIT = 20_000;
const LOGS_QUERY_DEFAULT_LIMIT = 5_000;

const rateLimiter = createIpRateLimiter({
  bucketTtlMs: RATE_LIMIT_BUCKET_TTL_MS,
  maxBuckets: RATE_LIMIT_MAX_BUCKETS,
  maxRequests: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
});
const dashboardRateLimiter = createIpRateLimiter({
  bucketTtlMs: RATE_LIMIT_BUCKET_TTL_MS,
  maxBuckets: RATE_LIMIT_MAX_BUCKETS,
  maxRequests: DASHBOARD_RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
});
const logWriteQueue = createBoundedWriteQueue({ maxPending: LOG_WRITE_QUEUE_MAX_PENDING });
let logWriteHealthy = true;
let lastLogWriteErrorAt = null;
let logDirectoryWritable = true;
let lastLogDirectoryErrorAt = null;
let logDirectoryProbeInFlight = false;

setInterval(() => {
  rateLimiter.prune();
  dashboardRateLimiter.prune();
}, RATE_LIMIT_BUCKET_TTL_MS).unref?.();

function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `${today}.jsonl`);
}

function getClientIp(c) {
  return resolveClientIp((header) => c.req.header(header), {
    trustProxyHeaders: TRUST_PROXY_HEADERS,
    getSocketAddress: () => {
      try {
        return getConnInfo(c).remote?.address ?? "";
      } catch {
        return "";
      }
    },
  });
}

await mkdir(LOG_DIR, { recursive: true });
await probeLogDirectoryWritable(LOG_DIR);
await pruneExpiredLogFiles(LOG_DIR, { retentionDays: LOG_RETENTION_DAYS });

async function refreshLogDirectoryReadiness() {
  if (logDirectoryProbeInFlight) return;
  logDirectoryProbeInFlight = true;
  try {
    await probeLogDirectoryWritable(LOG_DIR);
    if (!logDirectoryWritable) {
      console.info("[log-server] log directory readiness recovered");
    }
    logDirectoryWritable = true;
    lastLogDirectoryErrorAt = null;
  } catch (error) {
    if (logDirectoryWritable) {
      console.error("[log-server] log directory readiness probe failed:", error);
    }
    logDirectoryWritable = false;
    lastLogDirectoryErrorAt = new Date().toISOString();
  } finally {
    logDirectoryProbeInFlight = false;
  }
}

setInterval(() => void refreshLogDirectoryReadiness(), LOG_READINESS_INTERVAL_MS).unref?.();

setInterval(() => {
  void pruneExpiredLogFiles(LOG_DIR, { retentionDays: LOG_RETENTION_DAYS }).catch((error) => {
    console.error("[log-server] retention cleanup failed:", error);
  });
}, LOG_MAINTENANCE_INTERVAL_MS).unref?.();

const app = new Hono();

app.use(
  "/clientlog",
  cors({
    origin: (origin) => {
      if (!origin) {
        return null;
      }
      return ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 600,
  }),
);

app.get("/health", (c) => {
  const logWriteQueueSaturated = logWriteQueue.isSaturated();
  const healthy = logWriteHealthy && logDirectoryWritable && !logWriteQueueSaturated;
  return c.json(
    {
      ok: healthy,
      logWriteHealthy,
      logDirectoryWritable,
      lastLogWriteErrorAt,
      lastLogDirectoryErrorAt,
      logWriteQueuePending: logWriteQueue.getPendingCount(),
      logWriteQueueMaxPending: logWriteQueue.getMaxPending(),
      logWriteQueueSaturated,
      retentionDays: LOG_RETENTION_DAYS,
      environment: ENVIRONMENT,
    },
    healthy ? 200 : 503,
  );
});

const dashboardHtml = (() => {
  try {
    return readFileSync(new URL("./dashboard.html", import.meta.url), "utf8");
  } catch (error) {
    console.warn("[log-server] dashboard.html not found:", error.message);
    return "";
  }
})();

const dashboardAuth = DASHBOARD_ENABLED
  ? basicAuth({ username: DASHBOARD_USER, password: DASHBOARD_PASSWORD })
  : (c) => c.json({ ok: false, error: "dashboard_disabled" }, 503);

async function dashboardRateLimit(c, next) {
  if (!dashboardRateLimiter.isRateLimited(getClientIp(c))) return next();

  c.header("Retry-After", String(Math.max(1, Math.ceil(RATE_LIMIT_WINDOW_MS / 1_000))));
  return c.json({ ok: false, error: "rate_limited" }, 429);
}

const dashboardSecurityHeaders = createDashboardSecurityHeaders({
  production: ENVIRONMENT === "production",
});
for (const route of ["/dashboard", "/logs"]) {
  app.use(route, async (c, next) => {
    for (const [name, value] of Object.entries(dashboardSecurityHeaders)) c.header(name, value);
    await next();
  });
}

app.get("/dashboard", dashboardRateLimit, dashboardAuth, (c) => {
  if (!dashboardHtml) {
    return c.json({ ok: false, error: "dashboard_unavailable" }, 500);
  }
  return c.html(dashboardHtml);
});

app.get("/logs", dashboardRateLimit, dashboardAuth, async (c) => {
  const requestedDate = c.req.query("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return c.json({ ok: false, error: "invalid_date" }, 400);
  }

  const requestedLimit = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, LOGS_QUERY_MAX_LIMIT)
      : LOGS_QUERY_DEFAULT_LIMIT;

  try {
    const { entries, totalLines } = await readDailyLogEntries(LOG_DIR, requestedDate, { limit });

    return c.json({
      ok: true,
      date: requestedDate,
      totalLines,
      returned: entries.length,
      entries,
    });
  } catch (error) {
    console.error("[log-server] /logs read failed:", error);
    return c.json({ ok: false, error: "read_failed" }, 500);
  }
});

app.post("/clientlog", async (c) => {
  const origin = c.req.header("origin") || "";
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ ok: false, error: "origin_not_allowed" }, 403);
  }

  const ip = getClientIp(c);
  if (rateLimiter.isRateLimited(ip)) {
    return c.json({ ok: false, error: "rate_limited" }, 429);
  }

  const declaredBodyBytes = Number(c.req.header("content-length"));
  if (Number.isFinite(declaredBodyBytes) && declaredBodyBytes > MAX_BODY_BYTES) {
    return c.json({ ok: false, error: "body_too_large" }, 413);
  }

  let rawText;
  try {
    rawText = await readBoundedRequestText(c.req.raw, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return c.json({ ok: false, error: "body_too_large" }, 413);
    }
    return c.json({ ok: false, error: "body_read_failed" }, 400);
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ ok: false, error: "invalid_payload" }, 400);
  }

  const sanitizedPayload = sanitizeLogPayload(body);
  if (!sanitizedPayload) {
    return c.json({ ok: false, error: "unknown_event" }, 400);
  }
  const entry = {
    ts: new Date().toISOString(),
    ip,
    origin,
    message: sanitizedPayload.message,
    context: sanitizedPayload.context,
  };

  const pendingWrite = logWriteQueue.tryEnqueue(async () => {
    const logFilePath = getLogFilePath();
    await rotateLogFileIfNeeded(logFilePath, MAX_LOG_FILE_BYTES);
    await appendFile(logFilePath, `${JSON.stringify(entry)}\n`);
    logWriteHealthy = true;
    lastLogWriteErrorAt = null;
  });
  if (!pendingWrite) {
    c.header("Retry-After", "1");
    return c.json({ ok: false, error: "write_queue_saturated" }, 503);
  }

  try {
    await pendingWrite;
  } catch (error) {
    logWriteHealthy = false;
    lastLogWriteErrorAt = new Date().toISOString();
    console.error("[log-server] write failed:", error);
    return c.json({ ok: false, error: "write_failed" }, 500);
  }

  return c.json({ ok: true });
});

console.log(`[log-server] listening on :${PORT}`);
console.log(`[log-server] environment: ${ENVIRONMENT}`);
console.log(`[log-server] log dir: ${LOG_DIR}`);
console.log(
  `[log-server] retention: ${LOG_RETENTION_DAYS} days; max daily segment: ${MAX_LOG_FILE_BYTES} bytes`,
);
console.log(`[log-server] max pending writes: ${LOG_WRITE_QUEUE_MAX_PENDING}`);
console.log(
  `[log-server] allowed origins: ${ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.join(", ") : "(none — all POSTs rejected)"}`,
);
console.log(
  `[log-server] dashboard: ${DASHBOARD_ENABLED ? "enabled (basic auth)" : "disabled (set DASHBOARD_USER + DASHBOARD_PASSWORD)"}`,
);
console.log(
  `[log-server] proxy headers: ${TRUST_PROXY_HEADERS ? "trusted (restrict direct network access)" : "ignored"}`,
);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
});
