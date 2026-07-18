import { describe, expect, mock, test } from "bun:test";
import { createCollectionLoadCoordinator } from "./collection-load-coordinator.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(overrides = {}) {
  const applyPalettes = mock(() => true);
  const handleFailure = mock(() => {});
  const recordMetric = mock(() => {});
  const selectPalettes = mock((palettes) => palettes);
  const nowValues = overrides.nowValues ?? [0, 1, 5, 6, 8, 9, 12, 15];
  let nowIndex = 0;
  const coordinator = createCollectionLoadCoordinator({
    applyPalettes,
    handleFailure,
    loadPalettes: overrides.loadPalettes ?? (async () => []),
    selectPalettes,
    recordMetric,
    now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
    ...overrides,
  });
  return { applyPalettes, coordinator, handleFailure, recordMetric, selectPalettes };
}

describe("collection load coordinator", () => {
  test("applies only the newest overlapping load", async () => {
    const first = deferred();
    const second = deferred();
    const loadPalettes = mock(() =>
      loadPalettes.mock.calls.length === 1 ? first.promise : second.promise,
    );
    const { applyPalettes, coordinator, recordMetric } = createHarness({ loadPalettes });

    const firstLoad = coordinator.load();
    const secondLoad = coordinator.load();
    second.resolve([{ id: 2 }]);
    await expect(secondLoad).resolves.toBe("applied");
    first.resolve([{ id: 1 }]);
    await expect(firstLoad).resolves.toBe("stale");

    expect(applyPalettes).toHaveBeenCalledTimes(1);
    expect(applyPalettes).toHaveBeenCalledWith([{ id: 2 }]);
    expect(recordMetric).toHaveBeenCalledTimes(1);
  });

  test("suppresses late resolve and rejection after invalidation", async () => {
    const first = deferred();
    const second = deferred();
    const loadPalettes = mock(() =>
      loadPalettes.mock.calls.length === 1 ? first.promise : second.promise,
    );
    const { applyPalettes, coordinator, handleFailure, recordMetric } = createHarness({
      loadPalettes,
    });

    const resolvingLoad = coordinator.load();
    coordinator.invalidate();
    first.resolve([{ id: 1 }]);
    await expect(resolvingLoad).resolves.toBe("stale");

    const rejectingLoad = coordinator.load();
    coordinator.invalidate();
    second.reject(new Error("late failure"));
    await expect(rejectingLoad).resolves.toBe("stale");

    expect(applyPalettes).not.toHaveBeenCalled();
    expect(handleFailure).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
  });

  test("selects against live state after storage resolves", async () => {
    const pending = deferred();
    const excludedIds = new Set();
    const selectPalettes = mock((palettes) =>
      palettes.filter((palette) => !excludedIds.has(palette.id)),
    );
    const { applyPalettes, coordinator } = createHarness({
      loadPalettes: () => pending.promise,
      selectPalettes,
    });

    const loading = coordinator.load();
    excludedIds.add(2);
    pending.resolve([{ id: 1 }, { id: 2 }]);

    await expect(loading).resolves.toBe("applied");
    expect(applyPalettes).toHaveBeenCalledWith([{ id: 1 }]);
  });

  test("preserves rounded success timing and count fields", async () => {
    const { coordinator, recordMetric } = createHarness({
      loadPalettes: async () => [{ id: 1 }, { id: 2 }],
      selectPalettes: (palettes) => palettes.slice(0, 1),
      nowValues: [0.2, 1.1, 5.6, 6.2, 8.9, 9.4, 12.6, 15.1],
    });

    await expect(coordinator.load()).resolves.toBe("applied");
    expect(recordMetric).toHaveBeenCalledWith("loadCollectionUi:success", {
      totalMs: 15,
      fetchMs: 5,
      filterMs: 3,
      renderMs: 3,
      fetchedCount: 2,
      displayedCount: 1,
    });
  });

  test.each(["storage", "render"])("contains one %s failure", async (failurePoint) => {
    const failure = new TypeError(`${failurePoint} failed`);
    const { coordinator, handleFailure, recordMetric } = createHarness({
      applyPalettes: () => {
        if (failurePoint === "render") throw failure;
        return true;
      },
      loadPalettes: async () => {
        if (failurePoint === "storage") throw failure;
        return [];
      },
      nowValues: [0, 1, 8],
    });

    await expect(coordinator.load()).resolves.toBe("failed");
    expect(handleFailure).toHaveBeenCalledTimes(1);
    expect(handleFailure).toHaveBeenCalledWith(failure);
    expect(recordMetric).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenCalledWith("loadCollectionUi:error", {
      totalMs: 8,
      errorName: "TypeError",
    });
  });

  test("invalidates captured viewer guards on load, close, and destruction", async () => {
    const { coordinator } = createHarness();
    const initialGuard = coordinator.captureGuard();
    expect(initialGuard()).toBe(true);

    await coordinator.load();
    expect(initialGuard()).toBe(false);
    const loadedGuard = coordinator.captureGuard();
    expect(loadedGuard()).toBe(true);

    coordinator.invalidate();
    expect(loadedGuard()).toBe(false);
    const closingGuard = coordinator.captureGuard();
    expect(closingGuard()).toBe(true);

    expect(coordinator.destroy()).toBe(true);
    expect(coordinator.destroy()).toBe(false);
    expect(closingGuard()).toBe(false);
    await expect(coordinator.load()).resolves.toBe("destroyed");
  });

  test("treats an adapter refusal as stale and telemetry failures as best-effort", async () => {
    const recordMetric = mock(() => {
      throw new Error("telemetry offline");
    });
    const accepted = createHarness({ recordMetric });
    await expect(accepted.coordinator.load()).resolves.toBe("applied");

    const refused = createHarness({ applyPalettes: () => false });
    await expect(refused.coordinator.load()).resolves.toBe("stale");
    expect(refused.handleFailure).not.toHaveBeenCalled();
  });
});
