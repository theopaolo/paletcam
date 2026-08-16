import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountRegistry } from "./accounts.js";
import { createSyncApp, parsePaletteEnvelope } from "./app.js";
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

  return { app, store };
}

async function pair(app) {
  const response = await app.request("/v1/pair", { method: "POST" });
  const body = await response.json();
  return { authorization: `Bearer ${body.accountId}.${body.secret}`, ...body };
}

function paletteEnvelope(assets = []) {
  return JSON.stringify({ palette: { colors: [{ r: 1, g: 2, b: 3 }] }, assets });
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
    expect((await getResponse.json()).palette.colors).toHaveLength(1);
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
