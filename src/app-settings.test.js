import { afterEach, describe, expect, test } from 'bun:test';

const SETTINGS_STORAGE_KEY = 'paletcam:settings:v1';
const GLOBAL_SETTINGS_STORE_KEY = '__paletcamAppSettingsStore__';

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

  const moduleUrl = new URL('./app-settings.js', import.meta.url);
  const module = await import(moduleUrl.href);
  module.resetAppSettingsForTests();
  return { module, localStorageMock };
}

afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis[GLOBAL_SETTINGS_STORE_KEY];
});

describe('app-settings captureMode', () => {
  test('defaults to palette', async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().captureMode).toBe('palette');
    expect(module.getAppSettings().captureMode).toBe('palette');
  });

  test('loads a persisted ral setting', async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: 'ral',
    });

    expect(module.getAppSettings().captureMode).toBe('ral');
  });

  test('normalizes invalid captureMode to palette', async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: 'invalid',
    });

    expect(module.getAppSettings().captureMode).toBe('palette');
  });

  test('notifies listeners when captureMode changes', async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: 'ral' });

    expect(updates).toHaveLength(1);
    expect(updates[0].captureMode).toBe('ral');
  });

  test('does not notify when captureMode is unchanged', async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: 'palette' });

    expect(updates).toHaveLength(0);
  });

  test('default reset patch restores captureMode to palette', async () => {
    const { module } = await loadAppSettingsModule();

    module.updateAppSettings({ captureMode: 'ral' });
    module.updateAppSettings(module.getDefaultAppSettingsResetPatch());

    expect(module.getAppSettings().captureMode).toBe('palette');
  });
});

describe('app-settings medianCut.colorSpace', () => {
  test('defaults to rgb', async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().medianCut.colorSpace).toBe('rgb');
    expect(module.getAppSettings().medianCut.colorSpace).toBe('rgb');
  });

  test('loads a persisted oklch setting', async () => {
    const { module } = await loadAppSettingsModule({
      medianCut: { colorSpace: 'oklch' },
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe('oklch');
  });

  test('persists updates and resets to rgb', async () => {
    const { module, localStorageMock } = await loadAppSettingsModule();

    module.updateAppSettings({
      medianCut: { colorSpace: 'oklch' },
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe('oklch');
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).medianCut.colorSpace).toBe('oklch');

    module.updateAppSettings({
      medianCut: module.getDefaultAppSettings().medianCut,
    });

    expect(module.getAppSettings().medianCut.colorSpace).toBe('rgb');
    expect(JSON.parse(localStorageMock.dump(SETTINGS_STORAGE_KEY)).medianCut.colorSpace).toBe('rgb');
  });
});
