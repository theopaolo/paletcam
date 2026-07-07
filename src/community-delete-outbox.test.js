import { afterEach, describe, expect, mock, test } from "bun:test";

const OUTBOX_STORAGE_KEY = "paletcam:community:delete-cleanup-outbox:v1";
const communityApiModuleUrl = new URL("./community-api.js", import.meta.url).href;
const communityServiceModuleUrl = new URL("./community-service.js", import.meta.url).href;
const communitySessionModuleUrl = new URL("./community-session.js", import.meta.url).href;
const communityDeleteOutboxModuleUrl = new URL("./community-delete-outbox.js", import.meta.url)
  .href;

let currentOutboxModule = null;

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

async function loadCommunityDeleteOutbox({
  cleanupImplementation = async (remoteCatchId) => ({
    attempted: true,
    remoteCatchId,
    status: "unpublished",
    success: true,
  }),
  initialEntries = null,
} = {}) {
  const cleanupRemoteCatch = mock(cleanupImplementation);
  let sessionListener = null;

  // community-service.js imports deleteAccount from community-api.js — mock it to avoid link errors
  mock.module(communityApiModuleUrl, () => ({
    deleteAccount: mock(async () => ({})),
    requestAccountDeletionCode: mock(async () => ({})),
  }));

  mock.module(communityServiceModuleUrl, () => ({
    cleanupRemoteCatch,
  }));

  mock.module(communitySessionModuleUrl, () => ({
    subscribeCommunitySession: mock((listener) => {
      sessionListener = listener;
      return () => {
        if (sessionListener === listener) {
          sessionListener = null;
        }
      };
    }),
  }));

  const localStorageMock = createLocalStorageMock(initialEntries);
  globalThis.localStorage = localStorageMock;

  const module = await import(`${communityDeleteOutboxModuleUrl}?test=${Math.random()}`);
  currentOutboxModule = module;

  return {
    cleanupRemoteCatch,
    localStorageMock,
    module,
    triggerSession: async (session) => {
      sessionListener?.(session);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

afterEach(() => {
  currentOutboxModule?.resetDeleteOutboxForTests?.();
  currentOutboxModule = null;
  delete globalThis.localStorage;
  mock.restore();
});

describe("community deletion cleanup outbox", () => {
  test("deduplicates queued remote catches", async () => {
    const { module, localStorageMock } = await loadCommunityDeleteOutbox();

    expect(module.enqueueDeleteRetry({ remoteCatchId: " remote-1 " })).toBe(true);
    expect(module.enqueueDeleteRetry({ remoteCatchId: "remote-1" })).toBe(false);

    const storedEntries = JSON.parse(localStorageMock.dump(OUTBOX_STORAGE_KEY));
    expect(storedEntries).toHaveLength(1);
    expect(storedEntries[0].remoteCatchId).toBe("remote-1");
    expect(storedEntries[0].attemptCount).toBe(0);
  });

  test("keeps failed cleanup jobs and removes successful ones", async () => {
    const { cleanupRemoteCatch, localStorageMock, module } = await loadCommunityDeleteOutbox({
      cleanupImplementation: async (remoteCatchId) => {
        if (remoteCatchId === "remote-success") {
          return {
            attempted: true,
            remoteCatchId,
            status: "unpublished",
            success: true,
          };
        }

        return {
          attempted: true,
          error: new Error("network"),
          remoteCatchId,
          status: "failed",
          success: false,
        };
      },
      initialEntries: [{ remoteCatchId: "remote-success" }, { remoteCatchId: "remote-retry" }],
    });

    const result = await module.flushDeleteOutbox();

    expect(result).toEqual({
      dequeuedCount: 1,
      processedCount: 2,
      remainingCount: 1,
    });
    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(2);

    const storedEntries = JSON.parse(localStorageMock.dump(OUTBOX_STORAGE_KEY));
    expect(storedEntries).toHaveLength(1);
    expect(storedEntries[0].remoteCatchId).toBe("remote-retry");
    expect(storedEntries[0].attemptCount).toBe(1);
    expect(storedEntries[0].lastAttemptAt).not.toBeNull();
  });

  test("retries queued deletions when the community session comes back", async () => {
    let isAuthenticated = false;

    const { cleanupRemoteCatch, localStorageMock, module, triggerSession } =
      await loadCommunityDeleteOutbox({
        cleanupImplementation: async (remoteCatchId) => {
          if (!isAuthenticated) {
            return {
              attempted: false,
              error: Object.assign(new Error("Authentication required."), {
                code: "NOT_AUTHENTICATED",
              }),
              remoteCatchId,
              status: "authentication_required",
              success: false,
            };
          }

          return {
            attempted: true,
            remoteCatchId,
            status: "unpublished",
            success: true,
          };
        },
        initialEntries: [{ remoteCatchId: "remote-login" }],
      });

    module.initializeDeleteOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorageMock.dump(OUTBOX_STORAGE_KEY))).toHaveLength(1);

    isAuthenticated = true;
    await triggerSession({ token: "session-token" });

    expect(cleanupRemoteCatch).toHaveBeenCalledTimes(2);
    expect(localStorageMock.dump(OUTBOX_STORAGE_KEY)).toBeNull();
  });
});
