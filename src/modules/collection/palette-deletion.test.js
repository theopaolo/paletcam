import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  isCriticalOperationActive,
  resetCriticalOperationsForTests,
} from "../critical-operation.js";
import { createPaletteDeletionUseCase } from "./palette-deletion.js";

function createHarness(overrides = {}) {
  const adapters = {
    commitLocalPaletteDeletion: mock(async () => ({
      remoteCatchId: "",
      remoteCleanupQueued: false,
    })),
    disposePreviewAsset: mock(() => {}),
    flushRemoteCleanup: mock(async () => ({
      dequeuedCount: 0,
      processedCount: 0,
      remainingCount: 0,
    })),
    notifyDeleted: mock(() => {}),
    ...overrides,
  };
  return { adapters, run: createPaletteDeletionUseCase(adapters) };
}

const palette = { id: 7, remoteCatchId: "remote-7" };

afterEach(() => {
  resetCriticalOperationsForTests();
});

describe("palette deletion use case", () => {
  test("commits local-only deletion without invoking the outbox", async () => {
    const { adapters, run } = createHarness();

    await expect(run(palette)).resolves.toMatchObject({
      remoteCleanupQueued: false,
      success: true,
    });
    expect(adapters.commitLocalPaletteDeletion).toHaveBeenCalledWith(7);
    expect(adapters.flushRemoteCleanup).not.toHaveBeenCalled();
    expect(adapters.disposePreviewAsset).toHaveBeenCalledWith(palette);
    expect(adapters.notifyDeleted).toHaveBeenCalledWith(7);
    expect(isCriticalOperationActive()).toBe(false);
  });

  test("force-flushes a durable remote cleanup intent after commit", async () => {
    const calls = [];
    const { adapters, run } = createHarness({
      commitLocalPaletteDeletion: mock(async () => {
        calls.push("commit");
        return { remoteCatchId: "remote-7", remoteCleanupQueued: true };
      }),
      flushRemoteCleanup: mock(async () => {
        calls.push("flush");
        return { dequeuedCount: 1, processedCount: 1, remainingCount: 0 };
      }),
    });

    await expect(run(palette)).resolves.toMatchObject({
      remoteCatchId: "remote-7",
      remoteCleanupQueued: true,
      remoteFlushResult: { dequeuedCount: 1 },
      success: true,
    });
    expect(calls).toEqual(["commit", "flush"]);
    expect(adapters.flushRemoteCleanup).toHaveBeenCalledWith({ force: true });
  });

  test("keeps a failed atomic commit terminal and does not publish UI deletion", async () => {
    const error = new Error("queue unavailable");
    const { adapters, run } = createHarness({
      commitLocalPaletteDeletion: mock(async () => {
        throw error;
      }),
    });

    expect(await run(palette)).toEqual({ success: false, error });
    expect(adapters.disposePreviewAsset).not.toHaveBeenCalled();
    expect(adapters.notifyDeleted).not.toHaveBeenCalled();
    expect(adapters.flushRemoteCleanup).not.toHaveBeenCalled();
    expect(isCriticalOperationActive()).toBe(false);
  });

  test("contains a flush failure because the cleanup intent is already durable", async () => {
    const flushError = new DOMException("storage blocked", "SecurityError");
    const { adapters, run } = createHarness({
      commitLocalPaletteDeletion: mock(async () => ({
        remoteCatchId: "remote-7",
        remoteCleanupQueued: true,
      })),
      flushRemoteCleanup: mock(async () => {
        throw flushError;
      }),
    });

    await expect(run(palette)).resolves.toMatchObject({
      remoteCleanupQueued: true,
      remoteFlushError: flushError,
      success: true,
    });
    expect(adapters.disposePreviewAsset).toHaveBeenCalledTimes(1);
    expect(adapters.notifyDeleted).toHaveBeenCalledTimes(1);
  });

  test("keeps critical-operation ownership until the awaited flush settles", async () => {
    let resolveFlush;
    const { run } = createHarness({
      commitLocalPaletteDeletion: mock(async () => ({
        remoteCatchId: "remote-7",
        remoteCleanupQueued: true,
      })),
      flushRemoteCleanup: mock(
        () =>
          new Promise((resolve) => {
            resolveFlush = resolve;
          }),
      ),
    });

    const pending = run(palette);
    await Promise.resolve();
    await Promise.resolve();
    expect(isCriticalOperationActive()).toBe(true);
    resolveFlush({ dequeuedCount: 1 });
    await pending;
    expect(isCriticalOperationActive()).toBe(false);
  });
});
