/** @typedef {{activeCount: number, exclusive: boolean, names: string[]}} CriticalOperationSnapshot */

/** @type {Map<symbol, string>} */
const activeOperations = new Map();
/** @type {Set<(snapshot: CriticalOperationSnapshot) => void>} */
const listeners = new Set();
/** @type {symbol | null} */
let exclusiveOperationId = null;

function getSnapshot() {
  return {
    activeCount: activeOperations.size,
    exclusive: exclusiveOperationId !== null,
    names: [...new Set(activeOperations.values())].sort(),
  };
}

function notifyListeners() {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Critical-operation listener failed:", error);
    }
  });
}

/**
 * Marks a reload-sensitive operation active. The returned release function is
 * idempotent so callers can safely invoke it from every completion path.
 *
 * @param {string} name
 * @returns {() => void}
 */
function startCriticalOperation(name, { exclusive = false } = {}) {
  const normalizedName = String(name || "operation").trim() || "operation";
  const operationId = Symbol(normalizedName);
  activeOperations.set(operationId, normalizedName);
  if (exclusive) {
    exclusiveOperationId = operationId;
  }
  notifyListeners();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeOperations.delete(operationId);
    if (exclusiveOperationId === operationId) {
      exclusiveOperationId = null;
    }
    notifyListeners();
  };
}

/**
 * Starts a shared critical operation unless a destructive exclusive operation
 * currently owns the application state.
 *
 * @param {string} name
 * @returns {(() => void) | null}
 */
export function tryBeginCriticalOperation(name) {
  if (exclusiveOperationId !== null) {
    return null;
  }
  return startCriticalOperation(name);
}

/**
 * Starts a shared critical operation. Callers that can safely defer work should
 * prefer `tryBeginCriticalOperation` and handle a null result explicitly.
 *
 * @param {string} name
 * @returns {() => void}
 */
export function beginCriticalOperation(name) {
  const release = tryBeginCriticalOperation(name);
  if (!release) {
    const error = new Error("A destructive local-data operation is already in progress.");
    error.name = "CriticalOperationConflictError";
    throw error;
  }
  return release;
}

/**
 * Acquires exclusive ownership only when no other critical work is active.
 * This is intentionally non-waiting: destructive commands must ask the user to
 * retry instead of silently running after the operation they observed changes.
 *
 * @param {string} name
 * @returns {(() => void) | null}
 */
export function tryBeginExclusiveCriticalOperation(name) {
  if (activeOperations.size > 0) {
    return null;
  }
  return startCriticalOperation(name, { exclusive: true });
}

export function isCriticalOperationActive() {
  return activeOperations.size > 0;
}

/**
 * @param {(snapshot: CriticalOperationSnapshot) => void} listener
 * @returns {() => void}
 */
export function subscribeCriticalOperations(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetCriticalOperationsForTests() {
  activeOperations.clear();
  exclusiveOperationId = null;
  listeners.clear();
}
