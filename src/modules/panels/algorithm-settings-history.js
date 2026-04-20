import {
  areAlgorithmSettingsEqual,
  cloneAlgorithmSettings,
} from "../algorithm-settings.js";

export function createAlgorithmSettingsHistory({ initialSnapshot }) {
  let currentSnapshot = cloneAlgorithmSettings(initialSnapshot);
  let interactionStartSnapshot = null;
  /** @type {ReturnType<typeof cloneAlgorithmSettings>[]} */
  let undoStack = [];
  /** @type {ReturnType<typeof cloneAlgorithmSettings>[]} */
  let redoStack = [];

  function getState() {
    return {
      canRedo: redoStack.length > 0,
      canUndo: undoStack.length > 0,
      currentSnapshot: cloneAlgorithmSettings(currentSnapshot),
      hasActiveInteraction: interactionStartSnapshot !== null,
    };
  }

  function beginInteraction(snapshot = currentSnapshot) {
    if (interactionStartSnapshot !== null) {
      return false;
    }

    interactionStartSnapshot = cloneAlgorithmSettings(snapshot);
    return true;
  }

  function clearInteraction() {
    interactionStartSnapshot = null;
  }

  function setCurrentSnapshot(snapshot) {
    currentSnapshot = cloneAlgorithmSettings(snapshot);
    return getState();
  }

  function commitInteraction(nextSnapshot) {
    const normalizedNextSnapshot = cloneAlgorithmSettings(nextSnapshot);
    const baselineSnapshot = interactionStartSnapshot
      ? cloneAlgorithmSettings(interactionStartSnapshot)
      : cloneAlgorithmSettings(currentSnapshot);

    interactionStartSnapshot = null;
    if (areAlgorithmSettingsEqual(baselineSnapshot, normalizedNextSnapshot)) {
      currentSnapshot = normalizedNextSnapshot;
      return false;
    }

    undoStack.push(baselineSnapshot);
    redoStack = [];
    currentSnapshot = normalizedNextSnapshot;
    return true;
  }

  function applySnapshot(nextSnapshot) {
    const normalizedNextSnapshot = cloneAlgorithmSettings(nextSnapshot);
    clearInteraction();

    if (areAlgorithmSettingsEqual(currentSnapshot, normalizedNextSnapshot)) {
      return false;
    }

    undoStack.push(cloneAlgorithmSettings(currentSnapshot));
    redoStack = [];
    currentSnapshot = normalizedNextSnapshot;
    return true;
  }

  function undo() {
    if (undoStack.length === 0) {
      return null;
    }

    const previousSnapshot = undoStack.pop();
    redoStack.push(cloneAlgorithmSettings(currentSnapshot));
    currentSnapshot = cloneAlgorithmSettings(previousSnapshot);
    clearInteraction();
    return cloneAlgorithmSettings(currentSnapshot);
  }

  function redo() {
    if (redoStack.length === 0) {
      return null;
    }

    const nextSnapshot = redoStack.pop();
    undoStack.push(cloneAlgorithmSettings(currentSnapshot));
    currentSnapshot = cloneAlgorithmSettings(nextSnapshot);
    clearInteraction();
    return cloneAlgorithmSettings(currentSnapshot);
  }

  function reset(snapshot = currentSnapshot) {
    return applySnapshot(snapshot);
  }

  function clearHistory(snapshot = currentSnapshot) {
    currentSnapshot = cloneAlgorithmSettings(snapshot);
    interactionStartSnapshot = null;
    undoStack = [];
    redoStack = [];
    return getState();
  }

  return {
    applySnapshot,
    beginInteraction,
    clearHistory,
    clearInteraction,
    commitInteraction,
    getState,
    redo,
    reset,
    setCurrentSnapshot,
    undo,
  };
}
