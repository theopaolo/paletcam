const LOCAL_STORAGE_PREFIX = "paletcam:";
const EXTRA_LOCAL_STORAGE_KEYS = new Set(["pwa-install-dismissed"]);

async function clearSavedPalettes() {
  const paletteStorageModule = await import("../palette-storage.js");
  return paletteStorageModule.clearSavedPalettes();
}

function shouldRemoveLocalStorageKey(key) {
  return key.startsWith(LOCAL_STORAGE_PREFIX) || EXTRA_LOCAL_STORAGE_KEYS.has(key);
}

function getResettableLocalStorageKeys(storage) {
  if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") {
    return [];
  }

  const keys = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string" && shouldRemoveLocalStorageKey(key)) {
      keys.push(key);
    }
  }

  return keys;
}

export async function flushAllLocalData({
  clearPaletteStorage = clearSavedPalettes,
  storage = globalThis.localStorage,
} = {}) {
  await clearPaletteStorage();

  getResettableLocalStorageKeys(storage).forEach((key) => {
    storage.removeItem(key);
  });
}
