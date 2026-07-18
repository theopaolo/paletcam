import { describe, expect, mock, test } from "bun:test";
import { createDeletionSettlementCoordinator } from "./deletion-settlement-coordinator.js";

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
  const undo = mock(() => "restored");
  const commit = mock(() => "deleted");
  const cancel = mock(() => "preserved");
  const onSettlementError = mock(() => {});
  const coordinator = createDeletionSettlementCoordinator({
    onSettlementError,
    ...overrides,
  });
  const operation = coordinator.stage({ undo, commit, cancel });
  return { cancel, commit, coordinator, onSettlementError, operation, undo };
}

describe("deletion settlement coordinator", () => {
  test("undo removes ownership before rollback and settles exactly once", async () => {
    const pendingUndo = deferred();
    const undo = mock(() => pendingUndo.promise);
    const { commit, coordinator, operation } = createHarness();
    const ownedOperation = coordinator.stage({ undo, commit, cancel: () => {} });

    expect(coordinator.getActiveCount()).toBe(2);
    const undoing = ownedOperation.undo();
    expect(ownedOperation.getState()).toBe("undoing");
    expect(coordinator.getActiveCount()).toBe(1);

    await expect(ownedOperation.expire()).resolves.toEqual({
      accepted: false,
      state: "undoing",
    });
    pendingUndo.resolve("restored");
    await expect(undoing).resolves.toEqual({
      accepted: true,
      state: "undone",
      value: "restored",
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();

    await operation.cancel();
  });

  test("timeout commits once and ignores every late settlement callback", async () => {
    const { cancel, commit, coordinator, operation, undo } = createHarness();

    await expect(operation.expire()).resolves.toEqual({
      accepted: true,
      state: "committed",
      value: "deleted",
    });
    expect(coordinator.getActiveCount()).toBe(0);
    expect(commit).toHaveBeenCalledTimes(1);

    for (const lateSettlement of [
      operation.undo(),
      operation.expire(),
      operation.dismiss("swipe"),
      operation.cancel(),
    ]) {
      await expect(lateSettlement).resolves.toEqual({
        accepted: false,
        state: "committed",
      });
    }
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  test.each(["user-dismiss", "swipe", "interrupted"])("%s commits exactly once", async (reason) => {
    const { commit, operation, undo } = createHarness();

    await expect(operation.dismiss(reason)).resolves.toEqual({
      accepted: true,
      state: "committed",
      value: "deleted",
    });
    await operation.dismiss(reason);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  test("programmatic dismissal cancels without commit", async () => {
    const { cancel, commit, coordinator, operation, undo } = createHarness();

    await expect(operation.dismiss("programmatic")).resolves.toEqual({
      accepted: true,
      state: "cancelled",
      value: "preserved",
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(coordinator.getActiveCount()).toBe(0);
  });

  test("unknown and callback-owned dismissal reasons are strict no-ops", async () => {
    const { cancel, commit, coordinator, operation, undo } = createHarness();

    for (const reason of ["action", "timeout", "unknown", ""]) {
      await expect(operation.dismiss(reason)).resolves.toEqual({
        accepted: false,
        state: "pending",
      });
    }

    expect(coordinator.getActiveCount()).toBe(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    await operation.cancel();
  });

  test("an in-flight commit cannot be undone or cancelled", async () => {
    const pendingCommit = deferred();
    const commit = mock(() => pendingCommit.promise);
    const undo = mock(() => {});
    const cancel = mock(() => {});
    const coordinator = createDeletionSettlementCoordinator();
    const operation = coordinator.stage({ undo, commit, cancel });

    const committing = operation.dismiss("swipe");
    expect(operation.getState()).toBe("committing");
    expect(coordinator.getActiveCount()).toBe(0);
    await expect(operation.undo()).resolves.toEqual({ accepted: false, state: "committing" });
    await expect(operation.cancel()).resolves.toEqual({ accepted: false, state: "committing" });

    pendingCommit.resolve("deleted");
    await expect(committing).resolves.toEqual({
      accepted: true,
      state: "committed",
      value: "deleted",
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  test.each([
    "undo",
    "commit",
    "cancel",
  ])("contains and reports a synchronous %s adapter failure", async (settlement) => {
    const error = new Error(`${settlement} failed`);
    const onSettlementError = mock(() => {});
    const coordinator = createDeletionSettlementCoordinator({ onSettlementError });
    const operation = coordinator.stage({
      undo: () => {
        if (settlement === "undo") throw error;
      },
      commit: () => {
        if (settlement === "commit") throw error;
      },
      cancel: () => {
        if (settlement === "cancel") throw error;
      },
    });
    const result = await (settlement === "undo"
      ? operation.undo()
      : settlement === "commit"
        ? operation.expire()
        : operation.cancel());

    expect(result).toEqual({ accepted: true, state: "failed", error });
    expect(operation.getState()).toBe("failed");
    expect(coordinator.getActiveCount()).toBe(0);
    expect(onSettlementError).toHaveBeenCalledWith(error, {
      settlement,
      trigger:
        settlement === "undo" ? "action" : settlement === "commit" ? "timeout" : "programmatic",
    });
  });

  test("contains asynchronous adapter and reporter failures", async () => {
    const adapterError = new Error("database failed");
    const reporterError = new Error("reporter failed");
    const onSettlementError = mock(async () => {
      throw reporterError;
    });
    const coordinator = createDeletionSettlementCoordinator({ onSettlementError });
    const operation = coordinator.stage({
      undo: async () => {},
      commit: async () => {
        throw adapterError;
      },
    });

    await expect(operation.expire()).resolves.toEqual({
      accepted: true,
      state: "failed",
      error: adapterError,
    });
    expect(onSettlementError).toHaveBeenCalledTimes(1);
  });

  test("settles multiple operations independently", async () => {
    const coordinator = createDeletionSettlementCoordinator();
    const firstUndo = mock(() => {});
    const firstCommit = mock(() => {});
    const secondUndo = mock(() => {});
    const secondCommit = mock(() => {});
    const first = coordinator.stage({ undo: firstUndo, commit: firstCommit });
    const second = coordinator.stage({ undo: secondUndo, commit: secondCommit });

    await first.undo();
    expect(coordinator.getActiveCount()).toBe(1);
    await second.dismiss("user-dismiss");

    expect(firstUndo).toHaveBeenCalledTimes(1);
    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondUndo).not.toHaveBeenCalled();
    expect(secondCommit).toHaveBeenCalledTimes(1);
    expect(coordinator.getActiveCount()).toBe(0);
  });

  test("cancelAll cancels pending work synchronously and leaves the coordinator reusable", async () => {
    const coordinator = createDeletionSettlementCoordinator();
    const cancellations = [];
    coordinator.stage({ undo: () => {}, commit: () => {}, cancel: () => cancellations.push(1) });
    coordinator.stage({ undo: () => {}, commit: () => {}, cancel: () => cancellations.push(2) });

    const cancelling = coordinator.cancelAll();
    expect(cancellations).toEqual([1, 2]);
    expect(coordinator.getActiveCount()).toBe(0);
    await expect(cancelling).resolves.toEqual([
      { accepted: true, state: "cancelled", value: 1 },
      { accepted: true, state: "cancelled", value: 2 },
    ]);

    const nextCommit = mock(() => {});
    const next = coordinator.stage({ undo: () => {}, commit: nextCommit });
    await next.expire();
    expect(nextCommit).toHaveBeenCalledTimes(1);
  });

  test("destroy is terminal, cancels owned work, and makes all late operations inert", async () => {
    const { cancel, commit, coordinator, operation, undo } = createHarness();

    const destroying = coordinator.destroy();
    expect(coordinator.isDestroyed()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(coordinator.getActiveCount()).toBe(0);
    await expect(destroying).resolves.toBe(true);
    await expect(coordinator.destroy()).resolves.toBe(false);

    await expect(operation.undo()).resolves.toEqual({ accepted: false, state: "cancelled" });
    await expect(operation.expire()).resolves.toEqual({ accepted: false, state: "cancelled" });
    expect(undo).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    const lateUndo = mock(() => {});
    const lateCommit = mock(() => {});
    const lateCancel = mock(() => {});
    const late = coordinator.stage({ undo: lateUndo, commit: lateCommit, cancel: lateCancel });
    expect(late.getState()).toBe("cancelled");
    await late.dismiss("swipe");
    await late.cancel();
    expect(lateUndo).not.toHaveBeenCalled();
    expect(lateCommit).not.toHaveBeenCalled();
    expect(lateCancel).not.toHaveBeenCalled();
  });
});
