import { Hono } from "hono";
import { cors } from "hono/cors";
import { appendFile, mkdir } from "node:fs/promises";
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

export default {
  port: PORT,
  fetch: app.fetch,
};
