import { afterEach, describe, expect, mock, test } from "bun:test";

const serviceModuleUrl = new URL("./backup-service.js", import.meta.url).href;
const apiModuleUrl = new URL("./backup-api.js", import.meta.url).href;
const credentialsModuleUrl = new URL("./backup-credentials.js", import.meta.url).href;
const ledgerModuleUrl = new URL("./palette-storage/backup-ledger.js", import.meta.url).href;
const assetsModuleUrl = new URL("./palette-storage/assets.js", import.meta.url).href;
const lifecycleModuleUrl = new URL("./modules/app-terminal-lifecycle.js", import.meta.url).href;
const clientLogModuleUrl = new URL("./modules/client-log.js", import.meta.url).href;

const CREDENTIALS = { accountId: "0123456789abcdef", secret: "a".repeat(48) };

function createDirtyPalette(id, backupUid) {
  return {
    id,
    backupUid,
    backupDirtyAt: `2026-08-1${id}T10:00:00.000Z`,
    hasPhotoAsset: true,
    timestamp: "2026-08-01T10:00:00.000Z",
    colors: [{ r: 1, g: 2, b: 3 }],
  };
}

async function loadService({
  credentials = CREDENTIALS,
  manifestAssets = [],
  dirtyBatches = [[]],
  tombstones = [],
  photoBlob = new Blob(["photo-bytes"]),
  putPaletteImplementation,
  deleteAccountImplementation,
} = {}) {
  const api = {
    fetchBackupManifest: mock(async () => ({
      palettes: {},
      assets: manifestAssets,
      tombstones: {},
      usageBytes: 0,
    })),
    putBackupPalette: mock(putPaletteImplementation ?? (async () => {})),
    putBackupAsset: mock(async () => {}),
    deleteBackupPalette: mock(async () => {}),
    deleteBackupAccount: mock(deleteAccountImplementation ?? (async () => {})),
  };
  let batchIndex = 0;
  const ledger = {
    listPalettesAwaitingBackup: mock(async () => {
      const batch = dirtyBatches[Math.min(batchIndex, dirtyBatches.length - 1)];
      batchIndex += 1;
      return batch;
    }),
    listPendingBackupTombstones: mock(async () => tombstones),
    markPaletteBackedUp: mock(async () => true),
    resolveBackupTombstones: mock(async () => {}),
    countBackupProgress: mock(async () => ({ total: 2, dirty: 0, backedUp: 2 })),
    resetBackupLedger: mock(async () => {}),
    markAllPalettesForBackup: mock(async () => {}),
  };

  mock.module(apiModuleUrl, () => api);
  mock.module(ledgerModuleUrl, () => ledger);
  const credentialsStore = {
    getBackupCredentials: () => credentials,
    saveBackupCredentials: mock(() => credentials),
    clearBackupCredentials: mock(() => {}),
  };
  mock.module(credentialsModuleUrl, () => credentialsStore);
  mock.module(assetsModuleUrl, () => ({
    readPalettePhotoBlobById: mock(async () => photoBlob),
  }));
  mock.module(lifecycleModuleUrl, () => ({ registerAppTermination: () => {} }));
  mock.module(clientLogModuleUrl, () => ({ clientLog: () => {} }));

  const module = await import(`${serviceModuleUrl}?test=${Math.random()}`);
  return { api, credentialsStore, ledger, module };
}

afterEach(() => {
  mock.restore();
});

