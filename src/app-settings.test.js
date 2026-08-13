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

// captureMode carries the representative coverage for the generic store machinery
// (valid load round-trip, change notifications, reset patch). Other fields below
// only assert their own distinct validation rules.
describe("app-settings captureMode", () => {
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
  test("normalizes invalid collectionViewMode to list", async () => {
    const { module } = await loadAppSettingsModule({
      collectionViewMode: "invalid",
    });

    expect(module.getAppSettings().collectionViewMode).toBe("list");
  });

  // Representative persist-to-localStorage assertion for the whole settings store.
  test("persists updates and notifies listeners", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ collectionViewMode: "grid" });

    expect(module.getAppSettings().collectionViewMode).toBe("grid");
    expect(updates).toHaveLength(1);
    expect(updates[0].collectionViewMode).toBe("grid");
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).collectionViewMode).toBe("grid");
  });
});

describe("app-settings locale", () => {
  test("normalizes invalid locales to fr", async () => {
    const { module } = await loadAppSettingsModule({
      locale: "de",
    });

    expect(module.getAppSettings().locale).toBe("fr");
  });
});

describe("app-settings performanceHudEnabled", () => {
  // Guards falsy (false) boolean persistence, which enum fields above do not cover.
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

describe("app-settings polaroidFooterLabel", () => {
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

describe("app-settings hybrid", () => {
  test("persists manual hybrid updates", async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      hybrid: { rarityStrength: 0.4 },
    });

    expect(module.getAppSettings().hybrid.rarityStrength).toBe(0.4);
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).hybrid.rarityStrength).toBe(0.4);
  });
});

describe("app-settings legacy overrides", () => {
  test("ignores stored oneMoreColor and medianCut overrides from older builds", async () => {
    const { module } = await loadAppSettingsModule({
      oneMoreColor: false,
      medianCut: { quantizedPoolSize: 24, maxQuantizerPixels: 40000 },
    });

    const settings = module.getAppSettings();
    const defaults = module.getDefaultAppSettings();

    expect(settings.oneMoreColor).toBe(defaults.oneMoreColor);
    expect(settings.medianCut).toEqual(defaults.medianCut);
  });

  test("drops removed paletteSelector and paletteScoring fields", async () => {
    const { module } = await loadAppSettingsModule({
      paletteSelector: "current",
      paletteScoring: { rarityWeight: 18 },
    });

    const settings = module.getAppSettings();

    expect(settings.paletteSelector).toBeUndefined();
    expect(settings.paletteScoring).toBeUndefined();
  });
});
