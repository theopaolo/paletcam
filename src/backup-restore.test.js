import { afterEach, describe, expect, mock, test } from "bun:test";

const restoreModuleUrl = new URL("./backup-restore.js", import.meta.url).href;
const apiModuleUrl = new URL("./backup-api.js", import.meta.url).href;
const credentialsModuleUrl = new URL("./backup-credentials.js", import.meta.url).href;
const ledgerModuleUrl = new URL("./palette-storage/backup-ledger.js", import.meta.url).href;
const stagingModuleUrl = new URL("./palette-storage/import-staging.js", import.meta.url).href;
const appSettingsModuleUrl = new URL("./app-settings.js", import.meta.url).href;
const criticalOperationModuleUrl = new URL("./modules/critical-operation.js", import.meta.url).href;

const CREDENTIALS = { accountId: "0123456789abcdef", secret: "a".repeat(48) };

function createEnvelope(timestamp, assetHash) {
  return {
    schemaVersion: 1,
    palette: { timestamp, colors: [{ r: 1, g: 2, b: 3 }], hasPhotoAsset: Boolean(assetHash) },
    assets: assetHash ? [assetHash] : [],
  };
}

async function loadRestore({
  credentials = CREDENTIALS,
  manifestPalettes = {},
  envelopesByUid = {},
  existingUids = new Set(),
  commitImplementation,
} = {}) {
  const staged = [];
  const staging = {
    PALETTE_IMPORT_STAGING_BATCH_SIZE: 2,
    beginImportSession: mock(async () => "session-1"),
    stageImportBatch: mock(async (_sessionId, palettes) => {
      staged.push(...palettes);
      return staged.length;
    }),
    commitImportSession: mock(commitImplementation ?? (async () => staged.length)),
    abortImportSession: mock(async () => true),
  };
  const ledger = {
    listExistingBackupUids: mock(async () => existingUids),
    markPalettesRestoredClean: mock(async () => 0),
  };
  const api = {
    fetchBackupManifest: mock(async () => ({
      palettes: manifestPalettes,
      assets: [],
      tombstones: {},
    })),
    fetchBackupPalette: mock(async (_credentials, uid) => envelopesByUid[uid]),
    fetchBackupAsset: mock(async () => new Blob(["photo"])),
  };

  mock.module(apiModuleUrl, () => api);
  mock.module(ledgerModuleUrl, () => ledger);
  mock.module(stagingModuleUrl, () => staging);
  mock.module(credentialsModuleUrl, () => ({ getBackupCredentials: () => credentials }));
  mock.module(appSettingsModuleUrl, () => ({
    getAppSettings: () => ({ polaroidFooterLabel: "colorcatchers.co" }),
  }));
  mock.module(criticalOperationModuleUrl, () => ({ beginCriticalOperation: () => () => {} }));

  const module = await import(`${restoreModuleUrl}?test=${Math.random()}`);
  return { api, ledger, module, staged, staging };
}

afterEach(() => {
  mock.restore();
});

describe("backup restore", () => {
  test("throws unpaired without credentials", async () => {
    const { module } = await loadRestore({ credentials: null });

    await expect(module.runBackupRestore()).rejects.toMatchObject({ code: "unpaired" });
  });

  test("restores in capture order, preserves server identity, and marks records clean", async () => {
    const { ledger, module, staged, staging } = await loadRestore({
      manifestPalettes: { "uid-new": {}, "uid-old": {} },
      envelopesByUid: {
        "uid-new": createEnvelope("2026-08-10T10:00:00.000Z", "b".repeat(64)),
        "uid-old": createEnvelope("2026-07-01T10:00:00.000Z", "c".repeat(64)),
      },
    });

    const result = await module.runBackupRestore();

    expect(result.restored).toBe(2);
    expect(staged.map((palette) => palette.backupUid)).toEqual(["uid-old", "uid-new"]);
    expect(staged.every((palette) => palette.photoBlob instanceof Blob)).toBe(true);
    expect(staging.commitImportSession).toHaveBeenCalledTimes(1);
    expect(ledger.markPalettesRestoredClean).toHaveBeenCalledWith(["uid-old", "uid-new"]);
  });

  test("skips palettes already present locally and photo-less documents", async () => {
    const { api, module } = await loadRestore({
      manifestPalettes: { "uid-existing": {}, "uid-bare": {} },
      existingUids: new Set(["uid-existing"]),
      envelopesByUid: { "uid-bare": createEnvelope("2026-08-01T10:00:00.000Z", null) },
    });

    const result = await module.runBackupRestore();

    expect(result).toEqual({ restored: 0, skipped: 1, missingPhoto: 1 });
    expect(api.fetchBackupPalette).toHaveBeenCalledTimes(1);
    expect(api.fetchBackupAsset).not.toHaveBeenCalled();
  });

  test("aborts the staging session when the commit fails", async () => {
    const { module, staging } = await loadRestore({
      manifestPalettes: { "uid-new": {} },
      envelopesByUid: { "uid-new": createEnvelope("2026-08-10T10:00:00.000Z", "b".repeat(64)) },
      commitImplementation: async () => {
        throw new Error("commit exploded");
      },
    });

    await expect(module.runBackupRestore()).rejects.toMatchObject({
      name: "BackupRestoreError",
    });
    expect(staging.abortImportSession).toHaveBeenCalledWith("session-1");
  });
});
