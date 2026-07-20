import { afterEach, describe, expect, mock, test } from "bun:test";

const OUTBOX_STORAGE_KEY = "paletcam:community:delete-cleanup-outbox:v1";
const communityApiModuleUrl = new URL("./community-api.js", import.meta.url).href;
const communityServiceModuleUrl = new URL("./community-service.js", import.meta.url).href;
const communitySessionModuleUrl = new URL("./community-session.js", import.meta.url).href;
const dbModuleUrl = new URL("./palette-storage/db.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("./modules/error-reporting.js", import.meta.url).href;
const communityDeleteOutboxModuleUrl = new URL("./community-delete-outbox.js", import.meta.url)
  .href;

const currentOutboxModules = [];

function hashAccountIdentity(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value.slice(0, 1024)) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function accountKeyFor(session) {
  const userId = String(session.user?.id ?? "").trim();
  const email = String(session.user?.email || session.email || "")
    .trim()
    .toLowerCase();
  const identity = userId ? `user:${userId}` : email ? `email:${email}` : "";
  if (!identity) return "";
  return `account:${hashAccountIdentity(identity)}`;
}

function legacyEmailAccountKeyFor(session) {
  const email = String(session.user?.email || session.email || "")
    .trim()
    .toLowerCase();
  return email ? `account:${hashAccountIdentity(`email:${email}`)}` : "";
}

const DEFAULT_SESSION = {
  token: "session-token",
  user: { id: "account-a", email: "account-a@example.test" },
};

function createEntry(remoteCatchId, session = DEFAULT_SESSION, overrides = {}) {
  return {
    accountKey: accountKeyFor(session),
    remoteCatchId,
    ...overrides,
  };
}

function createDbEntry(remoteCatchId, session = DEFAULT_SESSION, overrides = {}) {
  const accountKey = accountKeyFor(session);
  return {
    key: `${accountKey}\u0000${remoteCatchId}`,
    accountKey,
    attemptCount: 0,
    enqueuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    nextAttemptAt: null,
    remoteCatchId,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function createLocalStorageMock(initialEntries = null) {
  const store = new Map();
  if (initialEntries !== null) {
    store.set(OUTBOX_STORAGE_KEY, JSON.stringify(initialEntries));
  }

  return {
    dump(key) {
      return store.has(key) ? store.get(key) : null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

function createTransactionalOutboxDb(initialEntries = []) {
  const records = new Map(initialEntries.map((entry) => [entry.key, { ...entry }]));
  let transactionTail = Promise.resolve();
  const table = {
    async bulkDelete(keys) {
      for (const key of keys) records.delete(key);
    },
    async bulkPut(entries) {
      for (const entry of entries) records.set(entry.key, { ...entry });
      return entries.length;
    },
    async clear() {
      records.clear();
    },
    async delete(key) {
      records.delete(key);
    },
    async get(key) {
      const entry = records.get(key);
      return entry ? { ...entry } : undefined;
    },
    async put(entry) {
      records.set(entry.key, { ...entry });
      return entry.key;
    },
    async toArray() {
      return [...records.values()].map((entry) => ({ ...entry }));
    },
  };
  const db = {
    communityDeleteOutbox: table,
    transaction(_mode, _table, callback) {
      const result = transactionTail.then(callback);
      transactionTail = result.catch(() => {});
      return result;
    },
  };
  return {
    db,
    dump: async () => table.toArray(),
    put: (entry) => table.put(entry),
  };
}

async function waitForCondition(predicate, { attempts = 20 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return false;
}

async function loadCommunityDeleteOutbox({
  cleanupImplementation = async (remoteCatchId) => ({
    attempted: true,
    remoteCatchId,
    status: "unpublished",
    success: true,
  }),
  initialDbEntries = [],
  initialLegacyEntries = null,
  reconcileImplementation = async () => ({ reconciledCount: 0, remainingCount: 0 }),
  session = DEFAULT_SESSION,
} = {}) {
  const cleanupRemoteCatch = mock(cleanupImplementation);
  const reconcilePublicationRecoveryForCurrentSession = mock(reconcileImplementation);
  const reportAppError = mock(() => ({}));
  const sessionListeners = new Set();
  let currentSession = session;
  const outboxDb = createTransactionalOutboxDb(initialDbEntries);

  mock.module(communityApiModuleUrl, () => ({
    deleteAccount: mock(async () => ({})),
    requestAccountDeletionCode: mock(async () => ({})),
  }));
  mock.module(communityServiceModuleUrl, () => ({
    cleanupRemoteCatch,
    reconcilePublicationRecoveryForCurrentSession,
  }));
  mock.module(communitySessionModuleUrl, () => ({
    getCommunitySession: mock(() => currentSession),
    subscribeCommunitySession: mock((listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    }),
  }));
  mock.module(dbModuleUrl, () => ({ db: outboxDb.db }));
  mock.module(errorReportingModuleUrl, () => ({ reportAppError }));

  const localStorageMock = createLocalStorageMock(initialLegacyEntries);
  globalThis.localStorage = localStorageMock;

  const module = await import(`${communityDeleteOutboxModuleUrl}?test=${Math.random()}`);
  currentOutboxModules.push(module);
  return {
    cleanupRemoteCatch,
    reconcilePublicationRecoveryForCurrentSession,
    localStorageMock,
    module,
    outboxDb,
    reportAppError,
    triggerSession: async (nextSession) => {
      currentSession = nextSession;
      for (const listener of sessionListeners) listener(nextSession);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

afterEach(() => {
  for (const module of currentOutboxModules.splice(0)) {
    module.resetDeleteOutboxForTests?.();
  }
  delete globalThis.localStorage;
  mock.restore();
});

describe("community deletion cleanup outbox", () => {
  test("blocks palette deletion preparation when uncertain publication cleanup fails", async () => {
    const cleanupError = new Error("remote cleanup unavailable");
    const { module, reconcilePublicationRecoveryForCurrentSession } =
      await loadCommunityDeleteOutbox({
        reconcileImplementation: async () => {
          throw cleanupError;
        },
      });

    await expect(module.preparePaletteDeletionRemoteCleanup(17)).rejects.toBe(cleanupError);
    expect(reconcilePublicationRecoveryForCurrentSession).toHaveBeenCalledWith({ paletteId: 17 });
  });

  test("migrates validated legacy jobs once and removes the localStorage journal", async () => {
    const legacyEntries = [
      createEntry("remote-1"),
      createEntry(" remote-1 "),
      { remoteCatchId: "unbound" },
    ];
    const { localStorageMock, module, outboxDb } = await loadCommunityDeleteOutbox({
      initialLegacyEntries: legacyEntries,
    });

    expect(await module.enqueueDeleteRetry({ remoteCatchId: "remote-2" })).toBe(true);

    expect(localStorageMock.dump(OUTBOX_STORAGE_KEY)).toBeNull();
    expect((await outboxDb.dump()).map((entry) => entry.remoteCatchId).sort()).toEqual([
      "remote-1",
      "remote-2",
      "unbound",
    ]);
    const unboundEntry = (await outboxDb.dump()).find((entry) => entry.remoteCatchId === "unbound");
    expect(unboundEntry?.accountKey).toBe(accountKeyFor(DEFAULT_SESSION));
  });

  test("keeps unbound legacy jobs journaled until a session can claim them", async () => {
    const { cleanupRemoteCatch, localStorageMock, module, triggerSession } =
      await loadCommunityDeleteOutbox({
        initialLegacyEntries: [{ remoteCatchId: "legacy-unbound" }],
        session: null,
      });

    await module.prepareDeleteOutbox();
    expect(localStorageMock.dump(OUTBOX_STORAGE_KEY)).not.toBeNull();
    expect(cleanupRemoteCatch).not.toHaveBeenCalled();

    module.initializeDeleteOutbox();
    await triggerSession(DEFAULT_SESSION);
    expect(await waitForCondition(() => localStorageMock.dump(OUTBOX_STORAGE_KEY) === null)).toBe(
      true,
    );
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("legacy-unbound");
  });

  test("discards corrupt current-store rows while valid normalized rows still flush", async () => {
    const accountKey = accountKeyFor(DEFAULT_SESSION);
    const validEntry = createDbEntry(" remote-valid ", DEFAULT_SESSION, {
      key: `${accountKey}\u0000remote-valid`,
      enqueuedAt: "2026-07-13T10:00:00Z",
    });
    const { cleanupRemoteCatch, module, outboxDb, reportAppError } =
      await loadCommunityDeleteOutbox({
        initialDbEntries: [
          validEntry,
          createDbEntry("remote-bad-date", DEFAULT_SESSION, { enqueuedAt: { invalid: true } }),
          createDbEntry("remote-bad-key", DEFAULT_SESSION, {
            key: `${accountKey}\u0000different-remote-id`,
          }),
          createDbEntry("remote-bad-lease", DEFAULT_SESSION, {
            leaseOwner: "other-tab",
            leaseToken: null,
            leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        ],
      });

    await expect(module.flushDeleteOutbox()).resolves.toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 0,
    });

    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("remote-valid");
    expect(await outboxDb.dump()).toEqual([]);
    expect(reportAppError).toHaveBeenCalledTimes(1);
    expect(reportAppError).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        clientLogKey: "community-delete-outbox-invalid-records",
        includeConsole: false,
        context: {
          discardedCount: 3,
          discardedCountCapped: false,
        },
      }),
    );
  });

  test("removes a corrupt current-store row without calling remote cleanup or rejecting", async () => {
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      initialDbEntries: [
        createDbEntry("remote-corrupt", DEFAULT_SESSION, {
          attemptCount: Number.POSITIVE_INFINITY,
          enqueuedAt: 42,
        }),
      ],
    });

    await expect(module.flushDeleteOutbox()).resolves.toEqual({
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: 0,
    });
    expect(cleanupRemoteCatch).not.toHaveBeenCalled();
    expect(await outboxDb.dump()).toEqual([]);
  });

  test("deduplicates queued remote catches transactionally", async () => {
    const { module, outboxDb } = await loadCommunityDeleteOutbox();

    expect(await module.enqueueDeleteRetry({ remoteCatchId: " remote-1 " })).toBe(true);
    expect(await module.enqueueDeleteRetry({ remoteCatchId: "remote-1" })).toBe(false);

    const storedEntries = await outboxDb.dump();
    expect(storedEntries).toHaveLength(1);
    expect(storedEntries[0]).toMatchObject({
      remoteCatchId: "remote-1",
      accountKey: accountKeyFor(DEFAULT_SESSION),
      attemptCount: 0,
    });
  });

  test("processes deletion jobs stored under the historical email account key", async () => {
    const legacyAccountKey = legacyEmailAccountKeyFor(DEFAULT_SESSION);
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      initialDbEntries: [
        createDbEntry("remote-email-alias", DEFAULT_SESSION, {
          key: `${legacyAccountKey}\u0000remote-email-alias`,
          accountKey: legacyAccountKey,
        }),
      ],
    });

    await expect(module.flushDeleteOutbox()).resolves.toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 0,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("remote-email-alias");
    expect(await outboxDb.dump()).toEqual([]);
  });

  test("canonicalizes and deduplicates matching user-id and email-alias jobs", async () => {
    const canonicalAccountKey = accountKeyFor(DEFAULT_SESSION);
    const legacyAccountKey = legacyEmailAccountKeyFor(DEFAULT_SESSION);
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      cleanupImplementation: async (remoteCatchId) => ({ remoteCatchId, success: false }),
      initialDbEntries: [
        createDbEntry("remote-duplicate", DEFAULT_SESSION, {
          attemptCount: 1,
          enqueuedAt: "2026-07-13T09:00:00.000Z",
        }),
        createDbEntry("remote-duplicate", DEFAULT_SESSION, {
          key: `${legacyAccountKey}\u0000remote-duplicate`,
          accountKey: legacyAccountKey,
          attemptCount: 2,
          enqueuedAt: "2026-07-13T08:00:00.000Z",
        }),
      ],
    });

    await expect(module.flushDeleteOutbox()).resolves.toEqual({
      dequeuedCount: 0,
      processedCount: 1,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("remote-duplicate");
    expect(await outboxDb.dump()).toEqual([
      expect.objectContaining({
        key: `${canonicalAccountKey}\u0000remote-duplicate`,
        accountKey: canonicalAccountKey,
        remoteCatchId: "remote-duplicate",
        attemptCount: 3,
        enqueuedAt: "2026-07-13T08:00:00.000Z",
      }),
    ]);
  });

  test("preserves concurrent enqueues against the shared transactional store", async () => {
    const { module, outboxDb } = await loadCommunityDeleteOutbox();

    expect(
      await Promise.all([
        module.enqueueDeleteRetry({ remoteCatchId: "remote-a" }),
        module.enqueueDeleteRetry({ remoteCatchId: "remote-b" }),
      ]),
    ).toEqual([true, true]);
    expect((await outboxDb.dump()).map((entry) => entry.remoteCatchId).sort()).toEqual([
      "remote-a",
      "remote-b",
    ]);
  });

  test("awaits a forced follow-up requested while another flush is active", async () => {
    let resolveFirstCleanup;
    const firstCleanup = new Promise((resolve) => {
      resolveFirstCleanup = resolve;
    });
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      cleanupImplementation: async (remoteCatchId) => {
        if (remoteCatchId === "remote-a") await firstCleanup;
        return { remoteCatchId, success: true };
      },
      initialDbEntries: [createDbEntry("remote-a")],
    });

    void module.flushDeleteOutbox();
    expect(
      await waitForCondition(() => Promise.resolve(cleanupRemoteCatch.mock.calls.length === 1)),
    ).toBe(true);
    expect(await module.enqueueDeleteRetry({ remoteCatchId: "remote-b" })).toBe(true);
    const forcedFlush = module.flushDeleteOutbox({ force: true });
    resolveFirstCleanup();

    await expect(forcedFlush).resolves.toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 0,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(2);
    expect(await outboxDb.dump()).toEqual([]);
  });

  test("skips a concurrently claimed foreign job and atomically claims the next job", async () => {
    const foreignLease = {
      leaseOwner: "other-tab",
      leaseToken: "other-tab-token",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      initialDbEntries: [
        createDbEntry("remote-a", DEFAULT_SESSION, foreignLease),
        createDbEntry("remote-b"),
      ],
    });

    expect(await module.flushDeleteOutbox()).toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("remote-b");
    expect(await outboxDb.dump()).toEqual([
      expect.objectContaining({ remoteCatchId: "remote-a", ...foreignLease }),
    ]);
  });

  test("does not delete a claim whose lease ownership changed while cleanup was pending", async () => {
    let resolveCleanup;
    const cleanupPending = new Promise((resolve) => {
      resolveCleanup = resolve;
    });
    const { module, outboxDb } = await loadCommunityDeleteOutbox({
      cleanupImplementation: () => cleanupPending,
      initialDbEntries: [createDbEntry("remote-a")],
    });

    const flush = module.flushDeleteOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [claimedEntry] = await outboxDb.dump();
    await outboxDb.put({
      ...claimedEntry,
      leaseOwner: "replacement-tab",
      leaseToken: "replacement-token",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    resolveCleanup({ success: true });

    expect(await flush).toMatchObject({ dequeuedCount: 0, processedCount: 1, remainingCount: 1 });
    expect((await outboxDb.dump())[0].leaseOwner).toBe("replacement-tab");
  });

  test("keeps failed cleanup jobs with backoff and removes successful ones", async () => {
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      cleanupImplementation: async (remoteCatchId) => ({
        remoteCatchId,
        success: remoteCatchId === "remote-success",
      }),
      initialDbEntries: [createDbEntry("remote-success"), createDbEntry("remote-retry")],
    });

    expect(await module.flushDeleteOutbox()).toEqual({
      dequeuedCount: 1,
      processedCount: 2,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(2);
    const [storedEntry] = await outboxDb.dump();
    expect(storedEntry).toMatchObject({
      remoteCatchId: "remote-retry",
      attemptCount: 1,
      leaseOwner: null,
      leaseToken: null,
    });
    expect(new Date(storedEntry.nextAttemptAt).getTime()).toBeGreaterThan(
      new Date(storedEntry.lastAttemptAt).getTime(),
    );
  });

  test("only processes jobs owned by the active account", async () => {
    const otherSession = {
      token: "other-token",
      user: { id: "account-b", email: "account-b@example.test" },
    };
    const { cleanupRemoteCatch, module, outboxDb } = await loadCommunityDeleteOutbox({
      initialDbEntries: [createDbEntry("remote-a"), createDbEntry("remote-b", otherSession)],
    });

    expect(await module.flushDeleteOutbox()).toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledWith("remote-a");
    expect(await outboxDb.dump()).toEqual([
      expect.objectContaining({
        accountKey: accountKeyFor(otherSession),
        remoteCatchId: "remote-b",
      }),
    ]);
  });

  test("stops claiming new jobs when the active account changes during a flush", async () => {
    let resolveFirstCleanup;
    const firstCleanup = new Promise((resolve) => {
      resolveFirstCleanup = resolve;
    });
    const otherSession = {
      token: "other-token",
      user: { id: "account-b", email: "account-b@example.test" },
    };
    const { cleanupRemoteCatch, module, outboxDb, triggerSession } =
      await loadCommunityDeleteOutbox({
        cleanupImplementation: async (remoteCatchId) => {
          if (remoteCatchId === "remote-a-1") await firstCleanup;
          return { remoteCatchId, success: true };
        },
        initialDbEntries: [createDbEntry("remote-a-1"), createDbEntry("remote-a-2")],
      });

    const flushPromise = module.flushDeleteOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await triggerSession(otherSession);
    resolveFirstCleanup();

    expect(await flushPromise).toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
    expect(await outboxDb.dump()).toEqual([
      expect.objectContaining({ remoteCatchId: "remote-a-2" }),
    ]);
  });

  test("requires an authenticated account before enqueueing or flushing", async () => {
    const { cleanupRemoteCatch, module } = await loadCommunityDeleteOutbox({
      initialDbEntries: [createDbEntry("remote-a")],
      session: null,
    });

    expect(await module.enqueueDeleteRetry({ remoteCatchId: "remote-new" })).toBe(false);
    expect(await module.flushDeleteOutbox()).toEqual({
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).not.toHaveBeenCalled();
  });

  test("caps the outbox transactionally and rejects overlong remote identifiers", async () => {
    const { module, outboxDb } = await loadCommunityDeleteOutbox();

    for (let index = 0; index < module.MAX_OUTBOX_ENTRIES; index += 1) {
      expect(await module.enqueueDeleteRetry({ remoteCatchId: `remote-${index}` })).toBe(true);
    }

    expect(await module.enqueueDeleteRetry({ remoteCatchId: "remote-over-cap" })).toBe(false);
    expect(await module.enqueueDeleteRetry({ remoteCatchId: "x".repeat(257) })).toBe(false);
    expect(await outboxDb.dump()).toHaveLength(module.MAX_OUTBOX_ENTRIES);
  });

  test("allows an existing cleanup reservation when the outbox is at capacity", async () => {
    const initialDbEntries = Array.from({ length: 100 }, (_, index) =>
      createDbEntry(`remote-${index}`),
    );
    const { module, outboxDb } = await loadCommunityDeleteOutbox({ initialDbEntries });

    const reservation = await outboxDb.db.transaction("rw", outboxDb.db.communityDeleteOutbox, () =>
      module.reserveDeleteRetryInCurrentTransaction({
        accountKey: accountKeyFor(DEFAULT_SESSION),
        remoteCatchId: "remote-0",
      }),
    );

    expect(reservation).toEqual({ discardedCount: 0, enqueued: false, reserved: true });
    expect(await outboxDb.dump()).toHaveLength(100);
  });

  test("defers jobs until their retry backoff expires", async () => {
    const futureAttemptAt = new Date(Date.now() + 60_000).toISOString();
    const { cleanupRemoteCatch, module } = await loadCommunityDeleteOutbox({
      initialDbEntries: [
        createDbEntry("remote-later", DEFAULT_SESSION, {
          attemptCount: 1,
          nextAttemptAt: futureAttemptAt,
        }),
      ],
    });

    expect(await module.flushDeleteOutbox()).toEqual({
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).not.toHaveBeenCalled();

    expect(await module.flushDeleteOutbox({ force: true })).toEqual({
      dequeuedCount: 1,
      processedCount: 1,
      remainingCount: 0,
    });
  });

  test("visible foreground recovery force-retries backoff and reset removes lifecycle listeners", async () => {
    const globalEvents = new EventTarget();
    const documentEvents = new EventTarget();
    documentEvents.visibilityState = "visible";
    const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalAddEventListenerDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "addEventListener",
    );
    const originalRemoveEventListenerDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "removeEventListener",
    );

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentEvents,
    });
    Object.defineProperty(globalThis, "addEventListener", {
      configurable: true,
      value: globalEvents.addEventListener.bind(globalEvents),
    });
    Object.defineProperty(globalThis, "removeEventListener", {
      configurable: true,
      value: globalEvents.removeEventListener.bind(globalEvents),
    });

    try {
      const futureAttemptAt = new Date(Date.now() + 60_000).toISOString();
      const {
        cleanupRemoteCatch,
        module,
        outboxDb,
        reconcilePublicationRecoveryForCurrentSession,
      } = await loadCommunityDeleteOutbox({
        initialDbEntries: [
          createDbEntry("remote-mobile-recovery", DEFAULT_SESSION, {
            attemptCount: 1,
            nextAttemptAt: futureAttemptAt,
          }),
        ],
      });

      module.initializeDeleteOutbox();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(cleanupRemoteCatch).not.toHaveBeenCalled();
      expect(reconcilePublicationRecoveryForCurrentSession).toHaveBeenCalledTimes(1);

      documentEvents.dispatchEvent(new Event("visibilitychange"));
      expect(await waitForCondition(() => cleanupRemoteCatch.mock.calls.length === 1)).toBe(true);
      expect(reconcilePublicationRecoveryForCurrentSession).toHaveBeenCalledTimes(2);
      expect(await outboxDb.dump()).toEqual([]);

      module.resetDeleteOutboxForTests();
      await outboxDb.put(
        createDbEntry("remote-after-reset", DEFAULT_SESSION, {
          attemptCount: 1,
          nextAttemptAt: futureAttemptAt,
        }),
      );
      documentEvents.dispatchEvent(new Event("visibilitychange"));
      globalEvents.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
      expect(await outboxDb.dump()).toEqual([
        expect.objectContaining({ remoteCatchId: "remote-after-reset" }),
      ]);
    } finally {
      if (originalAddEventListenerDescriptor) {
        Object.defineProperty(globalThis, "addEventListener", originalAddEventListenerDescriptor);
      } else {
        delete globalThis.addEventListener;
      }
      if (originalRemoveEventListenerDescriptor) {
        Object.defineProperty(
          globalThis,
          "removeEventListener",
          originalRemoveEventListenerDescriptor,
        );
      } else {
        delete globalThis.removeEventListener;
      }
      if (originalDocumentDescriptor) {
        Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
      } else {
        delete globalThis.document;
      }
    }
  });
});
