import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  isCriticalOperationActive,
  resetCriticalOperationsForTests,
} from "../modules/critical-operation.js";
import { communitySessionsEqual } from "../community-session.js";

const apiUrl = new URL("../community-api.js", import.meta.url).href;
const sessionUrl = new URL("../community-session.js", import.meta.url).href;
const storageUrl = new URL("../palette-storage.js", import.meta.url).href;
const errorsUrl = new URL("./errors.js", import.meta.url).href;
const reportingUrl = new URL("../modules/error-reporting.js", import.meta.url).href;
const moduleUrl = new URL("./auth.js", import.meta.url).href;

const storageValues = new Map();
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key) => storageValues.get(key) ?? null,
    removeItem: (key) => storageValues.delete(key),
    setItem: (key, value) => storageValues.set(key, String(value)),
  },
});

async function loadAuth({
  deleteError = null,
  cleanupError = null,
  deleteImplementation = null,
  verifyImplementation = null,
} = {}) {
  let currentSession = { token: "token", email: "owner@example.com", user: null };
  const deleteAccount = mock(async () => {
    if (deleteImplementation) return deleteImplementation();
    if (deleteError) throw deleteError;
  });
  const clearCommunitySession = mock(() => {
    currentSession = null;
  });
  const clearCommunityStateForAccount = mock(async () => {
    if (cleanupError) throw cleanupError;
  });
  const reportAppError = mock(() => {});
  const mapApiError = mock((error) => new Error("mapped", { cause: error }));
  const setCommunitySession = mock((session) => {
    currentSession = session;
    return session;
  });

  mock.module(apiUrl, () => ({
    CATCH_MODERATION_STATUSES: Object.freeze({
      TO_MODERATE: "TO_MODERATE",
      PUBLIC: "PUBLIC",
      REJECTED: "REJECTED",
      PRIVATE: "PRIVATE",
    }),
    deleteAccount,
    normalizeCatchStatus: (status) => (typeof status === "string" ? status.toUpperCase() : null),
    requestAccountDeletionCode: mock(async () => {}),
    requestCommunityLoginCode: mock(async () => {}),
    verifyCommunityLoginCode: mock(async () =>
      verifyImplementation ? verifyImplementation() : { token: "token" },
    ),
  }));
  mock.module(sessionUrl, () => ({
    clearCommunitySession,
    communitySessionsEqual,
    getCommunitySession: mock(() => currentSession),
    setCommunitySession,
    subscribeCommunitySession: mock(() => () => {}),
  }));
  mock.module(storageUrl, () => ({
    clearCommunityStateForAccount,
  }));
  mock.module(errorsUrl, () => ({
    createCommunityServiceError: (message, options) =>
      Object.assign(new Error(message), { name: "CommunityServiceError" }, options),
    getAuthTokenOrThrow: () => "token",
    mapApiError,
  }));
  mock.module(reportingUrl, () => ({ reportAppError }));

  const module = await import(`${moduleUrl}?test=${Math.random()}`);
  return {
    clearCommunitySession,
    clearCommunityStateForAccount,
    deleteAccount,
    mapApiError,
    module,
    reportAppError,
    setCommunitySession,
    setCurrentSession(session) {
      currentSession = session;
    },
  };
}

afterEach(() => {
  storageValues.clear();
  resetCriticalOperationsForTests();
  mock.restore();
});

afterAll(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  } else {
    delete globalThis.localStorage;
  }
});

