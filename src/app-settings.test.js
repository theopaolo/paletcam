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

describe("app-settings photoQualityMode", () => {
  test("falls back to hd for invalid persisted values", async () => {
    const { module } = await loadAppSettingsModule({ photoQualityMode: "4k" });

    expect(module.getAppSettings().photoQualityMode).toBe("hd");
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

describe("app-settings medianCut.colorSpace", () => {
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
