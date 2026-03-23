import { afterEach, describe, expect, mock, test } from "bun:test";

const communityApiModuleUrl = new URL("./community-api.js", import.meta.url).href;
const communitySessionModuleUrl = new URL("./community-session.js", import.meta.url).href;
const communityServiceModuleUrl = new URL("./community-service.js", import.meta.url).href;
const paletteStorageModuleUrl = new URL("./palette-storage.js", import.meta.url).href;

function normalizeCatchStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return ["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"].includes(normalized)
    ? normalized
    : null;
}

async function loadCommunityService({
  token = "",
  unpublishImplementation = async () => {},
  updatePaletteRemoteStateImplementation = async () => {},
} = {}) {
  const unpublishCatchFromCommunity = mock(unpublishImplementation);
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
    postCatchToCommunity: mock(async () => ({
      catch: {
        id: "remote-catch-id",
        status: "PUBLIC",
      },
    })),
    deleteAccount: mock(async () => ({})),
    requestAccountDeletionCode: mock(async () => ({})),
    requestCommunityLoginCode: mock(async () => ({})),
    unpublishCatchFromCommunity,
    verifyCommunityLoginCode: mock(async () => ({
      token: "verified-token",
      user: null,
    })),
  }));

  mock.module(communitySessionModuleUrl, () => ({
    clearCommunitySession: mock(() => {}),
    getCommunityAccessToken: mock(() => token),
    getCommunitySession: mock(() => (token ? { token, email: "user@example.com", user: null } : null)),
    setCommunitySession: mock((session) => session),
    subscribeCommunitySession: mock(() => () => {}),
  }));

  mock.module(paletteStorageModuleUrl, () => ({
    getSavedPalettes: mock(async () => []),
    updatePaletteRemoteState,
  }));

  const service = await import(`${communityServiceModuleUrl}?test=${Math.random()}`);

  return {
    service,
    unpublishCatchFromCommunity,
    updatePaletteRemoteState,
  };
}

afterEach(() => {
  mock.restore();
});

describe("cleanupPaletteRemoteCatchForDeletion", () => {
  test("skips remote cleanup when the palette was never published", async () => {
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } = await loadCommunityService();
    const palette = {
      id: 1,
      remoteCatchId: null,
      moderationStatus: null,
    };

    const result = await service.cleanupPaletteRemoteCatchForDeletion(palette);

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
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } = await loadCommunityService({
      token: "session-token",
    });
    const palette = {
      id: 7,
      remoteCatchId: "remote-7",
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatchForDeletion(palette);

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
    const { service, unpublishCatchFromCommunity, updatePaletteRemoteState } = await loadCommunityService();
    const palette = {
      id: 9,
      remoteCatchId: "remote-9",
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatchForDeletion(palette);

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
      moderationStatus: "PUBLIC",
    };

    const result = await service.cleanupPaletteRemoteCatchForDeletion(palette);

    expect(result.status).toBe("already_removed");
    expect(result.success).toBe(true);
    expect(updatePaletteRemoteState).toHaveBeenCalledTimes(1);
    expect(palette.moderationStatus).toBe("PRIVATE");
  });
});
