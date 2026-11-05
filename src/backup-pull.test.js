import { afterEach, describe, expect, mock, test } from "bun:test";

const pullModuleUrl = new URL("./backup-pull.js", import.meta.url).href;
const apiModuleUrl = new URL("./backup-api.js", import.meta.url).href;
const ledgerModuleUrl = new URL("./palette-storage/backup-ledger.js", import.meta.url).href;
const stagingModuleUrl = new URL("./palette-storage/import-staging.js", import.meta.url).href;
const appSettingsModuleUrl = new URL("./app-settings.js", import.meta.url).href;
const criticalOperationModuleUrl = new URL("./modules/critical-operation.js", import.meta.url).href;
const clientLogModuleUrl = new URL("./modules/client-log.js", import.meta.url).href;

const CREDENTIALS = { accountId: "0123456789abcdef", secret: "a".repeat(48) };
const hashOf = (letter) => letter.repeat(64);

function createRemotePalette(timestamp, overrides = {}) {
  return { timestamp, colors: [{ r: 1, g: 2, b: 3 }], hasPhotoAsset: true, ...overrides };
}

function createLocalPalette(id, backupUid, overrides = {}) {
  return {
    id,
    backupUid,
    timestamp: `2026-08-0${id}T10:00:00.000Z`,
    colors: [{ r: id, g: 0, b: 0 }],
    backupDirtyAt: null,
    backupRemoteHash: hashOf("a"),
    favoritedAt: null,
    ...overrides,
  };
}

async function loadPull({
  manifest = { palettes: {}, tombstones: {} },
  remoteByUid = {},
  localPalettes = [],
  afterPalettes,
  pendingTombstoneUids = [],
} = {}) {
  const staged = [];
  const staging = {
    PALETTE_IMPORT_STAGING_BATCH_SIZE: 2,
    PaletteImportConflictError: class PaletteImportConflictError extends Error {},
    beginImportSession: mock(async () => "session-1"),
    stageImportBatch: mock(async (_sessionId, palettes) => {
      staged.push(...palettes);
    }),
    commitImportSession: mock(async (_sessionId) => staged.length),
    abortImportSession: mock(async () => true),
  };
  let indexCalls = 0;
  const ledger = {
    listBackupSyncIndex: mock(async () => {
      indexCalls += 1;
      return indexCalls === 1 ? localPalettes : (afterPalettes ?? localPalettes);
    }),
    listAllPendingBackupTombstoneUids: mock(async () => pendingTombstoneUids),
    applyRemotePaletteState: mock(async () => true),
    rekeyPaletteBackupUid: mock(async () => true),
    markPalettesPulled: mock(async () => {}),
    deletePalettesForRemoteTombstones: mock(async (entries) => entries.length),
    markPalettesForBackup: mock(async () => 0),
  };
  const api = {
    fetchBackupPalette: mock(async (_credentials, uid) => remoteByUid[uid]),
    fetchBackupAsset: mock(async () => new Blob(["photo"])),
    deleteBackupPalette: mock(async () => {}),
  };
  const clientLog = mock(() => {});

  mock.module(apiModuleUrl, () => api);
  mock.module(ledgerModuleUrl, () => ledger);
  mock.module(stagingModuleUrl, () => staging);
  mock.module(appSettingsModuleUrl, () => ({
    getAppSettings: () => ({ polaroidFooterLabel: "colorcatchers.co" }),
  }));
  mock.module(criticalOperationModuleUrl, () => ({ beginCriticalOperation: () => () => {} }));
  mock.module(clientLogModuleUrl, () => ({ clientLog }));

  const module = await import(`${pullModuleUrl}?test=${Math.random()}`);
  const pull = () => module.pullBackupChanges(CREDENTIALS, manifest);
  return { api, clientLog, ledger, module, pull, staged, staging };
}

afterEach(() => {
  mock.restore();
});

