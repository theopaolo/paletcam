const DEFAULT_REVOKE_DELAY_MS = 60_000;

/**
 * Owns delayed object-URL revocation for a mounted UI controller. Disposing the
 * controller revokes every still-live URL immediately and cancels its timer.
 */
export function createObjectUrlLifecycle({
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  setTimeoutFn = globalThis.setTimeout.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  const pendingUrls = new Map();
  let disposed = false;

  function revoke(url) {
    const timeoutId = pendingUrls.get(url);
    if (timeoutId === undefined) {
      return false;
    }

    pendingUrls.delete(url);
    clearTimeoutFn(timeoutId);
    revokeObjectURL(url);
    return true;
  }

  function create(blob, { revokeAfterMs = DEFAULT_REVOKE_DELAY_MS } = {}) {
    if (disposed) {
      throw new Error("Object URL lifecycle was disposed.");
    }

    const url = createObjectURL(blob);
    const timeoutId = setTimeoutFn(
      () => {
        if (!pendingUrls.delete(url)) {
          return;
        }
        revokeObjectURL(url);
      },
      Math.max(0, Number(revokeAfterMs) || 0),
    );
    pendingUrls.set(url, timeoutId);
    return url;
  }

  function dispose() {
    if (disposed) {
      return false;
    }
    disposed = true;
    [...pendingUrls.keys()].forEach(revoke);
    return true;
  }

  return { create, dispose, revoke };
}
