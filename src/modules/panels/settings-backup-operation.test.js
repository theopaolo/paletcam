import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const appSettingsModuleUrl = new URL("../../app-settings.js", import.meta.url).href;
const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const paletteStorageModuleUrl = new URL("../../palette-storage.js", import.meta.url).href;
const localDataResetModuleUrl = new URL("../local-data-reset.js", import.meta.url).href;
const operationalMetricsModuleUrl = new URL("../operational-metrics.js", import.meta.url).href;
const toastUiModuleUrl = new URL("../toast-ui.js", import.meta.url).href;

const exportAllPalettesBlob = mock(() => Promise.resolve(new Blob()));
const flushAllLocalData = mock(() => Promise.resolve());
const importAllPalettes = mock(() => Promise.resolve(0));
const recordOperationalMetric = mock(() => true);
const showToast = mock(() => "toast-id");
let controllerModule;
let coordinatorModule;
let criticalOperationModule;

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  contains(token) {
    return this.tokens.has(token);
  }

  toggle(token, force) {
    if (force === true) this.tokens.add(token);
    else if (force === false) this.tokens.delete(token);
    else if (this.tokens.has(token)) this.tokens.delete(token);
    else this.tokens.add(token);
    return this.tokens.has(token);
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, eventInit = {}) {
    const event = {
      key: "",
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...eventInit,
    };
    return (this.listeners.get(type) ?? []).map((handler) => handler(event));
  }

  dispatchEvent(event) {
    this.dispatch(event.type, event);
    return true;
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((candidate) => candidate !== handler),
    );
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div", id = "") {
    super();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.disabled = false;
    this.files = [];
    this.hidden = false;
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.value = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    for (const child of this.children) {
      if (child.matches(selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createSettingsRoot() {
  const root = new FakeElement("settings-panel");
  const exportButton = new FakeElement("button", "settingsExportButton");
  const exportStatus = new FakeElement("p", "settingsDataStatus");
  const flushDataButton = new FakeElement("button", "settingsFlushDataButton");
  const importInput = new FakeElement("input", "settingsImportInput");
  const importLabel = new FakeElement("label", "settingsImportLabel");
  const importLabelText = new FakeElement("span");
  importLabelText.classList.toggle("panel-form-file-label-text", true);
  importLabel.append(importLabelText);
  root.append(exportButton, exportStatus, flushDataButton, importInput, importLabel);
  return { exportButton, exportStatus, flushDataButton, importInput, root };
}

beforeAll(async () => {
  mock.module(appSettingsModuleUrl, () => ({
    getAppSettings: () => ({ locale: "en", polaroidFooterLabel: "colorcatchers.co" }),
    subscribeAppSettings: () => () => {},
    updateAppSettings: () => {},
  }));
  mock.module(i18nModuleUrl, () => ({ t: (key) => key }));
  mock.module(paletteStorageModuleUrl, () => ({
    exportAllPalettesBlob,
    importAllPalettes,
  }));
  mock.module(localDataResetModuleUrl, () => ({ flushAllLocalData }));
  mock.module(operationalMetricsModuleUrl, () => ({ recordOperationalMetric }));
  mock.module(toastUiModuleUrl, () => ({ showToast }));

  coordinatorModule = await import(`./settings-backup-operation.js?test=${Math.random()}`);
  controllerModule = await import(`./settings-panel-controller.js?test=${Math.random()}`);
  criticalOperationModule = await import("../critical-operation.js");
});

const originalDocument = globalThis.document;
const originalElement = globalThis.Element;

beforeEach(() => {
  const document = new FakeEventTarget();
  document.activeElement = null;
  document.createdAnchors = [];
  document.createElement = () => {
    const anchor = new FakeElement("a");
    anchor.click = mock(() => {});
    document.createdAnchors.push(anchor);
    return anchor;
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
  exportAllPalettesBlob.mockClear();
  flushAllLocalData.mockClear();
  importAllPalettes.mockClear();
  recordOperationalMetric.mockClear();
  showToast.mockClear();
});

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: originalElement });
  criticalOperationModule.resetCriticalOperationsForTests();
});