describe("duplicate winner", () => {
  test("the lowest uid wins and the state comes from the most complete copy", async () => {
    const { module } = await loadPull();
    const { winner, losers, fields } = module.chooseDuplicateWinner([
      { uid: "uid-b", palette: { favoritedAt: "2026-08-02T00:00:00.000Z" } },
      { uid: "uid-a", palette: { favoritedAt: null } },
    ]);

    expect(winner.uid).toBe("uid-a");
    expect(losers.map((member) => member.uid)).toEqual(["uid-b"]);
    expect(fields.favoritedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("backup pull", () => {
  test("imports new palettes in capture order and records the downloaded version", async () => {
    const { ledger, pull, staged } = await loadPull({
      manifest: {
        palettes: { "uid-late": { hash: hashOf("2") }, "uid-early": { hash: hashOf("1") } },
        tombstones: {},
      },
      remoteByUid: {
        "uid-late": {
          envelope: {
            palette: createRemotePalette("2026-08-02T00:00:00.000Z"),
            assets: [hashOf("p")],
          },
          hash: hashOf("2"),
        },
        "uid-early": {
          envelope: {
            palette: createRemotePalette("2026-08-01T00:00:00.000Z"),
            assets: [hashOf("q")],
          },
          hash: hashOf("1"),
        },
      },
    });

    const result = await pull();

    expect(result.imported).toBe(2);
    expect(staged.map((palette) => palette.backupUid)).toEqual(["uid-early", "uid-late"]);
    expect(ledger.markPalettesPulled).toHaveBeenCalledWith([
      { backupUid: "uid-early", remoteHash: hashOf("1"), clean: true },
      { backupUid: "uid-late", remoteHash: hashOf("2"), clean: true },
    ]);
  });

  test("applies a changed server version only to clean palettes", async () => {
    const changed = createLocalPalette(1, "uid-changed");
    const dirty = createLocalPalette(2, "uid-dirty", { backupDirtyAt: "2026-08-10T00:00:00.000Z" });
    const unchanged = createLocalPalette(3, "uid-same");
    const remotePalette = createRemotePalette(changed.timestamp, {
      favoritedAt: "2026-08-11T00:00:00.000Z",
    });
    const { api, ledger, pull } = await loadPull({
      manifest: {
        palettes: {
          "uid-changed": { hash: hashOf("c") },
          "uid-dirty": { hash: hashOf("d") },
          "uid-same": { hash: hashOf("a") },
        },
        tombstones: {},
      },
      remoteByUid: { "uid-changed": { envelope: { palette: remotePalette }, hash: hashOf("c") } },
      localPalettes: [changed, dirty, unchanged],
    });

    const result = await pull();

    expect(api.fetchBackupPalette).toHaveBeenCalledTimes(1);
    expect(ledger.applyRemotePaletteState).toHaveBeenCalledWith(1, {
      expectedDirtyAt: null,
      remotePalette,
      remoteHash: hashOf("c"),
    });
    expect(result.updated).toBe(1);
  });

  test("does not download a palette this device deleted and has not sent yet", async () => {
    const { api, pull } = await loadPull({
      manifest: { palettes: { "uid-gone": { hash: hashOf("g") } }, tombstones: {} },
      pendingTombstoneUids: ["uid-gone"],
    });

    await pull();

    expect(api.fetchBackupPalette).not.toHaveBeenCalled();
  });

  test("two remote copies of one capture land once, with the star, and the loser is deleted after", async () => {
    const timestamp = "2026-08-03T00:00:00.000Z";
    const calls = [];
    const { api, ledger, pull, staged } = await loadPull({
      manifest: {
        palettes: { "uid-a": { hash: hashOf("a") }, "uid-b": { hash: hashOf("b") } },
        tombstones: {},
      },
      remoteByUid: {
        "uid-a": {
          envelope: { palette: createRemotePalette(timestamp), assets: [hashOf("p")] },
          hash: hashOf("a"),
        },
        "uid-b": {
          envelope: {
            palette: createRemotePalette(timestamp, { favoritedAt: "2026-08-04T00:00:00.000Z" }),
            assets: [hashOf("p")],
          },
          hash: hashOf("b"),
        },
      },
    });
    ledger.markPalettesPulled.mockImplementation(async () => calls.push("pulled"));
    api.deleteBackupPalette.mockImplementation(async (_credentials, uid) =>
      calls.push(`delete:${uid}`),
    );

    const result = await pull();

    expect(staged).toHaveLength(1);
    expect(staged[0].backupUid).toBe("uid-a");
    expect(staged[0].favoritedAt).toBe("2026-08-04T00:00:00.000Z");
    // The merged star differs from uid-a's server copy, so it uploads.
    expect(ledger.markPalettesPulled).toHaveBeenCalledWith([
      { backupUid: "uid-a", remoteHash: hashOf("a"), clean: false },
    ]);
    expect(calls).toEqual(["pulled", "delete:uid-b"]);
    expect(result.deduplicated).toBe(1);
  });

  test("a local copy with a higher uid takes the remote uid instead of a second download", async () => {
    const local = createLocalPalette(1, "uid-z", { backupRemoteHash: hashOf("z") });
    const { ledger, pull, staged } = await loadPull({
      manifest: {
        palettes: { "uid-a": { hash: hashOf("a") }, "uid-z": { hash: hashOf("z") } },
        tombstones: {},
      },
      remoteByUid: {
        "uid-a": {
          envelope: { palette: createRemotePalette(local.timestamp, { colors: local.colors }) },
          hash: hashOf("a"),
        },
      },
      localPalettes: [local],
    });

    const result = await pull();

    expect(staged).toHaveLength(0);
    expect(ledger.rekeyPaletteBackupUid).toHaveBeenCalledWith(1, {
      fromUid: "uid-z",
      toUid: "uid-a",
      fields: expect.objectContaining({ favoritedAt: null }),
      remoteHash: hashOf("a"),
      dirty: false,
    });
    expect(result.rekeyed).toBe(1);
  });

  test("a local copy with the lowest uid stays, and the remote copy is deleted", async () => {
    const local = createLocalPalette(1, "uid-a");
    const { api, pull, staged } = await loadPull({
      manifest: {
        palettes: { "uid-a": { hash: hashOf("a") }, "uid-z": { hash: hashOf("z") } },
        tombstones: {},
      },
      remoteByUid: {
        "uid-z": {
          envelope: { palette: createRemotePalette(local.timestamp, { colors: local.colors }) },
          hash: hashOf("z"),
        },
      },
      localPalettes: [local],
    });

    await pull();

    expect(staged).toHaveLength(0);
    expect(api.deleteBackupPalette).toHaveBeenCalledWith(CREDENTIALS, "uid-z");
  });

  test("a remote delete removes only clean palettes this device saw on the server", async () => {
    const seen = createLocalPalette(1, "uid-seen");
    const edited = createLocalPalette(2, "uid-edited", {
      backupDirtyAt: "2026-08-12T00:00:00.000Z",
    });
    const unknown = createLocalPalette(3, "uid-unknown", { backupRemoteHash: null });
    const absent = createLocalPalette(4, "uid-absent");
    const { ledger, pull } = await loadPull({
      manifest: {
        palettes: {},
        tombstones: {
          "uid-seen": { deletedAt: "2026-08-12T00:00:00.000Z" },
          "uid-edited": { deletedAt: "2026-08-12T00:00:00.000Z" },
          "uid-unknown": { deletedAt: "2026-08-12T00:00:00.000Z" },
        },
      },
      localPalettes: [seen, edited, unknown, absent],
    });

    const result = await pull();

    expect(ledger.deletePalettesForRemoteTombstones).toHaveBeenCalledWith([
      { id: 1, backupUid: "uid-seen", remoteHash: hashOf("a") },
    ]);
    expect(result.deleted).toBe(1);
    // Unknown to this device's sync history, or unknown to the server: re-upload.
    expect(ledger.markPalettesForBackup).toHaveBeenCalledWith([3, 4]);
  });

  test("refuses to delete more than half the collection in one pass", async () => {
    const localPalettes = Array.from({ length: 12 }, (_value, index) =>
      createLocalPalette(index + 1, `uid-${String(index + 1).padStart(2, "0")}`),
    );
    const tombstones = Object.fromEntries(
      localPalettes.slice(0, 11).map((palette) => [palette.backupUid, { deletedAt: "x" }]),
    );
    const { clientLog, ledger, pull } = await loadPull({
      manifest: { palettes: { "uid-12": { hash: hashOf("a") } }, tombstones },
      localPalettes,
    });

    const result = await pull();

    expect(ledger.deletePalettesForRemoteTombstones).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(clientLog).toHaveBeenCalledWith("backup:pull-delete-guard", {
      blockedCount: 11,
      localCount: 12,
    });
  });
});
