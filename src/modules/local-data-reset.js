const LOCAL_STORAGE_PREFIX = "paletcam:";
const EXTRA_LOCAL_STORAGE_KEYS = new Set(["pwa-install-dismissed"]);

async function clearSavedPalettes() {
  const paletteStorageModule = await import("../palette-storage.js");
  return paletteStorageModule.clearSavedPalettes();
}

function getResettableStorageKeys(storage, { includeExtraKeys = false } = {}) {
  if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") {
    return [];
  }

  const keys = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      typeof key === "string" &&
      (key.startsWith(LOCAL_STORAGE_PREFIX) ||
        (includeExtraKeys && EXTRA_LOCAL_STORAGE_KEYS.has(key)))
    ) {
      keys.push(key);
    }
  }

  return keys;
}

function clearOwnedStorage(storage, options) {
  const result = { failedKeys: [], removedCount: 0 };
  if (!storage) return result;

  let keys;
  try {
    keys = getResettableStorageKeys(storage, options);
  } catch (_error) {
    result.failedKeys.push("[enumeration]");
    return result;
  }

  for (const key of keys) {
    try {
      storage.removeItem(key);
      result.removedCount += 1;
    } catch (_error) {
      result.failedKeys.push(key);
    }
  }
  return result;
}

export async function flushAllLocalData({
  clearPaletteStorage = clearSavedPalettes,
  sessionStorage = globalThis.sessionStorage,
  storage = globalThis.localStorage,
} = {}) {
  let paletteStorageCleared = false;
  let paletteStorageError = null;
  try {
    await clearPaletteStorage();
    paletteStorageCleared = true;
  } catch (error) {
    paletteStorageError = error;
  }

  const localStorage = clearOwnedStorage(storage, { includeExtraKeys: true });
  const session = clearOwnedStorage(sessionStorage);
  const result = {
    localStorage,
    paletteStorageCleared,
    sessionStorage: session,
  };

  if (
    !paletteStorageCleared ||
    localStorage.failedKeys.length > 0 ||
    session.failedKeys.length > 0
  ) {
    const error = /** @type {Error & {result: typeof result}} */ (
      new Error("Some Paletcam local data could not be cleared.", {
        cause: paletteStorageError ?? undefined,
      })
    );
    error.name = "LocalDataResetError";
    error.result = result;
    throw error;
  }

  return result;
}