describe("settings backup operation locale remount", () => {
  test("passes a 400 MiB backup to the streaming importer", async () => {
    importAllPalettes.mockResolvedValueOnce(1);
    const settings = createSettingsRoot();
    const cleanup = controllerModule.mountSettingsPanel({
      root: settings.root,
      toggleButton: null,
    });
    const largeBackup = { name: "large-backup.json", size: 400 * 1024 * 1024 };
    settings.importInput.files = [largeBackup];

    try {
      await Promise.all(settings.importInput.dispatch("change"));

      expect(importAllPalettes).toHaveBeenCalledWith(largeBackup);
      expect(settings.exportStatus.textContent).toBe("settings.toast.imported.one");
      expect(settings.exportStatus.classList.contains("is-error")).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("shows conflict recovery and emits only a categorical failed-import metric", async () => {
    const originalConsoleError = console.error;
    console.error = mock(() => {});
    importAllPalettes.mockRejectedValueOnce(
      Object.assign(new Error("private conflict detail"), { code: "PALETTE_IMPORT_CONFLICT" }),
    );
    const settings = createSettingsRoot();
    const cleanup = controllerModule.mountSettingsPanel({
      root: settings.root,
      toggleButton: null,
    });
    settings.importInput.files = [{ name: "private-backup.json", size: 1 }];

    try {
      await Promise.all(settings.importInput.dispatch("change"));

      expect(settings.exportStatus.textContent).toBe("settings.toast.importConflict");
      expect(showToast).toHaveBeenCalledWith("settings.toast.importConflict", {
        duration: 3500,
      });
      expect(recordOperationalMetric).toHaveBeenCalledWith(
        "backup-transfer",
        expect.objectContaining({
          category: "conflict",
          direction: "import",
          outcome: "failure",
        }),
      );
      expect(JSON.stringify(recordOperationalMetric.mock.calls)).not.toContain("private-backup");
      expect(JSON.stringify(recordOperationalMetric.mock.calls)).not.toContain("private conflict");
    } finally {
      cleanup();
      console.error = originalConsoleError;
    }
  });

  test("distinguishes browser file-handoff failure after export creation", async () => {
    const originalConsoleError = console.error;
    console.error = mock(() => {});
    const backupOperations = coordinatorModule.createSettingsBackupOperationCoordinator({
      objectUrls: { create: () => null, dispose: () => true },
    });
    const settings = createSettingsRoot();
    const cleanup = controllerModule.mountSettingsPanel({
      root: settings.root,
      toggleButton: null,
      backupOperations,
    });

    try {
      await Promise.all(settings.exportButton.dispatch("click"));

      expect(settings.exportStatus.textContent).toBe("settings.data.exportHandoffStatus");
      expect(showToast).toHaveBeenCalledWith("settings.toast.exportHandoff", {
        duration: 3500,
      });
      expect(recordOperationalMetric).toHaveBeenCalledWith(
        "backup-transfer",
        expect.objectContaining({
          category: "file-handoff",
          direction: "export",
          outcome: "failure",
        }),
      );
    } finally {
      cleanup();
      backupOperations.destroy();
      console.error = originalConsoleError;
    }
  });

  test("keeps replacement controls single-flight and ignores detached completion UI", async () => {
    let resolveImport;
    importAllPalettes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );

    const backupOperations = coordinatorModule.createSettingsBackupOperationCoordinator({
      objectUrls: { create: () => "blob:test", dispose: () => true },
    });
    const first = createSettingsRoot();
    const cleanupFirst = controllerModule.mountSettingsPanel({
      root: first.root,
      toggleButton: null,
      backupOperations,
    });

    first.importInput.files = [{ size: 1 }];
    const [firstImport] = first.importInput.dispatch("change");
    expect(importAllPalettes).toHaveBeenCalledTimes(1);
    expect(first.importInput.disabled).toBe(true);
    expect(first.exportButton.disabled).toBe(true);
    expect(first.exportStatus.textContent).toBe("settings.data.importBusy");

    cleanupFirst();
    const detachedStatus = first.exportStatus.textContent;
    const replacement = createSettingsRoot();
    const cleanupReplacement = controllerModule.mountSettingsPanel({
      root: replacement.root,
      toggleButton: null,
      backupOperations,
    });

    expect(replacement.importInput.disabled).toBe(true);
    expect(replacement.exportButton.disabled).toBe(true);
    expect(replacement.exportStatus.textContent).toBe("settings.data.importBusy");

    replacement.importInput.files = [{ size: 1 }];
    await Promise.all(replacement.importInput.dispatch("change"));
    expect(importAllPalettes).toHaveBeenCalledTimes(1);

    resolveImport(2);
    await firstImport;

    expect(replacement.importInput.disabled).toBe(false);
    expect(replacement.exportButton.disabled).toBe(false);
    expect(replacement.exportStatus.hidden).toBe(true);
    expect(first.exportStatus.textContent).toBe(detachedStatus);
    expect(showToast).not.toHaveBeenCalled();

    cleanupReplacement();
    backupOperations.destroy();
  });

  test("retains deferred export ownership and its download URL across remount", async () => {
    let resolveExport;
    exportAllPalettesBlob.mockImplementationOnce(
      ({ onProgress }) =>
        new Promise((resolve) => {
          onProgress({ completed: 1, elapsedMs: 12, phase: "serializing", total: 2 });
          resolveExport = resolve;
        }),
    );
    const createObjectUrl = mock(() => "blob:export");
    const backupOperations = coordinatorModule.createSettingsBackupOperationCoordinator({
      objectUrls: { create: createObjectUrl, dispose: () => true },
    });
    const first = createSettingsRoot();
    const cleanupFirst = controllerModule.mountSettingsPanel({
      root: first.root,
      toggleButton: null,
      backupOperations,
    });

    const [firstExport] = first.exportButton.dispatch("click");
    expect(exportAllPalettesBlob).toHaveBeenCalledTimes(1);
    expect(first.exportButton.disabled).toBe(true);

    cleanupFirst();
    const detachedStatus = first.exportStatus.textContent;
    const replacement = createSettingsRoot();
    const cleanupReplacement = controllerModule.mountSettingsPanel({
      root: replacement.root,
      toggleButton: null,
      backupOperations,
    });
    expect(replacement.exportButton.disabled).toBe(true);
    expect(replacement.importInput.disabled).toBe(true);

    await Promise.all(replacement.exportButton.dispatch("click"));
    expect(exportAllPalettesBlob).toHaveBeenCalledTimes(1);

    resolveExport(new Blob(["backup"], { type: "application/json" }));
    await firstExport;

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(globalThis.document.createdAnchors).toHaveLength(1);
    expect(globalThis.document.createdAnchors[0].click).toHaveBeenCalledTimes(1);
    expect(replacement.exportButton.disabled).toBe(false);
    expect(replacement.importInput.disabled).toBe(false);
    expect(replacement.exportStatus.hidden).toBe(true);
    expect(first.exportStatus.textContent).toBe(detachedStatus);
    expect(showToast).not.toHaveBeenCalled();

    cleanupReplacement();
    backupOperations.destroy();
  });

  test("refuses destructive reset while capture persistence is active", async () => {
    const originalConfirm = globalThis.confirm;
    Object.defineProperty(globalThis, "confirm", {
      configurable: true,
      value: () => true,
    });
    const releaseCapture = criticalOperationModule.beginCriticalOperation("camera-capture");
    const settings = createSettingsRoot();
    const cleanup = controllerModule.mountSettingsPanel({
      root: settings.root,
      toggleButton: null,
    });

    await Promise.all(settings.flushDataButton.dispatch("click"));

    expect(flushAllLocalData).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("settings.toast.flushBusy", {
      variant: "error",
      duration: 2500,
    });

    cleanup();
    releaseCapture();
    Object.defineProperty(globalThis, "confirm", {
      configurable: true,
      value: originalConfirm,
    });
  });
});