describe("backup service flush", () => {
  test("does nothing without credentials", async () => {
    const { api, module } = await loadService({ credentials: null });

    const status = await module.runBackupFlush();

    expect(status.paired).toBe(false);
    expect(api.fetchBackupManifest).not.toHaveBeenCalled();
  });

  test("uploads the photo once, the metadata envelope, and marks the palette clean", async () => {
    const palette = createDirtyPalette(1, "uid-one");
    const { api, ledger, module } = await loadService({
      dirtyBatches: [[palette], []],
    });

    const status = await module.runBackupFlush();

    expect(api.putBackupAsset).toHaveBeenCalledTimes(1);
    expect(api.putBackupPalette).toHaveBeenCalledTimes(1);
    const [, uploadedUid, envelope] = api.putBackupPalette.mock.calls[0];
    expect(uploadedUid).toBe("uid-one");
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.palette.id).toBeUndefined();
    expect(envelope.palette.backupUid).toBe("uid-one");
    expect(envelope.assets).toHaveLength(1);
    expect(ledger.markPaletteBackedUp).toHaveBeenCalledWith(1, {
      dirtyAtSeen: palette.backupDirtyAt,
    });
    expect(status.errorCode).toBeNull();
  });

  test("skips re-uploading an asset the manifest already holds", async () => {
    const photoBlob = new Blob(["photo-bytes"]);
    const digest = await crypto.subtle.digest("SHA-256", await photoBlob.arrayBuffer());
    const hash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const { api, module } = await loadService({
      manifestAssets: [hash],
      dirtyBatches: [[createDirtyPalette(1, "uid-one")], []],
      photoBlob,
    });

    await module.runBackupFlush();

    expect(api.putBackupAsset).not.toHaveBeenCalled();
    expect(api.putBackupPalette).toHaveBeenCalledTimes(1);
  });

  test("propagates tombstones before dirty uploads and resolves them", async () => {
    const { api, ledger, module } = await loadService({
      tombstones: [{ backupUid: "gone-uid", deletedAt: "2026-08-10T00:00:00.000Z" }],
    });

    await module.runBackupFlush();

    expect(api.deleteBackupPalette).toHaveBeenCalledWith(CREDENTIALS, "gone-uid");
    expect(ledger.resolveBackupTombstones).toHaveBeenCalledWith(["gone-uid"]);
  });

  test("keeps the ledger dirty and reports the error code when an upload fails", async () => {
    const { ledger, module } = await loadService({
      dirtyBatches: [[createDirtyPalette(1, "uid-one")]],
      putPaletteImplementation: async () => {
        const error = new Error("server said no");
        error.code = "quota_exceeded";
        throw error;
      },
    });

    const status = await module.runBackupFlush();

    expect(status.errorCode).toBe("quota_exceeded");
    expect(ledger.markPaletteBackedUp).not.toHaveBeenCalled();
  });

  test("concurrent flush calls share one run", async () => {
    const { api, module } = await loadService({ dirtyBatches: [[]] });

    await Promise.all([module.runBackupFlush(), module.runBackupFlush()]);

    expect(api.fetchBackupManifest).toHaveBeenCalledTimes(1);
  });
});

describe("backup account connection", () => {
  test("queues every palette for upload before storing the credentials", async () => {
    const { credentialsStore, ledger, module } = await loadService({ credentials: null });
    const calls = [];
    ledger.markAllPalettesForBackup.mockImplementation(async () => calls.push("mark"));
    credentialsStore.saveBackupCredentials.mockImplementation(() => calls.push("save"));

    await module.connectBackupAccount(CREDENTIALS);

    expect(calls).toEqual(["mark", "save"]);
  });

  test("changes nothing when the server rejects the code", async () => {
    const { api, credentialsStore, ledger, module } = await loadService({ credentials: null });
    api.fetchBackupManifest.mockImplementation(async () => {
      const error = new Error("unauthorized");
      error.code = "unauthorized";
      throw error;
    });

    await expect(module.connectBackupAccount(CREDENTIALS)).rejects.toMatchObject({
      code: "unauthorized",
    });

    expect(ledger.markAllPalettesForBackup).not.toHaveBeenCalled();
    expect(credentialsStore.saveBackupCredentials).not.toHaveBeenCalled();
  });
});

describe("backup account removal", () => {
  test("deletes the server account, then resets the ledger and forgets the credentials", async () => {
    const { api, credentialsStore, ledger, module } = await loadService();

    await module.removeBackupAccount();

    expect(api.deleteBackupAccount).toHaveBeenCalledWith(CREDENTIALS);
    expect(ledger.resetBackupLedger).toHaveBeenCalledTimes(1);
    expect(credentialsStore.clearBackupCredentials).toHaveBeenCalledTimes(1);
    expect(module.getBackupStatusSnapshot()).toMatchObject({ paired: false, errorCode: null });
  });

  test("clears nothing locally when the server call fails", async () => {
    const { credentialsStore, ledger, module } = await loadService({
      deleteAccountImplementation: async () => {
        const error = new Error("offline");
        error.code = "network";
        throw error;
      },
    });

    await expect(module.removeBackupAccount()).rejects.toMatchObject({ code: "network" });

    expect(ledger.resetBackupLedger).not.toHaveBeenCalled();
    expect(credentialsStore.clearBackupCredentials).not.toHaveBeenCalled();
  });
});
