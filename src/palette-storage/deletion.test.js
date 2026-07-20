import { afterEach, describe, expect, mock, test } from "bun:test";

const deletionModuleUrl = new URL("./deletion.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../modules/error-reporting.js", import.meta.url).href;

function replaceMap(target, snapshot) {
  target.clear();
  for (const [key, value] of snapshot) target.set(key, structuredClone(value));
}

function createTransactionalDeletionDb(palette) {
  const state = {
    assets: new Map([[palette.id, { paletteId: palette.id, photoBlob: new Blob(["photo"]) }]]),
    outbox: new Map(),
    palettes: new Map([[palette.id, structuredClone(palette)]]),
    previews: new Map([
      [`${palette.id}:gallery`, { paletteId: palette.id, variant: "gallery" }],
      [`${palette.id}:viewer`, { paletteId: palette.id, variant: "viewer" }],
    ]),
  };
  let assetDeleteError = null;

  const db = {
    communityDeleteOutbox: {},
    paletteAssets: {
      async delete(id) {
        if (assetDeleteError) throw assetDeleteError;
        state.assets.delete(id);
      },
    },
    palettePreviews: {
      async bulkDelete(keys) {
        for (const [id, variant] of keys) state.previews.delete(`${id}:${variant}`);
      },
    },
    palettes: {
      async delete(id) {
        state.palettes.delete(id);
      },
      async get(id) {
        const record = state.palettes.get(id);
        return record ? structuredClone(record) : undefined;
      },
    },
    async transaction(_mode, ...args) {
      const callback = args.at(-1);
      const snapshot = {
        assets: structuredClone(state.assets),
        outbox: structuredClone(state.outbox),
        palettes: structuredClone(state.palettes),
        previews: structuredClone(state.previews),
      };
      try {
        return await callback();
      } catch (error) {
        replaceMap(state.assets, snapshot.assets);
        replaceMap(state.outbox, snapshot.outbox);
        replaceMap(state.palettes, snapshot.palettes);
        replaceMap(state.previews, snapshot.previews);
        throw error;
      }
    },
  };

  return {
    db,
    setAssetDeleteError(error) {
      assetDeleteError = error;
    },
    state,
  };
}

async function loadDeletionModule({
  accountKey = "account:0123456789abcdef",
  palette = { id: 7, remoteCatchId: null },
  prepareImplementation = async () => {},
  reserveImplementation = null,
} = {}) {
  const database = createTransactionalDeletionDb(palette);
  const prepareDeleteOutbox = mock(prepareImplementation);
  const reserveDeleteRetryInCurrentTransaction = mock(
    reserveImplementation ??
      (async ({ accountKey: reservedAccountKey, remoteCatchId }) => {
        const key = `${reservedAccountKey}\u0000${remoteCatchId}`;
        const enqueued = !database.state.outbox.has(key);
        database.state.outbox.set(key, { key, accountKey: reservedAccountKey, remoteCatchId });
        return { discardedCount: 0, enqueued, reserved: true };
      }),
  );
  const reportAppError = mock(() => ({}));

  mock.module(dbModuleUrl, () => ({ db: database.db }));
  mock.module(errorReportingModuleUrl, () => ({ reportAppError }));

  const module = await import(`${deletionModuleUrl}?test=${Math.random()}`);
  return {
    ...database,
    deletionOptions: {
      accountKey,
      prepareRemoteCleanup: prepareDeleteOutbox,
      reserveRemoteCleanup: reserveDeleteRetryInCurrentTransaction,
    },
    module,
    prepareDeleteOutbox,
    reportAppError,
    reserveDeleteRetryInCurrentTransaction,
  };
}

afterEach(() => {
  mock.restore();
});

