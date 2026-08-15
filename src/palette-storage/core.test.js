import { afterEach, describe, expect, mock, test } from "bun:test";

import { resetAppSettingsForTests, updateAppSettings } from "../app-settings.js";

const coreModuleUrl = new URL("./core.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../modules/error-reporting.js", import.meta.url).href;

async function loadCoreModule({
  bulkUpdateError = null,
  putError = null,
  storedOutboxEntries = [],
  storedPalettes = [],
  updateResult = 1,
} = {}) {
  const add = mock(async () => 101);
  const bulkUpdate = mock(async (updates) => {
    if (bulkUpdateError) throw bulkUpdateError;
    return updates.length;
  });
  const bulkPut = mock(async () => {});
  const previewBulkPut = mock(async () => {});
  const previewBulkDelete = mock(async () => {});
  const previewClear = mock(async () => {});
  const paletteDelete = mock(async () => {});
  const paletteClear = mock(async () => {});
  const assetDelete = mock(async () => {});
  const assetClear = mock(async () => {});
  const outboxClear = mock(async () => {});
  const outboxDeleteForAccount = mock(async (accountKey) => {
    const matchingEntries = storedOutboxEntries.filter((entry) => entry?.accountKey === accountKey);
    return matchingEntries.length;
  });
  const metadataClear = mock(async () => {});
  const importStagingClear = mock(async () => {});
  const put = mock(async () => {
    if (putError) throw putError;
  });
  const update = mock(async () => updateResult);
  const transaction = mock(async (...args) => args.at(-1)());
  const reportAppError = mock(() => ({}));

  mock.module(dbModuleUrl, () => ({
    db: {
      transaction,
      palettes: {
        add,
        bulkGet: mock(async (ids) =>
          ids.map((id) => storedPalettes.find((palette) => palette?.id === id)),
        ),
        bulkPut,
        bulkUpdate,
        clear: paletteClear,
        delete: paletteDelete,
        get: mock(async (id) => storedPalettes.find((palette) => palette?.id === id)),
        orderBy: mock(() => ({
          reverse: mock(() => ({
            toArray: mock(async () => storedPalettes),
          })),
        })),
        toArray: mock(async () => storedPalettes),
        update,
      },
      paletteAssets: {
        clear: assetClear,
        delete: assetDelete,
        put,
      },
      palettePreviews: {
        bulkDelete: previewBulkDelete,
        bulkPut: previewBulkPut,
        clear: previewClear,
      },
      communityDeleteOutbox: {
        clear: outboxClear,
        where: mock(() => ({
          equals: mock((accountKey) => ({
            delete: () => outboxDeleteForAccount(accountKey),
          })),
        })),
      },
      paletteStorageMetadata: {
        clear: metadataClear,
      },
      paletteImportStaging: {
        clear: importStagingClear,
      },
    },
  }));
  mock.module(errorReportingModuleUrl, () => ({ reportAppError }));

  const module = await import(`${coreModuleUrl}?test=${Math.random()}`);

  return {
    add,
    bulkPut,
    bulkUpdate,
    assetClear,
    assetDelete,
    module,
    importStagingClear,
    metadataClear,
    outboxClear,
    outboxDeleteForAccount,
    paletteClear,
    paletteDelete,
    previewBulkDelete,
    previewBulkPut,
    previewClear,
    put,
    reportAppError,
    transaction,
    update,
  };
}

afterEach(() => {
  resetAppSettingsForTests();
  mock.restore();
});

