import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ASSET_HASH_PATTERN,
  BackupQuotaExceededError,
  MAX_ASSETS_PER_PALETTE,
  PALETTE_UID_PATTERN,
  sha256HexOfBytes,
} from "./store.js";
import {
  readBoundedRequestBytes,
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "./request-body.js";

/**
 * Validates the palette upload envelope: `{ palette: {...}, assets: [sha256] }`.
 * The palette object itself is client-owned and stored verbatim; the assets
 * list is the server-side contract that makes garbage collection possible.
 */
export function parsePaletteEnvelope(rawText) {
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    return null;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!body.palette || typeof body.palette !== "object" || Array.isArray(body.palette)) return null;

  const assets = body.assets === undefined ? [] : body.assets;
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS_PER_PALETTE) return null;
  if (!assets.every((entry) => typeof entry === "string" && ASSET_HASH_PATTERN.test(entry))) {
    return null;
  }

  return { referencedAssets: [...new Set(assets)] };
}

export function createSyncApp({
  config,
  accounts,
  store,
  rateLimiter,
  pairRateLimiter,
  getClientIp,
}) {
  const app = new Hono();

  app.use(
    "/v1/*",
    cors({
      origin: (origin) => {
        if (!origin) return null;
        return config.allowedOrigins.includes(origin) ? origin : null;
      },
      allowMethods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      // Without this the browser hides Retry-After from cross-origin JS and
      // the client cannot pace its rate-limit backoff.
      exposeHeaders: ["Retry-After"],
      maxAge: 600,
    }),
  );

  // Browsers always send Origin on cross-site requests, so a foreign origin is
  // rejected outright; requests without one (curl, native tooling) proceed to
  // bearer auth, which is the actual gate.
  app.use("/v1/*", async (c, next) => {
    const origin = c.req.header("origin") || "";
    if (origin && !config.allowedOrigins.includes(origin)) {
      return c.json({ ok: false, error: "origin_not_allowed" }, 403);
    }
    return next();
  });

  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    if (rateLimiter.isRateLimited(getClientIp(c))) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(config.rateLimitWindowMs / 1_000))));
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({ ok: true, environment: config.environment, pairingEnabled: config.pairingEnabled }),
  );

  app.post("/v1/pair", async (c) => {
    if (!config.pairingEnabled) {
      return c.json({ ok: false, error: "pairing_disabled" }, 403);
    }
    if (pairRateLimiter.isRateLimited(getClientIp(c))) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(config.pairRateLimitWindowMs / 1_000))));
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }

    const credentials = await accounts.pairNewAccount();
    return c.json({ ok: true, ...credentials }, 201);
  });

  async function requireAccount(c) {
    const header = c.req.header("authorization") || "";
    const match = /^Bearer\s+([a-f0-9]{16})\.([a-f0-9]{48})$/i.exec(header.trim());
    if (!match) return null;

    const accountId = match[1].toLowerCase();
    const verified = await accounts.verifyCredentials(accountId, match[2].toLowerCase());
    return verified ? accountId : null;
  }

  app.get("/v1/manifest", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    return c.json({ ok: true, manifest: await store.getManifestSnapshot(accountId) });
  });

  app.put("/v1/palettes/:uid", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    const uid = c.req.param("uid");
    if (!PALETTE_UID_PATTERN.test(uid)) {
      return c.json({ ok: false, error: "invalid_palette_uid" }, 400);
    }

    let documentText;
    try {
      documentText = await readBoundedRequestText(c.req.raw, config.maxMetadataBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ ok: false, error: "body_too_large" }, 413);
      }
      return c.json({ ok: false, error: "body_read_failed" }, 400);
    }

    const envelope = parsePaletteEnvelope(documentText);
    if (!envelope) {
      return c.json({ ok: false, error: "invalid_envelope" }, 400);
    }

    try {
      const { hash } = await store.putPalette(accountId, uid, {
        documentText,
        referencedAssets: envelope.referencedAssets,
      });
      return c.json({ ok: true, hash });
    } catch (error) {
      if (error instanceof BackupQuotaExceededError) {
        return c.json({ ok: false, error: "quota_exceeded" }, 507);
      }
      throw error;
    }
  });

  app.get("/v1/palettes/:uid", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    const uid = c.req.param("uid");
    if (!PALETTE_UID_PATTERN.test(uid)) {
      return c.json({ ok: false, error: "invalid_palette_uid" }, 400);
    }

    const documentText = await store.getPaletteDocument(accountId, uid);
    if (documentText === null) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }
    return c.body(documentText, 200, { "Content-Type": "application/json" });
  });

  app.delete("/v1/palettes/:uid", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    const uid = c.req.param("uid");
    if (!PALETTE_UID_PATTERN.test(uid)) {
      return c.json({ ok: false, error: "invalid_palette_uid" }, 400);
    }

    // Idempotent by contract: tombstoning a uid the server never saw still
    // succeeds, so the client can always resolve its local tombstone.
    const { tombstoned } = await store.tombstonePalette(accountId, uid);
    return c.json({ ok: true, tombstoned });
  });

  app.put("/v1/assets/:hash", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    const assetHash = c.req.param("hash").toLowerCase();
    if (!ASSET_HASH_PATTERN.test(assetHash)) {
      return c.json({ ok: false, error: "invalid_asset_hash" }, 400);
    }

    const declaredBytes = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > config.maxAssetBytes) {
      return c.json({ ok: false, error: "body_too_large" }, 413);
    }

    let bytes;
    try {
      bytes = await readBoundedRequestBytes(c.req.raw, config.maxAssetBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ ok: false, error: "body_too_large" }, 413);
      }
      return c.json({ ok: false, error: "body_read_failed" }, 400);
    }

    if (sha256HexOfBytes(bytes) !== assetHash) {
      return c.json({ ok: false, error: "hash_mismatch" }, 400);
    }

    try {
      const { stored } = await store.putAsset(accountId, assetHash, bytes);
      return c.json({ ok: true, stored });
    } catch (error) {
      if (error instanceof BackupQuotaExceededError) {
        return c.json({ ok: false, error: "quota_exceeded" }, 507);
      }
      throw error;
    }
  });

  app.get("/v1/assets/:hash", async (c) => {
    const accountId = await requireAccount(c);
    if (!accountId) return c.json({ ok: false, error: "unauthorized" }, 401);

    const assetHash = c.req.param("hash").toLowerCase();
    if (!ASSET_HASH_PATTERN.test(assetHash)) {
      return c.json({ ok: false, error: "invalid_asset_hash" }, 400);
    }

    if (!(await store.hasAsset(accountId, assetHash))) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }

    const file = Bun.file(store.getAssetPath(accountId, assetHash));
    if (!(await file.exists())) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }
    return c.body(file.stream(), 200, { "Content-Type": "application/octet-stream" });
  });

  return app;
}
