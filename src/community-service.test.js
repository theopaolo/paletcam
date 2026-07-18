import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  isCriticalOperationActive,
  resetCriticalOperationsForTests,
} from "./modules/critical-operation.js";
import { deriveCommunityAccountKey } from "./community-account-key.js";
import { communitySessionsEqual } from "./community-session.js";

const communityApiModuleUrl = new URL("./community-api.js", import.meta.url).href;
const communitySessionModuleUrl = new URL("./community-session.js", import.meta.url).href;
const communityServiceModuleUrl = new URL("./community-service.js", import.meta.url).href;
const paletteStorageModuleUrl = new URL("./palette-storage.js", import.meta.url).href;
const originalLocalStorage = globalThis.localStorage;

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class UnwritableStorage extends MemoryStorage {
  setItem() {
    throw new DOMException("Storage unavailable", "QuotaExceededError");
  }
}

function setTestLocalStorage(storage) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function normalizeCatchStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return ["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"].includes(normalized) ? normalized : null;
}

async function loadCommunityService({
  token = "",
  ensurePaletteMasterPhotoBlobImplementation = async (palette) => palette?.photoBlob ?? null,
  postImplementation = async () => ({
    catch: {
      id: "remote-catch-id",
      status: "PUBLIC",
    },
  }),
  unpublishImplementation = async () => {},
  bulkUpdateOwnedPaletteRemoteStatesImplementation = async () => 0,
  updatePaletteRemoteStateImplementation = async () => {},
} = {}) {
  if (!globalThis.localStorage) {
    setTestLocalStorage(new MemoryStorage());
  }
  let currentSession = token ? { token, email: "user@example.com", user: null } : null;
  const ensurePaletteMasterPhotoBlob = mock(ensurePaletteMasterPhotoBlobImplementation);
  const postCatchToCommunity = mock(postImplementation);
  const unpublishCatchFromCommunity = mock(unpublishImplementation);
  const bulkUpdateOwnedPaletteRemoteStates = mock(bulkUpdateOwnedPaletteRemoteStatesImplementation);
  const updatePaletteRemoteState = mock(updatePaletteRemoteStateImplementation);

  mock.module(communityApiModuleUrl, () => ({
    CATCH_MODERATION_STATUSES: Object.freeze({
      TO_MODERATE: "TO_MODERATE",
      PUBLIC: "PUBLIC",
      REJECTED: "REJECTED",
      PRIVATE: "PRIVATE",
    }),
    fetchCatchModerationStatuses: mock(async () => ({ statuses: [], deletedIds: [] })),
    normalizeCatchStatus,
    postCatchToCommunity,
    deleteAccount: mock(async () => ({})),
    requestAccountDeletionCode: mock(async () => ({})),
    requestCommunityLoginCode: mock(async () => ({})),
    unpublishCatchFromCommunity,
    verifyCommunityLoginCode: mock(async () => ({
      token: "verified-token",
      user: null,
    })),
  }));

  const clearCommunitySession = mock(() => {
    currentSession = null;
  });
  const getCommunityAccessToken = mock(() => currentSession?.token ?? "");
  const getCommunitySession = mock(() =>
    currentSession
      ? {
          ...currentSession,
          user: currentSession.user ? { ...currentSession.user } : null,
        }
      : null,
  );
  mock.module(communitySessionModuleUrl, () => ({
    clearCommunitySession,
    communitySessionsEqual,
    getCommunityAccessToken,
    getCommunitySession,
    setCommunitySession: mock((session) => session),
    subscribeCommunitySession: mock(() => () => {}),
  }));

  mock.module(paletteStorageModuleUrl, () => ({
    bulkUpdateOwnedPaletteRemoteStates,
    bulkUpdatePaletteRemoteStates: mock(async () => 0),
    clearCommunityStateForAccount: mock(async () => {}),
    clearPaletteRemoteStates: mock(async () => {}),
    ensurePaletteMasterPhotoBlob,
    getSavedPalettes: mock(async () => []),
    updatePaletteRemoteState,
  }));

  const service = await import(`${communityServiceModuleUrl}?test=${Math.random()}`);

  return {
    bulkUpdateOwnedPaletteRemoteStates,
    clearCommunitySession,
    ensurePaletteMasterPhotoBlob,
    getCommunitySession,
    postCatchToCommunity,
    service,
    setCurrentSession(nextSession) {
      currentSession = nextSession
        ? {
            ...nextSession,
            user: nextSession.user ? { ...nextSession.user } : null,
          }
        : null;
    },
    unpublishCatchFromCommunity,
    updatePaletteRemoteState,
  };
}

