import { describe, expect, test } from "bun:test";

import { flushAllLocalData } from "./local-data-reset.js";

function createLocalStorageMock(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    removeItem(key) {
      store.delete(key);
    },
    dump(key) {
      return this.getItem(key);
    },
  };
}

describe("flushAllLocalData", () => {
  test("clears saved palettes and only removes Paletcam-owned local data", async () => {
    let clearPaletteStorageCalls = 0;
    const storage = createLocalStorageMock({
      "paletcam:settings:v1": '{"locale":"fr"}',
      "paletcam:grid:v1": "1",
      "pwa-install-dismissed": "true",
      "unrelated:key": "keep",
    });
    const sessionStorage = createLocalStorageMock({
      "paletcam:metric:session-started:v1": "1",
      "paletcam:telemetry-correlation:v1": "correlation-id",
      "pwa-install-dismissed": "session-unrelated",
      "unrelated:session": "keep",
    });

    await flushAllLocalData({
      clearPaletteStorage: async () => {
        clearPaletteStorageCalls += 1;
      },
      sessionStorage,
      storage,
    });

    expect(clearPaletteStorageCalls).toBe(1);
    expect(storage.dump("paletcam:settings:v1")).toBeNull();
    expect(storage.dump("paletcam:grid:v1")).toBeNull();
    expect(storage.dump("pwa-install-dismissed")).toBeNull();
    expect(storage.dump("unrelated:key")).toBe("keep");
    expect(sessionStorage.dump("paletcam:metric:session-started:v1")).toBeNull();
    expect(sessionStorage.dump("paletcam:telemetry-correlation:v1")).toBeNull();
    expect(sessionStorage.dump("pwa-install-dismissed")).toBe("session-unrelated");
    expect(sessionStorage.dump("unrelated:session")).toBe("keep");
  });

  test("still clears palette storage when localStorage is unavailable", async () => {
    let clearPaletteStorageCalls = 0;

    await flushAllLocalData({
      clearPaletteStorage: async () => {
        clearPaletteStorageCalls += 1;
      },
      sessionStorage: null,
      storage: null,
    });

    expect(clearPaletteStorageCalls).toBe(1);
  });

  test("attempts every owned store and reports residual data after partial failure", async () => {
    const storage = createLocalStorageMock({
      "paletcam:settings:v1": "settings",
      "paletcam:grid:v1": "grid",
    });
    const originalRemoveItem = storage.removeItem.bind(storage);
    storage.removeItem = (key) => {
      if (key === "paletcam:settings:v1") throw new Error("storage blocked");
      originalRemoveItem(key);
    };
    const sessionStorage = createLocalStorageMock({
      "paletcam:telemetry-correlation:v1": "correlation",
    });

    const reset = flushAllLocalData({
      clearPaletteStorage: async () => {
        throw new Error("IndexedDB blocked");
      },
      sessionStorage,
      storage,
    });

    await expect(reset).rejects.toMatchObject({
      name: "LocalDataResetError",
      result: {
        localStorage: {
          failedKeys: ["paletcam:settings:v1"],
          removedCount: 1,
        },
        paletteStorageCleared: false,
        sessionStorage: { failedKeys: [], removedCount: 1 },
      },
    });
    expect(storage.dump("paletcam:settings:v1")).toBe("settings");
    expect(storage.dump("paletcam:grid:v1")).toBeNull();
    expect(sessionStorage.dump("paletcam:telemetry-correlation:v1")).toBeNull();
  });
});
