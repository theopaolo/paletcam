/** @type {Set<() => void>} */
const terminationCallbacks = new Set();
let isTerminated = false;

/**
 * Registers ownership that must end with the current application lifetime.
 * Lazy modules registering after termination are closed immediately.
 *
 * @param {() => void} callback
 * @returns {() => boolean} unregister callback
 */
export function registerAppTermination(callback) {
  if (typeof callback !== "function") {
    return () => false;
  }
  if (isTerminated) {
    callback();
    return () => false;
  }

  terminationCallbacks.add(callback);
  let isRegistered = true;
  return () => {
    if (!isRegistered) {
      return false;
    }
    isRegistered = false;
    return terminationCallbacks.delete(callback);
  };
}

/** Ends the singleton application lifetime exactly once. */
export function terminateAppLifetime() {
  if (isTerminated) {
    return false;
  }

  isTerminated = true;
  const callbacks = [...terminationCallbacks];
  terminationCallbacks.clear();
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      console.error("Application termination callback failed:", error);
    }
  }
  return true;
}

export function isAppLifetimeTerminated() {
  return isTerminated;
}

export function resetAppTerminalLifecycleForTests() {
  terminationCallbacks.clear();
  isTerminated = false;
}