function createPublishablePalette(overrides = {}) {
  return {
    id: 17,
    timestamp: "2026-07-12T10:00:00.000Z",
    colors: [{ r: 12, g: 34, b: 56 }],
    captureAspectRatio: "4:3",
    captureCropRect: null,
    photoBlob: new Blob(["photo"], { type: "image/webp" }),
    remoteCatchId: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
    ...overrides,
  };
}

const TEST_OWNER_ACCOUNT_KEY = deriveCommunityAccountKey({
  token: "session-token",
  email: "user@example.com",
  user: null,
});

afterEach(() => {
  resetCriticalOperationsForTests();
  mock.restore();
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    setTestLocalStorage(originalLocalStorage);
  }
});

describe("cleanupPaletteRemoteCatch", () => {
  test("skips remote cleanup when the palette was never published", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService();
    const palette = {
      id: 1,
      remoteCatchId: null,
      moderationStatus: null,
    };

    const result = await service.cleanupPaletteRemoteCatch(palette);

    expect(result).toEqual({
      attempted: false,
      remoteCatchId: "",
      status: "not_published",
      success: true,
    });
    expect(unpublishCatchFromCommunity).not.toHaveBeenCalled();
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
  });

  test("unpublishes the remote catch and marks the palette private locally", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({
        token: "session-token",
      });
    const palette = {
      id: 7,
      remoteCatchId: "remote-7",
      remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatch(palette);

    expect(result.status).toBe("unpublished");
    expect(result.success).toBe(true);
    expect(unpublishCatchFromCommunity).toHaveBeenCalledWith({
      remoteCatchId: "remote-7",
      token: "session-token",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(1);
    expect(updatePaletteRemoteState.mock.calls[0][0]).toBe(7);
    expect(updatePaletteRemoteState.mock.calls[0][1]).toMatchObject({
      moderationStatus: "PRIVATE",
    });
    expect(palette.moderationStatus).toBe("PRIVATE");
  });

  test("returns an authentication warning when the user is no longer connected", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService();
    const palette = {
      id: 9,
      remoteCatchId: "remote-9",
      remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatch(palette);

    expect(result.status).toBe("authentication_required");
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_AUTHENTICATED");
    expect(unpublishCatchFromCommunity).not.toHaveBeenCalled();
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
  });

  test("treats a missing remote catch as already removed", async () => {
    const notFoundError = /** @type {Error & { status: number }} */ (new Error("Not found"));
    notFoundError.status = 404;

    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      unpublishImplementation: async () => {
        throw notFoundError;
      },
    });
    const palette = {
      id: 11,
      remoteCatchId: "remote-11",
      remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatch(palette);

    expect(result.status).toBe("already_removed");
    expect(result.success).toBe(true);
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(1);
    expect(palette.moderationStatus).toBe("PRIVATE");
  });

  test("claims an ownerless legacy palette after authenticated cleanup succeeds", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({
        token: "session-token",
      });
    const palette = {
      id: 12,
      remoteCatchId: "legacy-remote",
      remoteOwnerAccountKey: null,
      moderationStatus: "PUBLIC",
    };

    await expect(service.cleanupPaletteRemoteCatch(palette)).resolves.toMatchObject({
      status: "unpublished",
      success: true,
    });
    expect(unpublishCatchFromCommunity).toHaveBeenCalledWith({
      remoteCatchId: "legacy-remote",
      token: "session-token",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        moderationStatus: "PRIVATE",
        remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      }),
    );
    expect(palette.remoteOwnerAccountKey).toBe(TEST_OWNER_ACCOUNT_KEY);
  });

  test("does not claim an ownerless legacy palette from a concealed not-found response", async () => {
    const notFoundError = Object.assign(new Error("missing"), { status: 404 });
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      unpublishImplementation: async () => {
        throw notFoundError;
      },
    });
    const palette = {
      id: 12,
      remoteCatchId: "legacy-remote",
      remoteOwnerAccountKey: null,
      moderationStatus: "PUBLIC",
    };

    await expect(service.cleanupPaletteRemoteCatch(palette)).resolves.toMatchObject({
      error: expect.objectContaining({ code: "REMOTE_OWNER_UNKNOWN" }),
      status: "failed",
      success: false,
    });
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
    expect(palette.remoteOwnerAccountKey).toBeNull();
  });
});