describe("account deletion", () => {
  test("holds reload-sensitive ownership through remote and local cleanup", async () => {
    let resolveDelete;
    const remoteDeletion = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const { clearCommunitySession, module } = await loadAuth({
      deleteImplementation: () => remoteDeletion,
    });

    const deletion = module.confirmAccountDeletion({ code: "123456" });
    expect(isCriticalOperationActive()).toBe(true);
    expect(clearCommunitySession).not.toHaveBeenCalled();
    expect(JSON.parse(storageValues.get(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY))).toMatchObject(
      {
        version: 1,
        ownerAccountKey: expect.stringMatching(/^account:[a-f0-9]{16}$/),
      },
    );

    resolveDelete();
    await deletion;

    expect(clearCommunitySession).toHaveBeenCalledTimes(1);
    expect(isCriticalOperationActive()).toBe(false);
  });

  test("clears authentication and contains local cleanup failure after remote success", async () => {
    const cleanupError = new Error("IndexedDB unavailable");
    const { clearCommunitySession, module, reportAppError } = await loadAuth({ cleanupError });

    await expect(module.confirmAccountDeletion({ code: "123456" })).resolves.toEqual({
      localCleanupComplete: false,
    });
    expect(clearCommunitySession).toHaveBeenCalledTimes(1);
    expect(reportAppError).toHaveBeenCalledWith(
      cleanupError,
      expect.objectContaining({
        context: { operation: "account-deletion-local-cleanup" },
      }),
    );
    expect(JSON.parse(storageValues.get(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY))).toMatchObject(
      {
        version: 1,
        ownerAccountKey: expect.stringMatching(/^account:[a-f0-9]{16}$/),
      },
    );
  });

  test("retries pending local metadata cleanup and clears its durable marker", async () => {
    const { clearCommunityStateForAccount, module } = await loadAuth();
    storageValues.set(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY, "1");

    await expect(module.retryPendingAccountDeletionCleanup()).resolves.toEqual({
      attempted: true,
      complete: true,
    });
    expect(storageValues.has(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY)).toBe(false);
    expect(clearCommunityStateForAccount).not.toHaveBeenCalled();
  });

  test("does not clear authentication when the remote deletion fails", async () => {
    const { clearCommunitySession, mapApiError, module } = await loadAuth({
      deleteError: new Error("remote failed"),
    });

    await expect(module.confirmAccountDeletion({ code: "123456" })).rejects.toThrow("mapped");
    expect(clearCommunitySession).not.toHaveBeenCalled();
    expect(mapApiError).toHaveBeenCalledTimes(1);
    expect(storageValues.has(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY)).toBe(false);
  });

  test("does not clear a newer session after the deleted account request completes", async () => {
    let resolveDelete;
    const remoteDeletion = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const { clearCommunitySession, module, setCurrentSession } = await loadAuth({
      deleteImplementation: () => remoteDeletion,
    });

    const deletion = module.confirmAccountDeletion({ code: "123456" });
    setCurrentSession({ token: "new-token", email: "new@example.com", user: null });
    resolveDelete();
    await deletion;

    expect(clearCommunitySession).not.toHaveBeenCalled();
  });

  test("does not contact the API when deletion recovery storage cannot be reserved", async () => {
    const { deleteAccount, module } = await loadAuth();
    const storage = globalThis.localStorage;
    const originalSetItem = storage.setItem;
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };

    try {
      await expect(module.confirmAccountDeletion({ code: "123456" })).rejects.toMatchObject({
        code: "ACCOUNT_DELETION_RECOVERY_UNAVAILABLE",
      });
      expect(deleteAccount).not.toHaveBeenCalled();
    } finally {
      storage.setItem = originalSetItem;
    }
  });

  test("rejects oversized deletion codes before reserving or sending", async () => {
    const { deleteAccount, module } = await loadAuth();

    await expect(module.confirmAccountDeletion({ code: "1".repeat(33) })).rejects.toMatchObject({
      code: "CODE_TOO_LONG",
    });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(storageValues.has(module.ACCOUNT_DELETION_CLEANUP_MARKER_KEY)).toBe(false);
  });
});

describe("login completion safety", () => {
  test("does not overwrite a session that changes while OTP verification is pending", async () => {
    let resolveVerification;
    const verification = new Promise((resolve) => {
      resolveVerification = resolve;
    });
    const { module, setCommunitySession, setCurrentSession } = await loadAuth({
      verifyImplementation: () => verification,
    });

    const login = module.verifyCommunityLoginOtp({
      email: "owner@example.com",
      code: "123456",
    });
    setCurrentSession({ token: "new-token", email: "new@example.com", user: null });
    resolveVerification({ token: "verified-token", user: { id: "verified" } });

    await expect(login).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(setCommunitySession).not.toHaveBeenCalled();
  });

  test("bounds outgoing email and OTP credentials before transport", async () => {
    const { module, setCommunitySession } = await loadAuth();

    await expect(
      module.sendCommunityLoginOtp(`${"a".repeat(310)}@example.com`),
    ).rejects.toMatchObject({ code: "EMAIL_TOO_LONG" });
    await expect(
      module.verifyCommunityLoginOtp({ email: "owner@example.com", code: "1".repeat(33) }),
    ).rejects.toMatchObject({ code: "CODE_TOO_LONG" });
    expect(setCommunitySession).not.toHaveBeenCalled();
  });
});
