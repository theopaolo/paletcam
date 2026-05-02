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

    await flushAllLocalData({
      clearPaletteStorage: async () => {
        clearPaletteStorageCalls += 1;
      },
      storage,
    });

    expect(clearPaletteStorageCalls).toBe(1);
    expect(storage.dump("paletcam:settings:v1")).toBeNull();
    expect(storage.dump("paletcam:grid:v1")).toBeNull();
    expect(storage.dump("pwa-install-dismissed")).toBeNull();
    expect(storage.dump("unrelated:key")).toBe("keep");
  });

  test("still clears palette storage when localStorage is unavailable", async () => {
    let clearPaletteStorageCalls = 0;

    await flushAllLocalData({
      clearPaletteStorage: async () => {
        clearPaletteStorageCalls += 1;
      },
      storage: null,
    });

    expect(clearPaletteStorageCalls).toBe(1);
  });
});