describe("publishPaletteToCommunityFeed", () => {
  test("persists the publishing account owner with the remote catch", async () => {
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
    });
    const palette = createPublishablePalette();

    await service.publishPaletteToCommunityFeed(palette);

    const ownerAccountKey = deriveCommunityAccountKey({
      token: "session-token",
      email: "user@example.com",
      user: null,
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledWith(
      palette.id,
      expect.objectContaining({
        remoteCatchId: "remote-catch-id",
        remoteOwnerAccountKey: ownerAccountKey,
      }),
    );
    expect(palette.remoteOwnerAccountKey).toBe(ownerAccountKey);
  });

  test("does not POST when durable publication recovery storage is unavailable", async () => {
    setTestLocalStorage(new UnwritableStorage());
    const { postCatchToCommunity, service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
    });

    await expect(
      service.publishPaletteToCommunityFeed(createPublishablePalette()),
    ).rejects.toMatchObject({ code: "PUBLICATION_RECOVERY_UNAVAILABLE" });

    expect(postCatchToCommunity).not.toHaveBeenCalled();
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
  });

  test("does not POST when the bounded recovery journal has no free slot", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "paletcam:community:publication-recovery:v1",
      JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          operationKey: `paletcam-publish-${index.toString(16).padStart(16, "0")}`,
          paletteId: index + 1,
          remoteCatchId: `remote-${index}`,
          remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
          moderationStatus: "PUBLIC",
        })),
      ),
    );
    setTestLocalStorage(storage);
    const { postCatchToCommunity, service } = await loadCommunityService({
      token: "session-token",
    });

    await expect(
      service.publishPaletteToCommunityFeed(createPublishablePalette()),
    ).rejects.toMatchObject({ code: "PUBLICATION_RECOVERY_UNAVAILABLE" });

    expect(postCatchToCommunity).not.toHaveBeenCalled();
  });

  test("releases a recovery reservation after a definitive client rejection", async () => {
    const storage = new MemoryStorage();
    setTestLocalStorage(storage);
    const rejection = Object.assign(new Error("invalid payload"), { status: 422 });
    const { service } = await loadCommunityService({
      token: "session-token",
      postImplementation: async () => {
        throw rejection;
      },
    });

    await expect(
      service.publishPaletteToCommunityFeed(createPublishablePalette()),
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expect(storage.getItem("paletcam:community:publication-recovery:v1")).toBeNull();
  });

  test("keeps reload-sensitive work active until the remote publication settles", async () => {
    let resolvePost;
    const postResult = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const { service } = await loadCommunityService({
      token: "session-token",
      postImplementation: () => postResult,
    });

    const publication = service.publishPaletteToCommunityFeed(createPublishablePalette());
    expect(isCriticalOperationActive()).toBe(true);

    resolvePost({ catch: { id: "remote-catch-id", status: "PUBLIC" } });
    await publication;

    expect(isCriticalOperationActive()).toBe(false);
  });

  test("hydrates the master photo blob before encoding when publishing from a list-loaded palette", async () => {
    const hydratedBlob = new Blob(["photo"], { type: "image/webp" });
    const {
      ensurePaletteMasterPhotoBlob,
      postCatchToCommunity,
      service,
      updatePaletteRemoteState,
    } = await loadCommunityService({
      token: "session-token",
      ensurePaletteMasterPhotoBlobImplementation: async (palette) => {
        palette.photoBlob = hydratedBlob;
        return hydratedBlob;
      },
    });
    const palette = createPublishablePalette({
      photoBlob: null,
    });

    const result = await service.publishPaletteToCommunityFeed(palette);

    expect(ensurePaletteMasterPhotoBlob).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      moderationStatus: "PUBLIC",
      remoteCatchId: "remote-catch-id",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(1);
    expect(palette.photoBlob).toBe(hydratedBlob);
    expect(postCatchToCommunity.mock.calls[0][0].operationKey).toMatch(
      /^paletcam-publish-[a-f0-9]{16,64}$/,
    );
  });

  test("aborts before POST when the session changes while encoding one photo", async () => {
    let setCurrentSession = () => {};
    class SessionChangingBlob extends Blob {
      async arrayBuffer() {
        setCurrentSession({ token: "new-token", email: "new@example.com", user: null });
        return super.arrayBuffer();
      }
    }

    const harness = await loadCommunityService({ token: "session-token" });
    setCurrentSession = harness.setCurrentSession;
    const palette = createPublishablePalette({
      photoBlob: new SessionChangingBlob(["photo"], { type: "image/webp" }),
    });

    await expect(harness.service.publishPaletteToCommunityFeed(palette)).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(harness.postCatchToCommunity).not.toHaveBeenCalled();
    expect(harness.updatePaletteRemoteState).not.toHaveBeenCalled();
  });

  test("compensates with the originating token when the session changes during POST", async () => {
    let setCurrentSession = () => {};
    const harness = await loadCommunityService({
      token: "session-token",
      postImplementation: async () => {
        setCurrentSession({ token: "new-token", email: "new@example.com", user: null });
        return { catch: { id: "remote-from-old-session", status: "PUBLIC" } };
      },
    });
    setCurrentSession = harness.setCurrentSession;
    const palette = createPublishablePalette();

    await expect(harness.service.publishPaletteToCommunityFeed(palette)).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(harness.postCatchToCommunity.mock.calls[0][0]).toMatchObject({
      token: "session-token",
    });
    expect(harness.unpublishCatchFromCommunity).toHaveBeenCalledWith({
      token: "session-token",
      remoteCatchId: "remote-from-old-session",
    });
    expect(harness.updatePaletteRemoteState).not.toHaveBeenCalled();
    expect(palette.remoteCatchId).toBeNull();
  });

  test("retries a transient local publication-state write before compensating", async () => {
    let writeCount = 0;
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({
        token: "session-token",
        updatePaletteRemoteStateImplementation: async () => {
          writeCount += 1;
          if (writeCount === 1) throw new Error("temporary IndexedDB failure");
        },
      });
    const palette = createPublishablePalette();

    await expect(service.publishPaletteToCommunityFeed(palette)).resolves.toMatchObject({
      moderationStatus: "PUBLIC",
      remoteCatchId: "remote-catch-id",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(2);
    expect(unpublishCatchFromCommunity).not.toHaveBeenCalled();
    expect(palette.remoteCatchId).toBe("remote-catch-id");
  });

  test("rolls back the remote publication when local state cannot be persisted", async () => {
    const persistenceError = new Error("IndexedDB unavailable");
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({
        token: "session-token",
        updatePaletteRemoteStateImplementation: async () => {
          throw persistenceError;
        },
      });
    const palette = createPublishablePalette();

    await expect(service.publishPaletteToCommunityFeed(palette)).rejects.toMatchObject({
      name: "CommunityServiceError",
      code: "LOCAL_PERSISTENCE_FAILED",
      cause: persistenceError,
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(2);
    expect(unpublishCatchFromCommunity).toHaveBeenCalledWith({
      token: "session-token",
      remoteCatchId: "remote-catch-id",
    });
    expect(palette.remoteCatchId).toBeNull();
  });

  test("retains the remote identity in memory when persistence and compensation both fail", async () => {
    const { service, unpublishCatchFromCommunity } = await loadCommunityService({
      token: "session-token",
      updatePaletteRemoteStateImplementation: async () => {
        throw new Error("IndexedDB unavailable");
      },
      unpublishImplementation: async () => {
        throw new Error("network unavailable");
      },
    });
    const palette = createPublishablePalette();

    await expect(service.publishPaletteToCommunityFeed(palette)).rejects.toMatchObject({
      name: "CommunityServiceError",
      code: "PUBLICATION_STATE_UNCERTAIN",
    });
    expect(unpublishCatchFromCommunity).toHaveBeenCalledTimes(1);
    expect(palette).toMatchObject({
      remoteCatchId: "remote-catch-id",
      moderationStatus: "PUBLIC",
    });
    expect(
      JSON.parse(globalThis.localStorage.getItem("paletcam:community:publication-recovery:v1")),
    ).toEqual([
      expect.objectContaining({ paletteId: palette.id, remoteCatchId: "remote-catch-id" }),
    ]);
  });

  test("reconciles an uncertain publication by palette id after reload", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "paletcam:community:publication-recovery:v1",
      JSON.stringify([
        {
          operationKey: "paletcam-publish-0123456789abcdef",
          paletteId: 17,
          remoteCatchId: "remote-after-reload",
          remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
          moderationStatus: "PUBLIC",
          state: "remote_created",
        },
      ]),
    );
    setTestLocalStorage(storage);
    const { bulkUpdateOwnedPaletteRemoteStates, service, unpublishCatchFromCommunity } =
      await loadCommunityService({ token: "session-token" });

    await expect(
      service.reconcilePublicationRecoveryForCurrentSession({ paletteId: 17 }),
    ).resolves.toEqual({ reconciledCount: 1, remainingCount: 0 });
    expect(unpublishCatchFromCommunity).toHaveBeenCalledWith({
      token: "session-token",
      remoteCatchId: "remote-after-reload",
    });
    expect(bulkUpdateOwnedPaletteRemoteStates).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 17,
          expectedRemoteCatchId: "remote-after-reload",
          patch: expect.objectContaining({ moderationStatus: "PRIVATE" }),
        }),
      ],
      { ownerAccountKey: TEST_OWNER_ACCOUNT_KEY },
    );
    expect(storage.getItem("paletcam:community:publication-recovery:v1")).toBeNull();
  });

  test("blocks deletion reconciliation while a POST outcome has no remote id", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "paletcam:community:publication-recovery:v1",
      JSON.stringify([
        {
          operationKey: "paletcam-publish-fedcba9876543210",
          paletteId: 17,
          remoteCatchId: null,
          remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
          state: "reserved",
        },
      ]),
    );
    setTestLocalStorage(storage);
    const { service, unpublishCatchFromCommunity } = await loadCommunityService({
      token: "session-token",
    });

    await expect(
      service.reconcilePublicationRecoveryForCurrentSession({ paletteId: 17 }),
    ).rejects.toMatchObject({ code: "PUBLICATION_STATE_UNCERTAIN" });
    expect(unpublishCatchFromCommunity).not.toHaveBeenCalled();
    expect(storage.getItem("paletcam:community:publication-recovery:v1")).not.toBeNull();
  });

  test("blocks a duplicate repost after reload until the pending remote catch is reconciled", async () => {
    setTestLocalStorage(new MemoryStorage());
    const { postCatchToCommunity, service, unpublishCatchFromCommunity } =
      await loadCommunityService({
        token: "session-token",
        updatePaletteRemoteStateImplementation: async () => {
          throw new Error("IndexedDB unavailable");
        },
        unpublishImplementation: async () => {
          throw new Error("network unavailable");
        },
      });

    await expect(
      service.publishPaletteToCommunityFeed(createPublishablePalette()),
    ).rejects.toMatchObject({ code: "PUBLICATION_STATE_UNCERTAIN" });

    const reloadedPalette = createPublishablePalette();
    await expect(service.publishPaletteToCommunityFeed(reloadedPalette)).rejects.toMatchObject({
      code: "PUBLICATION_STATE_UNCERTAIN",
    });

    expect(postCatchToCommunity).toHaveBeenCalledTimes(1);
    expect(unpublishCatchFromCommunity).toHaveBeenCalledTimes(2);
    expect(reloadedPalette.remoteCatchId).toBe("remote-catch-id");
  });
});