describe("transactional palette deletion", () => {
  test("deletes local-only records without requiring an account or reserving cleanup", async () => {
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction, state } =
      await loadDeletionModule({ accountKey: "" });

    await expect(module.deletePalette(7, deletionOptions)).resolves.toEqual({
      remoteCatchId: "",
      remoteCleanupQueued: false,
    });
    expect(state.palettes.size).toBe(0);
    expect(state.assets.size).toBe(0);
    expect(state.previews.size).toBe(0);
    expect(state.outbox.size).toBe(0);
    expect(reserveDeleteRetryInCurrentTransaction).not.toHaveBeenCalled();
  });

  test("reserves the stored remote id before deleting all local records", async () => {
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction, state } =
      await loadDeletionModule({
        palette: {
          id: 7,
          remoteCatchId: " stored-remote ",
          remoteOwnerAccountKey: "account:0123456789abcdef",
        },
      });

    await expect(module.deletePalette(7, deletionOptions)).resolves.toEqual({
      remoteCatchId: "stored-remote",
      remoteCleanupQueued: true,
    });
    expect(reserveDeleteRetryInCurrentTransaction).toHaveBeenCalledWith({
      accountKey: "account:0123456789abcdef",
      remoteCatchId: "stored-remote",
    });
    expect(state.outbox.size).toBe(1);
    expect(state.palettes.size).toBe(0);
    expect(state.assets.size).toBe(0);
    expect(state.previews.size).toBe(0);
  });

  test("refuses a remote-linked deletion without an authenticated account binding", async () => {
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction, state } =
      await loadDeletionModule({
        accountKey: "",
        palette: { id: 7, remoteCatchId: "remote-7" },
      });

    await expect(module.deletePalette(7, deletionOptions)).rejects.toMatchObject({
      code: "REMOTE_CLEANUP_AUTH_REQUIRED",
    });
    expect(reserveDeleteRetryInCurrentTransaction).not.toHaveBeenCalled();
    expect(state.palettes.has(7)).toBe(true);
    expect(state.assets.has(7)).toBe(true);
    expect(state.previews.size).toBe(2);
  });

  test("refuses deletion when the outbox cannot reserve capacity", async () => {
    const { deletionOptions, module, state } = await loadDeletionModule({
      palette: {
        id: 7,
        remoteCatchId: "remote-7",
        remoteOwnerAccountKey: "account:0123456789abcdef",
      },
      reserveImplementation: async () => ({
        discardedCount: 0,
        enqueued: false,
        reserved: false,
      }),
    });

    await expect(module.deletePalette(7, deletionOptions)).rejects.toMatchObject({
      code: "REMOTE_CLEANUP_QUEUE_UNAVAILABLE",
    });
    expect(state.palettes.has(7)).toBe(true);
    expect(state.assets.has(7)).toBe(true);
    expect(state.previews.size).toBe(2);
  });

  test("lets the deleting account claim cleanup for a legacy remote link with no stored owner", async () => {
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction, state } =
      await loadDeletionModule({
        palette: { id: 7, remoteCatchId: "legacy-remote" },
      });

    await expect(module.deletePalette(7, deletionOptions)).resolves.toEqual({
      remoteCatchId: "legacy-remote",
      remoteCleanupQueued: true,
    });
    expect(reserveDeleteRetryInCurrentTransaction).toHaveBeenCalledWith({
      accountKey: "account:0123456789abcdef",
      remoteCatchId: "legacy-remote",
    });
    expect(state.outbox.size).toBe(1);
    expect(state.palettes.size).toBe(0);
    expect(state.assets.size).toBe(0);
    expect(state.previews.size).toBe(0);
  });

  test("refuses deletion when the stored remote owner differs from the active account", async () => {
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction, state } =
      await loadDeletionModule({
        accountKey: "account:0123456789abcdef",
        palette: {
          id: 7,
          remoteCatchId: "remote-7",
          remoteOwnerAccountKey: "account:fedcba9876543210",
        },
      });

    await expect(module.deletePalette(7, deletionOptions)).rejects.toMatchObject({
      code: "REMOTE_CLEANUP_ACCOUNT_MISMATCH",
    });
    expect(reserveDeleteRetryInCurrentTransaction).not.toHaveBeenCalled();
    expect(state.palettes.has(7)).toBe(true);
    expect(state.assets.has(7)).toBe(true);
    expect(state.previews.size).toBe(2);
  });

  test("rolls the reserved intent and earlier deletes back if a later local delete fails", async () => {
    const { deletionOptions, module, setAssetDeleteError, state } = await loadDeletionModule({
      palette: {
        id: 7,
        remoteCatchId: "remote-7",
        remoteOwnerAccountKey: "account:0123456789abcdef",
      },
    });
    setAssetDeleteError(new DOMException("quota", "QuotaExceededError"));

    await expect(module.deletePalette(7, deletionOptions)).rejects.toMatchObject({
      code: "PALETTE_DELETE_FAILED",
    });
    expect(state.outbox.size).toBe(0);
    expect(state.palettes.has(7)).toBe(true);
    expect(state.assets.has(7)).toBe(true);
    expect(state.previews.size).toBe(2);
  });

  test("captures the account binding before awaiting outbox preparation", async () => {
    let liveAccountKey = "account:0123456789abcdef";
    const { deletionOptions, module, reserveDeleteRetryInCurrentTransaction } =
      await loadDeletionModule({
        accountKey: liveAccountKey,
        palette: {
          id: 7,
          remoteCatchId: "remote-7",
          remoteOwnerAccountKey: "account:0123456789abcdef",
        },
        prepareImplementation: async () => {
          liveAccountKey = "";
        },
      });

    await module.deletePalette(7, deletionOptions);
    expect(liveAccountKey).toBe("");
    expect(reserveDeleteRetryInCurrentTransaction).toHaveBeenCalledWith({
      accountKey: "account:0123456789abcdef",
      remoteCatchId: "remote-7",
    });
  });
});
