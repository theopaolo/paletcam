const DEFAULT_SYNC_DELAY_MS = 12_000;
const CANCELLED_BEFORE_START = Symbol("moderation-sync-cancelled-before-start");

/** @typedef {{pendingCount?: number, updatedCount?: number}} ModerationSyncResult */
/**
 * @typedef {
 *   | {status: "inactive"}
 *   | {status: "cancelled"}
 *   | {status: "cancelled", result: ModerationSyncResult}
 *   | {status: "completed", result: ModerationSyncResult}
 *   | {status: "failed", error: unknown}
 * } ModerationSyncRunOutcome
 */
/** @typedef {ReturnType<typeof globalThis.setTimeout>} TimerHandle */

/** @param {unknown} error */
function isAbortError(error) {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

/**
 * Owns the collection moderation polling lifecycle. Network/storage work remains
 * in the injected use case; this controller prevents a closed or destroyed view
 * from applying stale results, reloading UI, or scheduling another poll.
 *
 * @param {object} options
 * @param {() => boolean} options.isActive
 * @param {(signal: AbortSignal) => Promise<ModerationSyncResult>} options.runSync
 * @param {() => Promise<unknown> | unknown} options.onUpdated
 * @param {(error: unknown) => void} [options.onError]
 * @param {number} [options.delayMs]
 * @param {(callback: () => void, delayMs: number) => TimerHandle} [options.setTimeoutFn]
 * @param {(timeoutId: TimerHandle) => void} [options.clearTimeoutFn]
 */
export function createModerationSyncController({
  isActive,
  runSync,
  onUpdated,
  onError = () => {},
  delayMs = DEFAULT_SYNC_DELAY_MS,
  setTimeoutFn = globalThis.setTimeout.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
}) {
  /** @type {Promise<ModerationSyncRunOutcome> | null} */
  let activeRun = null;
  /** @type {AbortController | null} */
  let activeRunAbortController = null;
  let activeRunGeneration = -1;
  let generation = 0;
  let isDestroyed = false;
  /** @type {TimerHandle | null} */
  let timeoutId = null;

  /** @param {number} runGeneration */
  function canApplyResult(runGeneration) {
    return !isDestroyed && runGeneration === generation && isActive();
  }

  function clearScheduled() {
    if (timeoutId === null) {
      return false;
    }

    clearTimeoutFn(timeoutId);
    timeoutId = null;
    return true;
  }

  function stop() {
    generation += 1;
    activeRunAbortController?.abort();
    clearScheduled();
  }

  function schedule() {
    clearScheduled();
    if (isDestroyed || !isActive()) {
      return false;
    }

    const scheduledGeneration = generation;
    timeoutId = setTimeoutFn(() => {
      timeoutId = null;
      if (!canApplyResult(scheduledGeneration)) {
        return;
      }
      void runNow();
    }, delayMs);
    return true;
  }

  /** @returns {Promise<ModerationSyncRunOutcome>} */
  function runNow() {
    if (isDestroyed || !isActive()) {
      return Promise.resolve({ status: "inactive" });
    }

    if (activeRun) {
      if (activeRunGeneration === generation) {
        return activeRun;
      }

      // A previous view generation is still settling. Start the newly opened
      // view's refresh only after that work releases the single-flight slot.
      return activeRun.then(() => runNow());
    }

    const runGeneration = generation;
    const runAbortController = new AbortController();
    activeRunAbortController = runAbortController;
    activeRunGeneration = runGeneration;
    activeRun = Promise.resolve()
      .then(() => {
        if (runAbortController.signal.aborted) {
          throw CANCELLED_BEFORE_START;
        }
        return runSync(runAbortController.signal);
      })
      .then(async (result) => {
        if (!canApplyResult(runGeneration)) {
          return { status: "cancelled", result };
        }

        if (Number(result?.updatedCount) > 0) {
          await onUpdated();
          if (!canApplyResult(runGeneration)) {
            return { status: "cancelled", result };
          }
        }

        if (Number(result?.pendingCount) > 0) {
          schedule();
        }

        return { status: "completed", result };
      })
      .catch((error) => {
        if (
          runAbortController.signal.aborted ||
          isAbortError(error) ||
          !canApplyResult(runGeneration)
        ) {
          return { status: "cancelled" };
        }

        onError(error);
        return { status: "failed", error };
      })
      .finally(() => {
        if (activeRunAbortController === runAbortController) {
          activeRunAbortController = null;
        }
        activeRun = null;
        activeRunGeneration = -1;
      });

    return activeRun;
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }
    isDestroyed = true;
    stop();
  }

  return {
    clearScheduled,
    destroy,
    isRunning: () => Boolean(activeRun),
    runNow,
    schedule,
    stop,
  };
}
