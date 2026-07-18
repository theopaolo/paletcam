import { afterEach, expect, mock, test } from "bun:test";
import { deriveCommunityAccountKey } from "../community-account-key.js";

const moduleUrl = new URL("./moderation-sync.js", import.meta.url).href;
const apiModuleUrl = new URL("../community-api.js", import.meta.url).href;
const sessionModuleUrl = new URL("../community-session.js", import.meta.url).href;
const storageModuleUrl = new URL("../palette-storage.js", import.meta.url).href;
const errorsModuleUrl = new URL("./errors.js", import.meta.url).href;

afterEach(() => {
  mock.restore();
});

test("passes lifecycle cancellation through the moderation service to the API", async () => {
  const fetchCatchModerationStatuses = mock(async () => ({
    statuses: [],
    deletedIds: [],
  }));
  const bulkUpdateOwnedPaletteRemoteStates = mock(async () => 0);
  const controller = new AbortController();

  mock.module(apiModuleUrl, () => ({
    CATCH_MODERATION_STATUSES: {
      PRIVATE: "PRIVATE",
      TO_MODERATE: "TO_MODERATE",
    },
    fetchCatchModerationStatuses,
    normalizeCatchStatus: (value) => value || null,
  }));
  mock.module(sessionModuleUrl, () => ({
    getCommunitySession: () => ({ token: "token", email: "owner@example.com", user: null }),
  }));
  mock.module(storageModuleUrl, () => ({
    bulkUpdateOwnedPaletteRemoteStates,
    getSavedPalettes: mock(async () => [
      {
        id: 7,
        remoteCatchId: "catch-7",
        remoteOwnerAccountKey: deriveCommunityAccountKey({
          token: "token",
          email: "owner@example.com",
          user: null,
        }),
        moderationStatus: "PUBLIC",
      },
    ]),
  }));
  mock.module(errorsModuleUrl, () => ({ mapApiError: (error) => error }));

  const { syncPublishedPalettesModerationStatus } = await import(
    `${moduleUrl}?test=${Math.random()}`
  );
  await syncPublishedPalettesModerationStatus({ signal: controller.signal });

  expect(fetchCatchModerationStatuses).toHaveBeenCalledWith({
    token: "token",
    remoteCatchIds: ["catch-7"],
    signal: controller.signal,
  });
  expect(bulkUpdateOwnedPaletteRemoteStates).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        id: 7,
        expectedRemoteCatchId: "catch-7",
        patch: { lastModerationCheckAt: expect.any(String) },
      }),
    ],
    {
      ownerAccountKey: deriveCommunityAccountKey({
        token: "token",
        email: "owner@example.com",
        user: null,
      }),
    },
  );
});

test("persists 2,000 moderation changes through one bulk write", async () => {
  const ownerAccountKey = deriveCommunityAccountKey({
    token: "token",
    email: "owner@example.com",
    user: null,
  });
  const palettes = Array.from({ length: 2_000 }, (_, index) => ({
    id: index + 1,
    remoteCatchId: `catch-${index + 1}`,
    remoteOwnerAccountKey: ownerAccountKey,
    moderationStatus: "TO_MODERATE",
  }));
  const statuses = palettes.map((palette) => ({
    remoteCatchId: palette.remoteCatchId,
    status: "PUBLIC",
  }));
  const bulkUpdateOwnedPaletteRemoteStates = mock(async (updates) => updates.length);
  const updatePaletteRemoteState = mock(async () => {});

  mock.module(apiModuleUrl, () => ({
    CATCH_MODERATION_STATUSES: {
      PRIVATE: "PRIVATE",
      TO_MODERATE: "TO_MODERATE",
    },
    fetchCatchModerationStatuses: mock(async () => ({ statuses, deletedIds: [] })),
    normalizeCatchStatus: (value) => value || null,
  }));
  mock.module(sessionModuleUrl, () => ({
    getCommunitySession: () => ({ token: "token", email: "owner@example.com", user: null }),
  }));
  mock.module(storageModuleUrl, () => ({
    bulkUpdateOwnedPaletteRemoteStates,
    getSavedPalettes: mock(async () => palettes),
    updatePaletteRemoteState,
  }));
  mock.module(errorsModuleUrl, () => ({ mapApiError: (error) => error }));

  const { syncPublishedPalettesModerationStatus } = await import(
    `${moduleUrl}?test=${Math.random()}`
  );
  const result = await syncPublishedPalettesModerationStatus();

  expect(result).toEqual({ pendingCount: 0, updatedCount: 2_000 });
  expect(bulkUpdateOwnedPaletteRemoteStates).toHaveBeenCalledTimes(1);
  expect(bulkUpdateOwnedPaletteRemoteStates.mock.calls[0][0]).toHaveLength(2_000);
  expect(bulkUpdateOwnedPaletteRemoteStates.mock.calls[0][0][0]).toMatchObject({
    id: 1,
    expectedRemoteCatchId: "catch-1",
    patch: { moderationStatus: "PUBLIC" },
  });
  expect(updatePaletteRemoteState).not.toHaveBeenCalled();
});

test("does not synchronize catches owned by another local account", async () => {
  const session = { token: "token", email: "owner@example.com", user: null };
  const fetchCatchModerationStatuses = mock(async () => ({ statuses: [], deletedIds: [] }));

  mock.module(apiModuleUrl, () => ({
    CATCH_MODERATION_STATUSES: { PRIVATE: "PRIVATE", TO_MODERATE: "TO_MODERATE" },
    fetchCatchModerationStatuses,
    normalizeCatchStatus: (value) => value || null,
  }));
  mock.module(sessionModuleUrl, () => ({ getCommunitySession: () => session }));
  mock.module(storageModuleUrl, () => ({
    bulkUpdateOwnedPaletteRemoteStates: mock(async () => 0),
    getSavedPalettes: mock(async () => [
      {
        id: 1,
        remoteCatchId: "owned-catch",
        remoteOwnerAccountKey: deriveCommunityAccountKey(session),
      },
      {
        id: 2,
        remoteCatchId: "foreign-catch",
        remoteOwnerAccountKey: "account:0123456789abcdef",
      },
    ]),
  }));
  mock.module(errorsModuleUrl, () => ({ mapApiError: (error) => error }));

  const { syncPublishedPalettesModerationStatus } = await import(
    `${moduleUrl}?test=${Math.random()}`
  );
  await syncPublishedPalettesModerationStatus();

  expect(fetchCatchModerationStatuses).toHaveBeenCalledWith({
    token: "token",
    remoteCatchIds: ["owned-catch"],
    signal: undefined,
  });
});
