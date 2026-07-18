const COMMIT_DISMISS_REASONS = new Set(["interrupted", "swipe", "user-dismiss"]);

/**
 * @typedef {
 *   | "pending"
 *   | "undoing"
 *   | "committing"
 *   | "undone"
 *   | "committed"
 *   | "cancelled"
 *   | "failed"
 * } DeletionSettlementState
 */

/**
 * @typedef {object} DeletionSettlementOutcome
 * @property {boolean} accepted
 * @property {DeletionSettlementState} state
 * @property {unknown} [error]
 * @property {unknown} [value]
 */

/** @typedef {() => unknown | Promise<unknown>} DeletionSettlementAdapter */

/**
 * @typedef {object} DeletionSettlementRecord
 * @property {DeletionSettlementAdapter | undefined} undo
 * @property {DeletionSettlementAdapter | undefined} commit
 * @property {DeletionSettlementAdapter} cancel
 * @property {DeletionSettlementState} state
 */

/**
 * Coordinates exact-once settlement of staged deletions without importing DOM,
 * toast, storage, network, scheduler, or reporting adapters. An operation stops
 * being coordinator-owned before any settlement adapter runs, so long-running
 * commits cannot retain unrelated pending work or be cancelled midway.
 *
 * @param {object} [options]
 * @param {(error: unknown, context: {settlement: "undo" | "commit" | "cancel", trigger: string}) => unknown | Promise<unknown>} [options.onSettlementError]
 */
export function createDeletionSettlementCoordinator({ onSettlementError = () => {} } = {}) {
  /** @type {Set<DeletionSettlementRecord>} */
  const activeOperations = new Set();
  let destroyed = false;

  /**
   * @param {DeletionSettlementState} state
   * @returns {DeletionSettlementOutcome}
   */
  function createIgnoredOutcome(state) {
    return { accepted: false, state };
  }

  /**
   * @param {DeletionSettlementState} state
   * @param {unknown} value
   * @returns {DeletionSettlementOutcome}
   */
  function createSuccessOutcome(state, value) {
    return value === undefined ? { accepted: true, state } : { accepted: true, state, value };
  }

  /**
   * @param {unknown} error
   * @param {{settlement: "undo" | "commit" | "cancel", trigger: string}} context
   */
  async function reportSettlementError(error, context) {
    try {
      await onSettlementError(error, context);
    } catch {
      // Error reporting is best-effort and cannot reopen a settled operation.
    }
  }

  /**
   * @param {DeletionSettlementRecord} record
   * @param {"undo" | "commit" | "cancel"} settlement
   * @param {string} trigger
   * @returns {Promise<DeletionSettlementOutcome>}
   */
  async function settle(record, settlement, trigger) {
    if (record.state !== "pending") {
      return createIgnoredOutcome(record.state);
    }

    activeOperations.delete(record);
    record.state =
      settlement === "undo" ? "undoing" : settlement === "commit" ? "committing" : "cancelled";

    const adapter = record[settlement];
    try {
      if (typeof adapter !== "function") {
        throw new TypeError(`Deletion ${settlement} adapter is unavailable.`);
      }
      const value = await adapter();
      record.state =
        settlement === "undo" ? "undone" : settlement === "commit" ? "committed" : "cancelled";
      return createSuccessOutcome(record.state, value);
    } catch (error) {
      record.state = "failed";
      await reportSettlementError(error, { settlement, trigger });
      return { accepted: true, state: "failed", error };
    }
  }

  /**
   * @param {object} [adapters]
   * @param {DeletionSettlementAdapter} [adapters.undo]
   * @param {DeletionSettlementAdapter} [adapters.commit]
   * @param {DeletionSettlementAdapter} [adapters.cancel]
   */
  function stage({ undo, commit, cancel = () => {} } = {}) {
    /** @type {DeletionSettlementRecord} */
    const record = {
      cancel,
      commit,
      state: /** @type {DeletionSettlementState} */ (destroyed ? "cancelled" : "pending"),
      undo,
    };

    if (!destroyed) {
      activeOperations.add(record);
    }

    return {
      /** Explicitly cancels provisional work without committing the deletion. */
      cancel: () => settle(record, "cancel", "programmatic"),
      /**
       * Settles a non-action toast dismissal according to the deletion policy.
       * @param {string} reason
       */
      dismiss(reason) {
        if (COMMIT_DISMISS_REASONS.has(reason)) {
          return settle(record, "commit", reason);
        }
        if (reason === "programmatic") {
          return settle(record, "cancel", reason);
        }
        return Promise.resolve(createIgnoredOutcome(record.state));
      },
      /** Commits when the undo window expires. */
      expire: () => settle(record, "commit", "timeout"),
      getState: () => record.state,
      /** Rolls the staged deletion back. */
      undo: () => settle(record, "undo", "action"),
    };
  }

  function cancelAll() {
    return Promise.all(
      [...activeOperations].map((record) => settle(record, "cancel", "cancel-all")),
    );
  }

  async function destroy() {
    if (destroyed) {
      return false;
    }
    destroyed = true;
    await cancelAll();
    return true;
  }

  return {
    cancelAll,
    destroy,
    getActiveCount: () => activeOperations.size,
    isDestroyed: () => destroyed,
    stage,
  };
}
