/**
 * Owns the terminal lifetime of the lazily loaded collection feature. Event
 * listeners share one AbortSignal while non-event resources register explicit
 * cleanup callbacks. Destruction is idempotent and attempts every cleanup even
 * if one adapter fails.
 *
 * @param {object} [options]
 * @param {(error: unknown) => void} [options.onCleanupError]
 * @param {() => AbortController} [options.createAbortController]
 */
export function createCollectionLifecycle({
  onCleanupError = () => {},
  createAbortController = () => new AbortController(),
} = {}) {
  const abortController = createAbortController();
  /** @type {Set<() => void>} */
  const cleanupCallbacks = new Set();
  let destroyed = false;

  /** @param {() => void} cleanup */
  function runCleanup(cleanup) {
    try {
      cleanup();
    } catch (error) {
      onCleanupError(error);
    }
  }

  /**
   * @param {() => void} cleanup
   * @returns {() => void} unregisters the callback without running it
   */
  function registerCleanup(cleanup) {
    if (typeof cleanup !== "function") {
      return () => {};
    }

    if (destroyed) {
      runCleanup(cleanup);
      return () => {};
    }

    cleanupCallbacks.add(cleanup);
    return () => cleanupCallbacks.delete(cleanup);
  }

  function destroy() {
    if (destroyed) {
      return false;
    }

    destroyed = true;
    abortController.abort();

    const callbacks = [...cleanupCallbacks];
    cleanupCallbacks.clear();
    callbacks.forEach(runCleanup);
    return true;
  }

  return {
    destroy,
    isDestroyed: () => destroyed,
    registerCleanup,
    signal: abortController.signal,
  };
}
