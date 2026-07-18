import { describe, expect, mock, test } from "bun:test";
import { createDatabaseLifecycleCoordinator } from "./database-lifecycle.js";

function createHarness() {
  const handlers = new Map();
  const database = {
    close: mock(() => {}),
    on: mock((eventName, listener) => handlers.set(eventName, listener)),
  };
  const recordFailure = mock(() => true);
  const coordinator = createDatabaseLifecycleCoordinator(database, recordFailure);
  return { coordinator, database, handlers, recordFailure };
}

describe("database lifecycle coordinator", () => {
  test("reports blocked upgrades and notifies the recovery UI", () => {
    const { coordinator, handlers, recordFailure } = createHarness();
    const listener = mock(() => {});
    coordinator.subscribe(listener);

    handlers.get("blocked")();

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure.mock.calls[0][0]).toBe("maintenance");
    expect(recordFailure.mock.calls[0][1].name).toBe("BlockedError");
    expect(listener).toHaveBeenCalledWith("blocked");
  });

  test("closes an obsolete connection and supports listener cleanup", () => {
    const { coordinator, database, handlers } = createHarness();
    const listener = mock(() => {});
    const unsubscribe = coordinator.subscribe(listener);
    unsubscribe();

    handlers.get("versionchange")();

    expect(database.close).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
