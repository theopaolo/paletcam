import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountRegistry } from "./accounts.js";
import { createSyncApp, parsePaletteEnvelope, parseWritePrecondition } from "./app.js";
import { createBackupStore, sha256HexOfBytes } from "./store.js";

const ALLOWED_ORIGIN = "https://app.example.test";
const temporaryDirs = [];

async function createTestApp(configOverrides = {}, storeOverrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "sync-app-"));
  temporaryDirs.push(dataDir);

  const config = {
    environment: "test",
    allowedOrigins: [ALLOWED_ORIGIN],
    pairingEnabled: true,
    rateLimitWindowMs: 60_000,
    pairRateLimitWindowMs: 3_600_000,
    maxMetadataBytes: 64 * 1024,
    maxAssetBytes: 1024 * 1024,
    ...configOverrides,
  };
  const store = createBackupStore({ dataDir, ...storeOverrides });
  const accounts = createAccountRegistry({ dataDir });
  const neverLimited = { isRateLimited: () => false };

  const app = createSyncApp({
    config,
    accounts,
    store,
    rateLimiter: configOverrides.rateLimiter ?? neverLimited,
    pairRateLimiter: configOverrides.pairRateLimiter ?? neverLimited,
    getClientIp: () => "test-ip",
  });

  return { app, dataDir, store };
}

async function pair(app) {
  const response = await app.request("/v1/pair", { method: "POST" });
  const body = await response.json();
  return { authorization: `Bearer ${body.accountId}.${body.secret}`, ...body };
}

function paletteEnvelope(assets = []) {
  return JSON.stringify({ palette: { colors: [{ r: 1, g: 2, b: 3 }] }, assets });
}

