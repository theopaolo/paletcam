export class WriteQueueConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WriteQueueConfigurationError";
  }
}

/**
 * Serializes log writes while placing a hard bound on accepted work. The
 * pending count includes the active write so admission is deterministic even
 * when the storage device stalls.
 *
 * @param {{maxPending: number}} options
 */
export function createBoundedWriteQueue({ maxPending }) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new WriteQueueConfigurationError("maxPending must be a positive safe integer.");
  }

  let pendingCount = 0;
  let writeTail = Promise.resolve();

  function isSaturated() {
    return pendingCount >= maxPending;
  }

  return Object.freeze({
    getMaxPending() {
      return maxPending;
    },

    getPendingCount() {
      return pendingCount;
    },

    isSaturated,

    /**
     * @template T
     * @param {() => T | Promise<T>} write
     * @returns {Promise<T> | null} Null when the bounded queue cannot admit work.
     */
    tryEnqueue(write) {
      if (typeof write !== "function") {
        throw new TypeError("write must be a function.");
      }
      if (isSaturated()) {
        return null;
      }

      pendingCount += 1;
      const result = writeTail.then(write);
      // A failed write must not poison later accepted work. Keep the internal
      // tail fulfilled while returning the original result to the caller.
      writeTail = result.then(
        () => undefined,
        () => undefined,
      );

      return result.finally(() => {
        pendingCount -= 1;
      });
    },
  });
}
