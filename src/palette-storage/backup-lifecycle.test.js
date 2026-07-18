import { expect, mock, test } from "bun:test";

const appTerminalLifecycleModuleUrl = new URL(
  "../modules/app-terminal-lifecycle.js",
  import.meta.url,
).href;
const backupModuleUrl = new URL("./backup.js", import.meta.url).href;
const dbModuleUrl = new URL("./db.js", import.meta.url).href;
const importStagingModuleUrl = new URL("./import-staging.js", import.meta.url).href;
const paletteJsonWorkerModuleUrl = new URL("../modules/palette-json-worker.js", import.meta.url)
  .href;
const recordsModuleUrl = new URL("./records.js", import.meta.url).href;

test("backup ownership ends with the singleton app lifetime", async () => {
  const destroyWorker = mock(() => {});
  const registerAppTermination = mock(() => () => true);
  const beginImportSession = mock(async () => "unused-session");

  mock.module(appTerminalLifecycleModuleUrl, () => ({ registerAppTermination }));
  mock.module(paletteJsonWorkerModuleUrl, () => ({
    createPaletteJsonWorkerController: () => ({
      destroy: destroyWorker,
      exportPalettes: () => null,
      exportPalettesBlob: () => null,
      importPalettes: () => null,
      isEnabled: () => false,
    }),
  }));
  mock.module(dbModuleUrl, () => ({ db: {} }));
  mock.module(importStagingModuleUrl, () => ({
    abortImportSession: async () => true,
    beginImportSession,
    commitImportSession: async () => 0,
    PALETTE_IMPORT_STAGING_BATCH_SIZE: 25,
    stageImportBatch: async () => 0,
  }));
  mock.module(recordsModuleUrl, () => ({
    normalizeStoredPaletteRecord: (record) => record,
  }));

  const backupModule = await import(`${backupModuleUrl}?lifecycle=${Math.random()}`);

  expect(registerAppTermination).toHaveBeenCalledTimes(1);
  expect(registerAppTermination).toHaveBeenCalledWith(backupModule.destroyPaletteBackupOperations);
  expect(backupModule.destroyPaletteBackupOperations()).toBe(true);
  expect(backupModule.destroyPaletteBackupOperations()).toBe(false);

  await expect(backupModule.exportAllPalettesBlob()).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    backupModule.importAllPalettes(JSON.stringify({ version: 2, palettes: [] })),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(beginImportSession).not.toHaveBeenCalled();
  expect(destroyWorker).toHaveBeenCalledTimes(1);
  expect(destroyWorker.mock.calls[0][0]).toMatchObject({ name: "AbortError" });
});