function putPalette(app, authorization, uid, headers = {}, assets = []) {
  return app.request(`/v1/palettes/${uid}`, {
    method: "PUT",
    headers: { authorization, ...headers },
    body: paletteEnvelope(assets),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("sync-server app", () => {
  test("envelope parsing accepts the contract and rejects malformed shapes", () => {
    expect(parsePaletteEnvelope(paletteEnvelope())).toEqual({ referencedAssets: [] });
    expect(parsePaletteEnvelope(paletteEnvelope(["a".repeat(64), "a".repeat(64)]))).toEqual({
      referencedAssets: ["a".repeat(64)],
    });
    expect(parsePaletteEnvelope("not json")).toBeNull();
    expect(parsePaletteEnvelope(JSON.stringify({ assets: [] }))).toBeNull();
    expect(parsePaletteEnvelope(JSON.stringify({ palette: {}, assets: ["nothex"] }))).toBeNull();
  });

  test("pairing returns credentials once and can be disabled", async () => {
    const { app } = await createTestApp();
    const paired = await pair(app);
    expect(paired.recoveryCode).toBe(`cc-${paired.accountId}-${paired.secret}`);

    const { app: lockedApp } = await createTestApp({ pairingEnabled: false });
    const response = await lockedApp.request("/v1/pair", { method: "POST" });
    expect(response.status).toBe(403);
  });

  test("authenticated palette round trip updates the manifest", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";

    expect((await app.request("/v1/manifest")).status).toBe(401);

    const putResponse = await app.request(`/v1/palettes/${uid}`, {
      method: "PUT",
      headers: { authorization },
      body: paletteEnvelope(),
    });
    expect(putResponse.status).toBe(200);
    const { hash } = await putResponse.json();

    const manifestResponse = await app.request("/v1/manifest", { headers: { authorization } });
    const { manifest } = await manifestResponse.json();
    expect(manifest.palettes[uid].hash).toBe(hash);

    const getResponse = await app.request(`/v1/palettes/${uid}`, { headers: { authorization } });
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("etag")).toBe(`"${hash}"`);
    expect((await getResponse.json()).palette.colors).toHaveLength(1);
  });

  test("write preconditions parse bare, quoted and uppercase hashes and reject the rest", () => {
    const hash = "ab".repeat(32);
    expect(parseWritePrecondition(undefined, undefined)).toEqual({});
    expect(parseWritePrecondition(hash, undefined)).toEqual({ expectedHash: hash });
    expect(parseWritePrecondition(`"${hash.toUpperCase()}"`, undefined)).toEqual({
      expectedHash: hash,
    });
    expect(parseWritePrecondition(undefined, "*")).toEqual({ expectAbsent: true });
    expect(parseWritePrecondition("*", undefined)).toBeNull();
    expect(parseWritePrecondition(`W/"${hash}"`, undefined)).toBeNull();
    expect(parseWritePrecondition(`"${hash}`, undefined)).toBeNull();
    expect(parseWritePrecondition(undefined, `"${hash}"`)).toBeNull();
    expect(parseWritePrecondition(hash, "*")).toBeNull();
  });

  test("If-Match writes only over the version the client read", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";
    const { hash } = await (await putPalette(app, authorization, uid)).json();

    const matched = await putPalette(app, authorization, uid, { "if-match": `"${hash}"` }, [
      "a".repeat(64),
    ]);
    expect(matched.status).toBe(200);
    const { hash: newHash } = await matched.json();
    expect(newHash).not.toBe(hash);

    const stale = await putPalette(app, authorization, uid, { "if-match": hash });
    expect(stale.status).toBe(409);
    const { manifest } = await (
      await app.request("/v1/manifest", { headers: { authorization } })
    ).json();
    expect(await stale.json()).toEqual({
      ok: false,
      error: "conflict",
      current: { hash: newHash, updatedAt: manifest.palettes[uid].updatedAt },
      tombstoned: false,
    });

    const malformed = await putPalette(app, authorization, uid, { "if-match": "*" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: "invalid_precondition" });
  });

  test("If-Match on a tombstoned palette answers 409 without a current version", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";
    const { hash } = await (await putPalette(app, authorization, uid)).json();
    await app.request(`/v1/palettes/${uid}`, { method: "DELETE", headers: { authorization } });

    const response = await putPalette(app, authorization, uid, { "if-match": hash });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "conflict",
      current: null,
      tombstoned: true,
    });
  });

  test("If-None-Match: * creates or revives, and refuses a live palette", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";
    const ifNoneMatch = { "if-none-match": "*" };

    const created = await putPalette(app, authorization, uid, ifNoneMatch);
    expect(created.status).toBe(200);
    const { hash } = await created.json();

    const live = await putPalette(app, authorization, uid, ifNoneMatch);
    expect(live.status).toBe(409);
    expect(await live.json()).toMatchObject({ current: { hash }, tombstoned: false });

    await app.request(`/v1/palettes/${uid}`, { method: "DELETE", headers: { authorization } });
    const revived = await putPalette(app, authorization, uid, ifNoneMatch);
    expect(revived.status).toBe(200);
    const { manifest } = await (
      await app.request("/v1/manifest", { headers: { authorization } })
    ).json();
    expect(manifest.palettes[uid].hash).toBe(hash);
    expect(manifest.tombstones[uid]).toBeUndefined();
  });

  test("a write without preconditions overwrites unconditionally", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";

    await putPalette(app, authorization, uid);
    const overwrite = await putPalette(app, authorization, uid, {}, ["a".repeat(64)]);
    expect(overwrite.status).toBe(200);
    const { hash } = await overwrite.json();

    const getResponse = await app.request(`/v1/palettes/${uid}`, { headers: { authorization } });
    expect(getResponse.headers.get("etag")).toBe(`"${hash}"`);
  });

  test("CORS allows the precondition headers and exposes ETag", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";

    const preflight = await app.request(`/v1/palettes/${uid}`, {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization, if-match, if-none-match",
      },
    });
    expect(preflight.status).toBe(204);
    const allowed = preflight.headers.get("access-control-allow-headers").toLowerCase();
    expect(allowed.split(/,\s*/)).toEqual(
      expect.arrayContaining(["if-match", "if-none-match", "authorization", "content-type"]),
    );

    await putPalette(app, authorization, uid);
    const response = await app.request(`/v1/palettes/${uid}`, {
      headers: { authorization, origin: ALLOWED_ORIGIN },
    });
    const exposed = response.headers.get("access-control-expose-headers").toLowerCase();
    expect(exposed.split(/,\s*/)).toEqual(expect.arrayContaining(["etag", "retry-after"]));
  });

  test("asset uploads verify the digest, deduplicate, and stream back", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const bytes = new Uint8Array([7, 7, 7, 7]);
    const hash = sha256HexOfBytes(bytes);

    const mismatch = await app.request(`/v1/assets/${"0".repeat(64)}`, {
      method: "PUT",
      headers: { authorization },
      body: bytes,
    });
    expect(mismatch.status).toBe(400);

    const first = await app.request(`/v1/assets/${hash}`, {
      method: "PUT",
      headers: { authorization },
      body: bytes,
    });
    expect(await first.json()).toMatchObject({ stored: true });

    const second = await app.request(`/v1/assets/${hash}`, {
      method: "PUT",
      headers: { authorization },
      body: bytes,
    });
    expect(await second.json()).toMatchObject({ stored: false });

    const download = await app.request(`/v1/assets/${hash}`, { headers: { authorization } });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  test("tombstoning is idempotent and reflected in the manifest", async () => {
    const { app } = await createTestApp();
    const { authorization } = await pair(app);
    const uid = "11112222-3333-4444";

    await app.request(`/v1/palettes/${uid}`, {
      method: "PUT",
      headers: { authorization },
      body: paletteEnvelope(),
    });

    const firstDelete = await app.request(`/v1/palettes/${uid}`, {
      method: "DELETE",
      headers: { authorization },
    });
    expect(await firstDelete.json()).toMatchObject({ ok: true, tombstoned: true });

    const unknownDelete = await app.request(`/v1/palettes/never-uploaded-uid`, {
      method: "DELETE",
      headers: { authorization },
    });
    expect((await unknownDelete.json()).ok).toBe(true);

    const { manifest } = await (
      await app.request("/v1/manifest", { headers: { authorization } })
    ).json();
    expect(manifest.tombstones[uid]).toBeDefined();
    expect(manifest.palettes[uid]).toBeUndefined();
  });

  test("account deletion purges the caller's data and keeps other accounts", async () => {
    const { app, dataDir } = await createTestApp();
    const doomed = await pair(app);
    const kept = await pair(app);
    const bytes = new Uint8Array([5, 5, 5]);
    const hash = sha256HexOfBytes(bytes);
    for (const { authorization } of [doomed, kept]) {
      await app.request(`/v1/assets/${hash}`, {
        method: "PUT",
        headers: { authorization },
        body: bytes,
      });
      for (const uid of ["11112222-3333-4444", "55556666-7777-8888"]) {
        await app.request(`/v1/palettes/${uid}`, {
          method: "PUT",
          headers: { authorization },
          body: paletteEnvelope([hash]),
        });
      }
    }
    await app.request("/v1/palettes/55556666-7777-8888", {
      method: "DELETE",
      headers: { authorization: doomed.authorization },
    });

    expect((await app.request("/v1/account", { method: "DELETE" })).status).toBe(401);

    const deleted = await app.request("/v1/account", {
      method: "DELETE",
      headers: { authorization: doomed.authorization },
    });
    expect(await deleted.json()).toEqual({ ok: true });

    // The secret, and so the recovery code built from it, stops working.
    const headers = { authorization: doomed.authorization };
    expect((await app.request("/v1/manifest", { headers })).status).toBe(401);
    expect((await app.request("/v1/account", { method: "DELETE", headers })).status).toBe(401);
    expect(await readdir(dataDir)).toEqual([kept.accountId]);

    const { manifest } = await (
      await app.request("/v1/manifest", { headers: { authorization: kept.authorization } })
    ).json();
    expect(Object.keys(manifest.palettes)).toHaveLength(2);
    const download = await app.request(`/v1/assets/${hash}`, {
      headers: { authorization: kept.authorization },
    });
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  test("quota exhaustion answers 507", async () => {
    const { app } = await createTestApp({}, { maxAccountBytes: 8 });
    const { authorization } = await pair(app);
    const bytes = new Uint8Array(16);

    const response = await app.request(`/v1/assets/${sha256HexOfBytes(bytes)}`, {
      method: "PUT",
      headers: { authorization },
      body: bytes,
    });
    expect(response.status).toBe(507);
  });

  test("foreign browser origins are rejected before auth runs", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/v1/manifest", {
      headers: { origin: "https://evil.example.test" },
    });
    expect(response.status).toBe(403);
  });

  test("oversized metadata answers 413", async () => {
    const { app } = await createTestApp({ maxMetadataBytes: 32 });
    const { authorization } = await pair(app);

    const response = await app.request("/v1/palettes/11112222-3333-4444", {
      method: "PUT",
      headers: { authorization },
      body: paletteEnvelope(),
    });
    expect(response.status).toBe(413);
  });
});
