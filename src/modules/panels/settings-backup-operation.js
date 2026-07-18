import { createObjectUrlLifecycle } from "../object-url-lifecycle.js";

const BACKUP_OPERATION_KINDS = new Set(["export", "import"]);

/**
 * Owns the settings backup operation independently from any locale-specific
 * controller mount. A locale remount can therefore observe the same in-flight
 * operation without starting a duplicate or disposing its download URL owner.
 *
 * @param {{objectUrls?: {create: (blob: Blob) => string, dispose: () => boolean}}} [options]
 */
export function createSettingsBackupOperationCoordinator({ objectUrls } = {}) {
  const exportObjectUrls = objectUrls ?? createObjectUrlLifecycle();
  const listeners = new Set();
  let activeOperation = null;
  let destroyed = false;

  function getSnapshot() {
    return {
      kind: activeOperation?.kind ?? null,
      progress: activeOperation?.progress ?? null,
      token: activeOperation?.token ?? null,
    };
  }

  function notifyListeners() {
    const snapshot = getSnapshot();
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  function begin(kind) {
    if (destroyed || activeOperation || !BACKUP_OPERATION_KINDS.has(kind)) {
      return null;
    }

    const token = Symbol(kind);
    activeOperation = { kind, progress: null, token };
    notifyListeners();

    const isActive = () => !destroyed && activeOperation?.token === token;

    return {
      token,
      isActive,
      setProgress(progress) {
        if (!isActive()) {
          return false;
        }
        activeOperation = { ...activeOperation, progress };
        notifyListeners();
        return true;
      },
      createObjectUrl(blob) {
        return isActive() ? exportObjectUrls.create(blob) : null;
      },
      finish() {
        if (!isActive()) {
          return false;
        }
        activeOperation = null;
        notifyListeners();
        return true;
      },
    };
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== "function") {
      return () => {};
    }

    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  }

  function destroy() {
    if (destroyed) {
      return false;
    }

    destroyed = true;
    activeOperation = null;
    notifyListeners();
    listeners.clear();
    exportObjectUrls.dispose();
    return true;
  }

  return { begin, destroy, getSnapshot, subscribe };
}
