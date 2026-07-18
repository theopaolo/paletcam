import { describe, expect, mock, test } from "bun:test";
import { createModerationSyncController } from "./moderation-sync-controller.js";

function createScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    clearTimeoutFn: mock((id) => callbacks.delete(id)),
    flush(id) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.();
    },
    getIds: () => [...callbacks.keys()],
    setTimeoutFn: mock((callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    }),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createAbortError() {
  const error = new Error("The moderation request was aborted.");
  error.name = "AbortError";
  return error;
}

function createHarness(overrides = {}) {
  const scheduler = createScheduler();
  let active = true;
  const adapters = {
    isActive: () => active,
    runSync: mock(async () => ({ pendingCount: 0, updatedCount: 0 })),
    onUpdated: mock(async () => {}),
    onError: mock(() => {}),
    delayMs: 25,
    ...scheduler,
    ...overrides,
  };
  return {
    adapters,
    controller: createModerationSyncController(adapters),
    scheduler,
    setActive(value) {
      active = value;
    },
  };
}

describe("collection moderation sync controller", () => {
  test("deduplicates an active sync and schedules one follow-up for pending moderation", async () => {
    const deferred = createDeferred();
    const runSync = mock(() => deferred.promise);
    const { controller, scheduler } = createHarness({ runSync });

    const firstRun = controller.runNow();
    const secondRun = controller.runNow();
    expect(firstRun).toBe(secondRun);
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(runSync.mock.calls[0][0].aborted).toBe(false);

    deferred.resolve({ pendingCount: 2, updatedCount: 0 });
    await firstRun;

    expect(scheduler.getIds()).toHaveLength(1);
    expect(scheduler.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 25);
  });

  test("stopping a view suppresses stale reloads, errors, and rescheduling", async () => {
    let receivedSignal;
    const runSync = mock(
      (signal) =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener("abort", () => reject(createAbortError()), { once: true });
        }),
    );
    const { adapters, controller, scheduler, setActive } = createHarness({ runSync });

    const pendingRun = controller.runNow();
    await Promise.resolve();
    expect(receivedSignal.aborted).toBe(false);
    setActive(false);
    controller.stop();
    expect(receivedSignal.aborted).toBe(true);

    expect(await pendingRun).toEqual({ status: "cancelled" });
    expect(adapters.onUpdated).not.toHaveBeenCalled();
    expect(adapters.onError).not.toHaveBeenCalled();
    expect(scheduler.getIds()).toHaveLength(0);
  });

  test("closing clears a scheduled poll before it can start", async () => {
    const { adapters, controller, scheduler, setActive } = createHarness();

    expect(controller.schedule()).toBe(true);
    const [scheduledId] = scheduler.getIds();
    setActive(false);
    controller.stop();
    scheduler.flush(scheduledId);
    await Promise.resolve();

    expect(adapters.runSync).not.toHaveBeenCalled();
    expect(scheduler.clearTimeoutFn).toHaveBeenCalledWith(scheduledId);
  });

  test("a reopened generation refreshes after an older in-flight run settles", async () => {
    let staleSignal;
    const runSync = mock((signal) => {
      if (runSync.mock.calls.length === 1) {
        staleSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(createAbortError()), { once: true });
        });
      }
      return Promise.resolve({ pendingCount: 0, updatedCount: 0 });
    });
    const { controller, setActive } = createHarness({ runSync });

    const staleRun = controller.runNow();
    await Promise.resolve();
    setActive(false);
    controller.stop();
    expect(staleSignal.aborted).toBe(true);
    setActive(true);
    const reopenedRun = controller.runNow();

    expect(await staleRun).toEqual({ status: "cancelled" });
    expect(await reopenedRun).toMatchObject({ status: "completed" });
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  test("reports active-generation failures and never runs after destruction", async () => {
    const failure = new Error("moderation unavailable");
    const { adapters, controller } = createHarness({
      runSync: mock(async () => {
        throw failure;
      }),
    });

    expect(await controller.runNow()).toEqual({ status: "failed", error: failure });
    expect(adapters.onError).toHaveBeenCalledWith(failure);

    controller.destroy();
    expect(controller.schedule()).toBe(false);
    expect(await controller.runNow()).toEqual({ status: "inactive" });
  });

  test("destroy aborts transport work and suppresses its cancellation error", async () => {
    let receivedSignal;
    const runSync = mock(
      (signal) =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener("abort", () => reject(createAbortError()), { once: true });
        }),
    );
    const { adapters, controller } = createHarness({ runSync });

    const pendingRun = controller.runNow();
    await Promise.resolve();
    controller.destroy();

    expect(receivedSignal.aborted).toBe(true);
    expect(await pendingRun).toEqual({ status: "cancelled" });
    expect(adapters.onError).not.toHaveBeenCalled();
    expect(controller.isRunning()).toBe(false);
  });

  test("suppresses an AbortError rejected by the injected sync use case", async () => {
    const { adapters, controller } = createHarness({
      runSync: mock(async () => {
        throw createAbortError();
      }),
    });

    expect(await controller.runNow()).toEqual({ status: "cancelled" });
    expect(adapters.onError).not.toHaveBeenCalled();
  });
});