describe("palette-storage/core", () => {
  test("stars every existing palette in one transaction and reports the applied timestamp", async () => {
    const { bulkUpdate, module, transaction } = await loadCoreModule({
      storedPalettes: [
        { id: 7, timestamp: "2026-05-01T10:00:00.000Z", colors: [] },
        { id: 9, timestamp: "2026-05-02T10:00:00.000Z", colors: [] },
      ],
    });

    const result = await module.setPaletteFavorites([7, 9], true);

    expect(transaction).toHaveBeenCalled();
    expect(result.updatedIds).toEqual([7, 9]);
    expect(typeof result.favoritedAt).toBe("string");
    expect(bulkUpdate.mock.calls[0][0]).toEqual([
      {
        key: 7,
        changes: { favoritedAt: result.favoritedAt, backupDirtyAt: expect.any(String) },
      },
      {
        key: 9,
        changes: { favoritedAt: result.favoritedAt, backupDirtyAt: expect.any(String) },
      },
    ]);
  });

  test("unstarring clears the timestamp so the record leaves the favorites index", async () => {
    const { bulkUpdate, module } = await loadCoreModule({
      storedPalettes: [{ id: 7, timestamp: "2026-05-01T10:00:00.000Z", colors: [] }],
    });

    const result = await module.setPaletteFavorites([7], false);

    expect(result.favoritedAt).toBeNull();
    expect(bulkUpdate.mock.calls[0][0]).toEqual([
      { key: 7, changes: { favoritedAt: null, backupDirtyAt: expect.any(String) } },
    ]);
  });

  test("skips missing palettes instead of failing a stale selection", async () => {
    const { bulkUpdate, module } = await loadCoreModule({
      storedPalettes: [{ id: 7, timestamp: "2026-05-01T10:00:00.000Z", colors: [] }],
    });

    const result = await module.setPaletteFavorites([7, 404], true);

    expect(result.updatedIds).toEqual([7]);
    expect(bulkUpdate.mock.calls[0][0]).toEqual([
      {
        key: 7,
        changes: { favoritedAt: result.favoritedAt, backupDirtyAt: expect.any(String) },
      },
    ]);
  });

  test("writes nothing when no selected palette still exists", async () => {
    const { bulkUpdate, module } = await loadCoreModule({ storedPalettes: [] });

    const result = await module.setPaletteFavorites([404], true);

    expect(result.updatedIds).toEqual([]);
    expect(bulkUpdate).not.toHaveBeenCalled();
  });

  test("keeps collection reads read-only when legacy render settings are missing", async () => {
    const { bulkPut, module, update } = await loadCoreModule({
      storedPalettes: [
        {
          id: 7,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          previewViewerBlob: new Blob(["preview"], { type: "image/webp" }),
        },
      ],
    });

    const palettes = await module.getSavedPalettes();

    expect(palettes[0].polaroidRenderSettings).toBeNull();
    expect(palettes[0].previewViewerBlob).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(bulkPut).not.toHaveBeenCalled();
  });

  test("does not rewrite blob-bearing palette records during collection reads", async () => {
    const { bulkPut, module, update } = await loadCoreModule({
      storedPalettes: [
        {
          id: 8,
          timestamp: "2026-05-01T10:00:00.000Z",
          colors: [{ r: 1, g: 2, b: 3 }],
          previewGalleryBlob: new Blob(["preview"], { type: "image/webp" }),
        },
      ],
    });

    const palettes = await module.getSavedPalettes();

    expect(palettes[0].previewGalleryBlob).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(bulkPut).not.toHaveBeenCalled();
  });

  test("omits corrupt palette metadata without mutating authoritative storage", async () => {
    const validRecord = {
      id: 11,
      timestamp: "2026-07-13T10:00:00.000Z",
      colors: [{ r: 12, g: 34, b: 56 }],
      captureAspectRatio: "4:3",
    };
    const corruptRecord = {
      id: 12,
      timestamp: "2026-07-13T10:01:00.000Z",
      colors: [{ r: 999, g: 34, b: 56 }],
      injectedField: { remoteCatchId: "must-not-be-reported" },
    };
    const corruptSnapshot = structuredClone(corruptRecord);
    const storedPalettes = [validRecord, corruptRecord];
    const { bulkPut, module, paletteDelete, reportAppError, transaction, update } =
      await loadCoreModule({ storedPalettes });

    await expect(module.getSavedPalettes()).resolves.toEqual([
      expect.objectContaining({ id: 11, colors: [{ r: 12, g: 34, b: 56 }] }),
    ]);

    expect(corruptRecord).toEqual(corruptSnapshot);
    expect(storedPalettes).toEqual([validRecord, corruptSnapshot]);
    expect(update).not.toHaveBeenCalled();
    expect(bulkPut).not.toHaveBeenCalled();
    expect(paletteDelete).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(reportAppError).toHaveBeenCalledTimes(1);
    expect(reportAppError).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        clientLogKey: "palette-storage-invalid-metadata",
        includeConsole: false,
        context: {
          invalidCount: 1,
          invalidCountCapped: false,
        },
      }),
    );
  });

  test("stores current polaroid render settings on new captures", async () => {
    updateAppSettings({ polaroidFooterLabel: "new capture" });
    const { add, module } = await loadCoreModule();
    const photoBlob = new Blob(["photo"], { type: "image/webp" });

    await module.savePalette([{ r: 1, g: 2, b: 3 }], { photoBlob });

    expect(add.mock.calls[0][0].polaroidRenderSettings).toEqual({
      footerLabel: "new capture",
    });
  });

  test("stores supplied previews outside metadata and returns a hydrated palette", async () => {
    const galleryBlob = new Blob(["gallery"], { type: "image/webp" });
    const viewerBlob = new Blob(["viewer"], { type: "image/webp" });
    const { add, module, previewBulkPut } = await loadCoreModule();

    const palette = await module.savePalette([{ r: 1, g: 2, b: 3 }], {
      photoBlob: new Blob(["photo"], { type: "image/webp" }),
      previewGalleryBlob: galleryBlob,
      previewGalleryFooterLabel: "gallery-v1",
      previewViewerBlob: viewerBlob,
      previewViewerFooterLabel: "viewer-v1",
    });

    expect(add.mock.calls[0][0]).not.toHaveProperty("previewGalleryBlob");
    expect(add.mock.calls[0][0]).not.toHaveProperty("previewViewerBlob");
    expect(previewBulkPut).toHaveBeenCalledWith([
      {
        paletteId: 101,
        variant: "gallery",
        blob: galleryBlob,
        footerLabel: "gallery-v1",
      },
      {
        paletteId: 101,
        variant: "viewer",
        blob: viewerBlob,
        footerLabel: "viewer-v1",
      },
    ]);
    expect(palette.previewGalleryBlob).toBe(galleryBlob);
    expect(palette.previewViewerBlob).toBe(viewerBlob);
  });

  test("preserves quota failure as the cause of an atomic save error", async () => {
    const quotaError = new DOMException("Storage quota exceeded", "QuotaExceededError");
    const { add, module, put, transaction } = await loadCoreModule({ putError: quotaError });
    const originalConsoleError = console.error;
    console.error = () => {};

    let caughtError = null;
    try {
      await module.savePalette([{ r: 1, g: 2, b: 3 }], {
        photoBlob: new Blob(["photo"], { type: "image/webp" }),
      });
    } catch (error) {
      caughtError = error;
    } finally {
      console.error = originalConsoleError;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError.message).toBe("Unable to save palette.");
    expect(caughtError.cause).toBe(quotaError);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("normalizes remote-state patches into one bulk transaction without per-record reads", async () => {
    const { bulkUpdate, module, transaction, update } = await loadCoreModule();

    const updatedCount = await module.bulkUpdatePaletteRemoteStates([
      {
        id: "7",
        patch: {
          moderationStatus: " public ",
          moderationUpdatedAt: "2026-07-13T10:00:00+02:00",
          remoteCatchId: " remote-7 ",
          remoteOwnerAccountKey: " account:0123456789abcdef ",
        },
      },
      {
        id: 8,
        patch: {
          lastModerationCheckAt: "invalid",
          postedAt: null,
        },
      },
    ]);

    expect(updatedCount).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
    expect(bulkUpdate).toHaveBeenCalledWith([
      {
        key: 7,
        changes: {
          remoteCatchId: "remote-7",
          remoteOwnerAccountKey: "account:0123456789abcdef",
          moderationStatus: "PUBLIC",
          moderationUpdatedAt: "2026-07-13T08:00:00.000Z",
          backupDirtyAt: expect.any(String),
        },
      },
      {
        key: 8,
        changes: {
          postedAt: null,
          lastModerationCheckAt: null,
          backupDirtyAt: expect.any(String),
        },
      },
    ]);
    expect(update).not.toHaveBeenCalled();
  });

  test("conditionally applies moderation updates only to the expected owner and remote catch", async () => {
    const ownerAccountKey = "account:aaaaaaaaaaaaaaaa";
    const foreignAccountKey = "account:bbbbbbbbbbbbbbbb";
    const { bulkUpdate, module, transaction } = await loadCoreModule({
      storedPalettes: [
        {
          id: 1,
          remoteCatchId: "remote-1",
          remoteOwnerAccountKey: ownerAccountKey,
        },
        {
          id: 2,
          remoteCatchId: "remote-2",
          remoteOwnerAccountKey: foreignAccountKey,
        },
        {
          id: 3,
          remoteCatchId: "remote-republished",
          remoteOwnerAccountKey: ownerAccountKey,
        },
        { id: 4, remoteCatchId: "remote-4", remoteOwnerAccountKey: null },
      ],
    });

    await expect(
      module.bulkUpdateOwnedPaletteRemoteStates(
        [
          {
            id: 1,
            expectedRemoteCatchId: "remote-1",
            patch: {
              moderationStatus: "public",
              lastModerationCheckAt: "2026-07-13T10:00:00Z",
            },
          },
          {
            id: 2,
            expectedRemoteCatchId: "remote-2",
            patch: { moderationStatus: "PRIVATE" },
          },
          {
            id: 3,
            expectedRemoteCatchId: "remote-3",
            patch: { moderationStatus: "PRIVATE" },
          },
          {
            id: 4,
            expectedRemoteCatchId: "remote-4",
            patch: { moderationStatus: "PRIVATE" },
          },
        ],
        { ownerAccountKey },
      ),
    ).resolves.toBe(1);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
    expect(bulkUpdate).toHaveBeenCalledWith([
      {
        key: 1,
        changes: {
          moderationStatus: "PUBLIC",
          lastModerationCheckAt: "2026-07-13T10:00:00.000Z",
          backupDirtyAt: expect.any(String),
        },
      },
    ]);
  });

  test("clears only the exact account community state and preserves foreign or ownerless rows", async () => {
    const ownerAccountKey = "account:aaaaaaaaaaaaaaaa";
    const ownerAliasAccountKey = "account:cccccccccccccccc";
    const foreignAccountKey = "account:bbbbbbbbbbbbbbbb";
    const { bulkUpdate, module, outboxDeleteForAccount, transaction } = await loadCoreModule({
      storedPalettes: [
        {
          id: 1,
          remoteCatchId: "remote-owned",
          remoteOwnerAccountKey: ownerAccountKey,
        },
        {
          id: 2,
          remoteCatchId: "remote-owned-alias",
          remoteOwnerAccountKey: ownerAliasAccountKey,
        },
        { id: 3, remoteCatchId: "remote-foreign", remoteOwnerAccountKey: foreignAccountKey },
        { id: 4, remoteCatchId: "remote-ownerless", remoteOwnerAccountKey: null },
      ],
      storedOutboxEntries: [
        { key: "owned", accountKey: ownerAccountKey },
        { key: "owned-alias", accountKey: ownerAliasAccountKey },
        { key: "foreign", accountKey: foreignAccountKey },
        { key: "ownerless", accountKey: null },
      ],
    });

    await expect(
      module.clearCommunityStateForAccount([ownerAccountKey, ownerAliasAccountKey]),
    ).resolves.toEqual({
      clearedOutboxCount: 2,
      clearedPaletteCount: 2,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outboxDeleteForAccount).toHaveBeenCalledTimes(2);
    expect(outboxDeleteForAccount).toHaveBeenCalledWith(ownerAccountKey);
    expect(outboxDeleteForAccount).toHaveBeenCalledWith(ownerAliasAccountKey);
    expect(bulkUpdate).toHaveBeenCalledWith([
      {
        key: 1,
        changes: {
          remoteCatchId: null,
          remoteOwnerAccountKey: null,
          moderationStatus: null,
          postedAt: null,
          moderationUpdatedAt: null,
          lastModerationCheckAt: null,
          backupDirtyAt: expect.any(String),
        },
      },
      {
        key: 2,
        changes: {
          remoteCatchId: null,
          remoteOwnerAccountKey: null,
          moderationStatus: null,
          postedAt: null,
          moderationUpdatedAt: null,
          lastModerationCheckAt: null,
          backupDirtyAt: expect.any(String),
        },
      },
    ]);
  });

  test("fails closed when a remote-state write targets a deleted palette", async () => {
    const { module, reportAppError, update } = await loadCoreModule({ updateResult: 0 });

    await expect(
      module.updatePaletteRemoteState(17, { remoteCatchId: "remote-after-delete" }),
    ).rejects.toMatchObject({
      name: "PaletteRecordMissingError",
      code: "PALETTE_RECORD_MISSING",
      paletteId: 17,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(reportAppError).not.toHaveBeenCalled();
  });

  test("rejects oversized remote-state batches before opening a transaction", async () => {
    const { bulkUpdate, module, transaction } = await loadCoreModule();
    const updates = Array.from({ length: 2_001 }, (_, index) => ({
      id: index + 1,
      patch: { moderationStatus: "PRIVATE" },
    }));

    await expect(module.bulkUpdatePaletteRemoteStates(updates)).rejects.toBeInstanceOf(RangeError);
    expect(transaction).not.toHaveBeenCalled();
    expect(bulkUpdate).not.toHaveBeenCalled();
  });

  test("preserves a bulk remote-state write failure as the public error cause", async () => {
    const storageError = new DOMException("IndexedDB transaction aborted", "AbortError");
    const { bulkUpdate, module } = await loadCoreModule({ bulkUpdateError: storageError });
    const originalConsoleError = console.error;
    console.error = () => {};

    let caughtError = null;
    try {
      await module.bulkUpdatePaletteRemoteStates([
        { id: 7, patch: { moderationStatus: "PRIVATE" } },
      ]);
    } catch (error) {
      caughtError = error;
    } finally {
      console.error = originalConsoleError;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError.message).toBe("Unable to bulk update palette remote states.");
    expect(caughtError.cause).toBe(storageError);
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
  });

  test("clear includes assets, outbox, metadata, and provisional imports", async () => {
    const {
      assetClear,
      module,
      paletteClear,
      previewClear,
      outboxClear,
      importStagingClear,
      metadataClear,
    } = await loadCoreModule();

    await module.clearSavedPalettes();
    expect(previewClear).toHaveBeenCalledTimes(1);
    expect(outboxClear).toHaveBeenCalledTimes(1);
    expect(importStagingClear).toHaveBeenCalledTimes(1);
    expect(metadataClear).toHaveBeenCalledTimes(1);
    expect(assetClear).toHaveBeenCalledTimes(1);
    expect(paletteClear).toHaveBeenCalledTimes(1);
  });
});