describe("unpublishPaletteFromCommunityFeed", () => {
  function createPublishedPalette() {
    return createPublishablePalette({
      remoteCatchId: "remote-catch-id",
      remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      moderationStatus: "PUBLIC",
    });
  }

  test("retries local persistence after the remote unpublish succeeds", async () => {
    let writeCount = 0;
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({
        token: "session-token",
        updatePaletteRemoteStateImplementation: async () => {
          writeCount += 1;
          if (writeCount === 1) throw new Error("temporary IndexedDB failure");
        },
      });
    const palette = createPublishedPalette();

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).resolves.toMatchObject({
      moderationStatus: "PRIVATE",
      remoteCatchId: "remote-catch-id",
    });
    expect(unpublishCatchFromCommunity).toHaveBeenCalledTimes(1);
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(2);
    expect(palette.moderationStatus).toBe("PRIVATE");
  });

  test("refuses a known remote-owner mismatch before calling the API", async () => {
    const { service, unpublishCatchFromCommunity } = await loadCommunityService({
      token: "session-token",
    });
    const palette = createPublishedPalette();
    palette.remoteOwnerAccountKey = "account:0123456789abcdef";

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).rejects.toMatchObject({
      code: "REMOTE_OWNER_MISMATCH",
    });
    expect(unpublishCatchFromCommunity).not.toHaveBeenCalled();
  });

  test("claims an ownerless legacy palette after authenticated unpublish succeeds", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } =
      await loadCommunityService({ token: "session-token" });
    const palette = createPublishedPalette();
    palette.remoteOwnerAccountKey = null;

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).resolves.toMatchObject({
      moderationStatus: "PRIVATE",
      remoteCatchId: "remote-catch-id",
    });
    expect(unpublishCatchFromCommunity).toHaveBeenCalledWith({
      remoteCatchId: "remote-catch-id",
      token: "session-token",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledWith(
      palette.id,
      expect.objectContaining({
        moderationStatus: "PRIVATE",
        remoteOwnerAccountKey: TEST_OWNER_ACCOUNT_KEY,
      }),
    );
    expect(palette.remoteOwnerAccountKey).toBe(TEST_OWNER_ACCOUNT_KEY);
  });

  test("does not claim an ownerless legacy palette when the server cannot verify it", async () => {
    const forbiddenError = Object.assign(new Error("forbidden"), { status: 403 });
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      unpublishImplementation: async () => {
        throw forbiddenError;
      },
    });
    const palette = createPublishedPalette();
    palette.remoteOwnerAccountKey = null;

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).rejects.toMatchObject({
      code: "API_ERROR",
    });
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
    expect(palette.remoteOwnerAccountKey).toBeNull();
    expect(palette.moderationStatus).toBe("PUBLIC");
  });

  test("does not claim an ownerless legacy palette from a concealed not-found response", async () => {
    const notFoundError = Object.assign(new Error("missing"), { status: 404 });
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      unpublishImplementation: async () => {
        throw notFoundError;
      },
    });
    const palette = createPublishedPalette();
    palette.remoteOwnerAccountKey = null;

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).rejects.toMatchObject({
      code: "REMOTE_OWNER_UNKNOWN",
      cause: notFoundError,
    });
    expect(updatePaletteRemoteState).not.toHaveBeenCalled();
    expect(palette.remoteOwnerAccountKey).toBeNull();
  });

  test("converges local state when the remote catch is already absent", async () => {
    const notFoundError = Object.assign(new Error("missing"), { status: 404 });
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      unpublishImplementation: async () => {
        throw notFoundError;
      },
    });
    const palette = createPublishedPalette();

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).resolves.toMatchObject({
      moderationStatus: "PRIVATE",
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(1);
    expect(palette.moderationStatus).toBe("PRIVATE");
  });

  test("keeps the running session private when local persistence remains unavailable", async () => {
    const persistenceError = new Error("IndexedDB unavailable");
    const { service, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
      updatePaletteRemoteStateImplementation: async () => {
        throw persistenceError;
      },
    });
    const palette = createPublishedPalette();

    await expect(service.unpublishPaletteFromCommunityFeed(palette)).rejects.toMatchObject({
      code: "LOCAL_PERSISTENCE_FAILED",
      cause: persistenceError,
    });
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(2);
    expect(palette.moderationStatus).toBe("PRIVATE");
  });
});
