import { afterEach, describe, expect, test } from "bun:test";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";

function createLocalStorageMock(initialValue = null) {
  const store = new Map();

  if (initialValue !== null) {
    store.set(SETTINGS_STORAGE_KEY, JSON.stringify(initialValue));
  }

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump(key) {
      return store.has(key) ? store.get(key) : null;
    },
  };
}

async function loadAppSettingsModule(initialSettings = null) {
  const localStorageMock = createLocalStorageMock(initialSettings);
  globalThis.localStorage = localStorageMock;
  delete globalThis[GLOBAL_SETTINGS_STORE_KEY];

  const moduleUrl = new URL("./app-settings.js", import.meta.url);
  const module = await import(moduleUrl.href);
  module.resetAppSettingsForTests();
  return { module, localStorageMock };
}

afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis[GLOBAL_SETTINGS_STORE_KEY];
});

describe("app-settings captureMode", () => {
  test("defaults to palette", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().captureMode).toBe("palette");
    expect(module.getAppSettings().captureMode).toBe("palette");
  });

  test("loads a persisted ral setting", async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: "ral",
    });

    expect(module.getAppSettings().captureMode).toBe("ral");
  });

  test("normalizes invalid captureMode to palette", async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: "invalid",
    });

    expect(module.getAppSettings().captureMode).toBe("palette");
  });

  test("notifies listeners when captureMode changes", async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: "ral" });

    expect(updates).toHaveLength(1);
    expect(updates[0].captureMode).toBe("ral");
  });

  test("does not notify when captureMode is unchanged", async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: "palette" });

    expect(updates).toHaveLength(0);
  });

  test("default reset patch restores captureMode to palette", async () => {
    const { module } = await loadAppSettingsModule();

    module.updateAppSettings({ captureMode: "ral" });
    module.updateAppSettings(module.getDefaultAppSettingsResetPatch());

    expect(module.getAppSettings().captureMode).toBe("palette");
  });
});

describe("app-settings collectionViewMode", () => {
  test("defaults to list", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().collectionViewMode).toBe("list");
    expect(module.getAppSettings().collectionViewMode).toBe("list");
  });

  test("loads a persisted grid setting", async () => {
    const { module } = await loadAppSettingsModule({
      collectionViewMode: "grid",
    });

    expect(module.getAppSettings().collectionViewMode).toBe("grid");
  });

  test("normalizes invalid collectionViewMode to list", async () => {
    const { module } = await loadAppSettingsModule({
      collectionViewMode: "invalid",
    });

    expect(module.getAppSettings().collectionViewMode).toBe("list");
  });

  test("persists updates and notifies listeners", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ collectionViewMode: "grid" });

    expect(module.getAppSettings().collectionViewMode).toBe("grid");
    expect(updates).toHaveLength(1);
    expect(updates[0].collectionViewMode).toBe("grid");
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).collectionViewMode).toBe(
      "grid",
    );
  });
});

describe("app-settings performanceHudEnabled", () => {
  test("defaults to false", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().performanceHudEnabled).toBe(false);
    expect(module.getAppSettings().performanceHudEnabled).toBe(false);
  });

  test("loads a persisted enabled state", async () => {
    const { module } = await loadAppSettingsModule({
      performanceHudEnabled: true,
    });

    expect(module.getAppSettings().performanceHudEnabled).toBe(true);
  });

  test("persists updates and resets to false", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      performanceHudEnabled: true,
    });

    expect(module.getAppSettings().performanceHudEnabled).toBe(true);
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).performanceHudEnabled).toBe(
      true,
    );

    module.updateAppSettings({
      performanceHudEnabled: false,
    });

    expect(module.getAppSettings().performanceHudEnabled).toBe(false);
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).performanceHudEnabled).toBe(
      false,
    );
  });
});

describe("app-settings photoExportQuality", () => {
  test("defaults to 0.95", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().photoExportQuality).toBe(0.95);
    expect(module.getAppSettings().photoExportQuality).toBe(0.95);
  });

  test("clamps persisted values into the supported range", async () => {
    const { module } = await loadAppSettingsModule({
      photoExportQuality: 1.5,
    });

    expect(module.getAppSettings().photoExportQuality).toBe(1);
  });

  test("default reset patch restores the photo quality", async () => {
    const { module } = await loadAppSettingsModule();

    module.updateAppSettings({ photoExportQuality: 0.61 });
    module.updateAppSettings(module.getDefaultAppSettingsResetPatch());

    expect(module.getAppSettings().photoExportQuality).toBe(0.95);
  });
});

describe("app-settings polaroidFooterLabel", () => {
  test("defaults to colorcatchers.co", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().polaroidFooterLabel).toBe("colorcatchers.co");
    expect(module.getAppSettings().polaroidFooterLabel).toBe("colorcatchers.co");
  });

  test("loads a persisted custom label", async () => {
    const { module } = await loadAppSettingsModule({
      polaroidFooterLabel: "studio palette",
    });

    expect(module.getAppSettings().polaroidFooterLabel).toBe("studio palette");
  });

  test("normalizes blank values back to the default label", async () => {
    const { module } = await loadAppSettingsModule({
      polaroidFooterLabel: "   ",
    });

    expect(module.getAppSettings().polaroidFooterLabel).toBe("colorcatchers.co");
  });

  test("persists updates and trims whitespace", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      polaroidFooterLabel: "  my label  ",
    });

    expect(module.getAppSettings().polaroidFooterLabel).toBe("my label");
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).polaroidFooterLabel).toBe(
      "my label",
    );
  });
});

describe("app-settings medianCut.colorSpace", () => {
  test("defaults to rgb", async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().medianCut.colorSpace).toBe("rgb");
    expect(module.getAppSettings().medianCut.colorSpace).toBe("rgb");
  });

  test("normalizes a persisted oklch setting back to rgb", async () => {
    const { module } = await loadAppSettingsModule({
      medianCut: { colorSpace: "oklch" },
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe("rgb");
  });

  test("ignores oklch updates and persists rgb", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      medianCut: { colorSpace: "oklch" },
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe("rgb");
    expect(localStorageMock.dump(SETTINGS_STORAGE_KEY)).toBeNull();

    module.updateAppSettings({
      medianCut: module.getDefaultAppSettings().medianCut,
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe("rgb");
    expect(localStorageMock.dump(SETTINGS_STORAGE_KEY)).toBeNull();
  });
});

describe("app-settings paletteScoring", () => {
  test("persists manual scoring updates", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      paletteScoring: { rarityWeight: 18 },
    });

    expect(module.getAppSettings().paletteScoring.rarityWeight).toBe(18);
    expect(
      JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).paletteScoring.rarityWeight,
    ).toBe(18);
  });
});
