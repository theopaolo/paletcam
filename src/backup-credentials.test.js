import { afterEach, describe, expect, test } from "bun:test";
import {
  clearBackupCredentials,
  formatBackupRecoveryCode,
  getBackupCredentials,
  parseBackupRecoveryCode,
  saveBackupCredentials,
} from "./backup-credentials.js";

const ACCOUNT_ID = "0123456789abcdef";
const SECRET = "a".repeat(48);
const RECOVERY_CODE = `paletcam-${ACCOUNT_ID}-${SECRET}`;

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe("backup credentials", () => {
  test("parses a recovery code with whitespace and case noise", () => {
    expect(parseBackupRecoveryCode(`  ${RECOVERY_CODE.toUpperCase()} `)).toEqual({
      accountId: ACCOUNT_ID,
      secret: SECRET,
    });
    expect(parseBackupRecoveryCode("paletcam-short-code")).toBeNull();
    expect(parseBackupRecoveryCode("")).toBeNull();
  });

  test("round-trips credentials through storage and clears them", () => {
    globalThis.localStorage = createLocalStorageMock();

    expect(getBackupCredentials()).toBeNull();
    saveBackupCredentials({ accountId: ACCOUNT_ID, secret: SECRET });
    expect(getBackupCredentials()).toEqual({ accountId: ACCOUNT_ID, secret: SECRET });
    expect(formatBackupRecoveryCode(getBackupCredentials())).toBe(RECOVERY_CODE);

    clearBackupCredentials();
    expect(getBackupCredentials()).toBeNull();
  });

  test("rejects malformed credentials instead of storing them", () => {
    globalThis.localStorage = createLocalStorageMock();

    expect(() => saveBackupCredentials({ accountId: "nope", secret: SECRET })).toThrow(TypeError);
    expect(getBackupCredentials()).toBeNull();
  });
});
