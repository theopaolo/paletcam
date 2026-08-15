import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ACCOUNT_ID_PATTERN = /^[a-f0-9]{16}$/;
const SECRET_PATTERN = /^[a-f0-9]{48}$/;

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function formatRecoveryCode(accountId, secret) {
  return `paletcam-${accountId}-${secret}`;
}

/**
 * Splits a `paletcam-<accountId>-<secret>` recovery code back into
 * credentials, tolerating surrounding whitespace. Returns null when the shape
 * is wrong so callers treat it exactly like a bad secret.
 */
export function parseRecoveryCode(code) {
  const match = /^paletcam-([a-f0-9]{16})-([a-f0-9]{48})$/.exec(String(code || "").trim());
  return match ? { accountId: match[1], secret: match[2] } : null;
}

export function createAccountRegistry({ dataDir }) {
  function accountFilePath(accountId) {
    return join(dataDir, accountId, "account.json");
  }

  /**
   * Mints a fresh account and returns the credentials exactly once. Only the
   * secret's hash is stored; a lost recovery code is unrecoverable by design.
   */
  async function pairNewAccount({ now = () => new Date() } = {}) {
    const accountId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");

    await mkdir(join(dataDir, accountId), { recursive: true });
    await writeFile(
      accountFilePath(accountId),
      `${JSON.stringify({
        accountId,
        secretHash: sha256Hex(secret),
        createdAt: now().toISOString(),
      })}\n`,
      { flag: "wx" },
    );

    return { accountId, secret, recoveryCode: formatRecoveryCode(accountId, secret) };
  }

  /** @returns {Promise<boolean>} */
  async function verifyCredentials(accountId, secret) {
    if (!ACCOUNT_ID_PATTERN.test(String(accountId || ""))) return false;
    if (!SECRET_PATTERN.test(String(secret || ""))) return false;

    let stored;
    try {
      stored = JSON.parse(await readFile(accountFilePath(accountId), "utf8"));
    } catch {
      return false;
    }

    const storedHash = String(stored?.secretHash || "");
    if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;

    return timingSafeEqual(Buffer.from(sha256Hex(secret), "hex"), Buffer.from(storedHash, "hex"));
  }

  return { pairNewAccount, verifyCredentials };
}
