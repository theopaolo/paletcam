import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountRegistry, formatRecoveryCode, parseRecoveryCode } from "./accounts.js";

const temporaryDirs = [];

async function createRegistry() {
  const dataDir = await mkdtemp(join(tmpdir(), "sync-accounts-"));
  temporaryDirs.push(dataDir);
  return createAccountRegistry({ dataDir });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("sync-server accounts", () => {
  test("pairing mints verifiable credentials and a parseable recovery code", async () => {
    const registry = await createRegistry();

    const { accountId, secret, recoveryCode } = await registry.pairNewAccount();

    expect(recoveryCode).toBe(formatRecoveryCode(accountId, secret));
    expect(parseRecoveryCode(` ${recoveryCode} `)).toEqual({ accountId, secret });
    await expect(registry.verifyCredentials(accountId, secret)).resolves.toBe(true);
  });

  test("rejects a wrong secret, unknown account, and malformed credentials", async () => {
    const registry = await createRegistry();
    const { accountId, secret } = await registry.pairNewAccount();

    await expect(registry.verifyCredentials(accountId, secret.replace(/./, "0"))).resolves.toBe(
      false,
    );
    await expect(registry.verifyCredentials("0123456789abcdef", secret)).resolves.toBe(false);
    await expect(registry.verifyCredentials("../escape", secret)).resolves.toBe(false);
    await expect(registry.verifyCredentials(accountId, "short")).resolves.toBe(false);
  });

  test("recovery code parsing rejects tampered shapes", () => {
    expect(parseRecoveryCode("paletcam-XYZ-notahex")).toBeNull();
    expect(parseRecoveryCode("")).toBeNull();
    expect(parseRecoveryCode(null)).toBeNull();
  });
});
