import { recordIndexedDbFailure } from "../modules/operational-metrics.js";

/**
 * Owns IndexedDB cross-tab upgrade behavior without coupling the database adapter to UI code.
 * @param {object} database
 * @param {(operation: string, error: unknown) => boolean} [recordFailure]
 */
export function createDatabaseLifecycleCoordinator(
  database,
  recordFailure = recordIndexedDbFailure,
) {
  const listeners = new Set();

  function notify(type) {
    listeners.forEach((listener) => {
      listener(type);
    });
  }

  database.on("blocked", () => {
    const error = new DOMException("Database upgrade blocked by another tab.", "BlockedError");
    recordFailure("maintenance", error);
    notify("blocked");
  });

  database.on("versionchange", () => {
    database.close();
    notify("versionchange");
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
