import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = Number(process.env.PORT) || 3030;
const LOG_DIR = process.env.LOG_DIR || "./logs";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 120;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 16_384;
const RATE_LIMIT_BUCKET_TTL_MS = RATE_LIMIT_WINDOW_MS * 5;
const DASHBOARD_USER = process.env.DASHBOARD_USER || "";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const DASHBOARD_ENABLED = Boolean(DASHBOARD_USER && DASHBOARD_PASSWORD);
const LOGS_QUERY_MAX_LIMIT = 20_000;
const LOGS_QUERY_DEFAULT_LIMIT = 5_000;

const rateLimitBuckets = new Map();

function pruneRateLimitBuckets() {
  const cutoff = Date.now() - RATE_LIMIT_BUCKET_TTL_MS;
  for (const [ip, timestamps] of rateLimitBuckets) {
    const recent = timestamps.filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      rateLimitBuckets.delete(ip);
    } else {
      rateLimitBuckets.set(ip, recent);
    }
  }
}

setInterval(pruneRateLimitBuckets, RATE_LIMIT_BUCKET_TTL_MS).unref?.();

function isRateLimited(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const bucket = (rateLimitBuckets.get(ip) || []).filter((ts) => ts > cutoff);
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(ip, bucket);
    return true;
  }
  bucket.push(now);
  rateLimitBuckets.set(ip, bucket);
  return false;
}

function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `${today}.jsonl`);
}

function getClientIp(c) {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return c.req.header("x-real-ip") || "unknown";
}

await mkdir(LOG_DIR, { recursive: true });

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

app.get("/health", (c) => c.json({ ok: true }));

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

app.get("/dashboard", dashboardAuth, (c) => {
  if (!dashboardHtml) {
    return c.json({ ok: false, error: "dashboard_unavailable" }, 500);
  }
  return c.html(dashboardHtml);
});

app.get("/logs", dashboardAuth, async (c) => {
  const requestedDate = c.req.query("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return c.json({ ok: false, error: "invalid_date" }, 400);
  }

  const requestedLimit = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, LOGS_QUERY_MAX_LIMIT)
      : LOGS_QUERY_DEFAULT_LIMIT;

  const filePath = join(LOG_DIR, `${requestedDate}.jsonl`);

  try {
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    const entries = lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry !== null);

    return c.json({
      ok: true,
      date: requestedDate,
      totalLines: lines.length,
      returned: entries.length,
      entries,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return c.json({
        ok: true,
        date: requestedDate,
        totalLines: 0,
        returned: 0,
        entries: [],
      });
    }
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
  if (isRateLimited(ip)) {
    return c.json({ ok: false, error: "rate_limited" }, 429);
  }

  const rawText = await c.req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return c.json({ ok: false, error: "body_too_large" }, 413);
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

  const entry = {
    ts: new Date().toISOString(),
    ip,
    origin,
    message: typeof body.message === "string" ? body.message : "",
    context: body.context && typeof body.context === "object" ? body.context : {},
  };

  try {
    await appendFile(getLogFilePath(), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error("[log-server] write failed:", error);
    return c.json({ ok: false, error: "write_failed" }, 500);
  }

  return c.json({ ok: true });
});

console.log(`[log-server] listening on :${PORT}`);
console.log(`[log-server] log dir: ${LOG_DIR}`);
console.log(
  `[log-server] allowed origins: ${ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.join(", ") : "(none — all POSTs rejected)"}`,
);
console.log(
  `[log-server] dashboard: ${DASHBOARD_ENABLED ? "enabled (basic auth)" : "disabled (set DASHBOARD_USER + DASHBOARD_PASSWORD)"}`,
);

export default {
  port: PORT,
  fetch: app.fetch,
};
