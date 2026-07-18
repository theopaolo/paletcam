import { describe, expect, test } from "bun:test";
import { createBoundedWriteQueue, WriteQueueConfigurationError } from "./bounded-write-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("bounded log write queue", () => {
  test.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an unsafe maxPending value: %s", (maxPending) => {
    expect(() => createBoundedWriteQueue({ maxPending })).toThrow(WriteQueueConfigurationError);
  });

  test("serializes accepted writes and rejects admission at capacity", async () => {
    const firstWrite = deferred();
    const order = [];
    const queue = createBoundedWriteQueue({ maxPending: 2 });

    const first = queue.tryEnqueue(async () => {
      order.push("first-start");
      await firstWrite.promise;
      order.push("first-end");
      return "first";
    });
    const second = queue.tryEnqueue(() => {
      order.push("second");
      return "second";
    });

    expect(queue.getPendingCount()).toBe(2);
    expect(queue.getMaxPending()).toBe(2);
    expect(queue.isSaturated()).toBe(true);
    expect(queue.tryEnqueue(() => "third")).toBeNull();
    expect(order).toEqual([]);

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    firstWrite.resolve();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(queue.getPendingCount()).toBe(0);
    expect(queue.isSaturated()).toBe(false);
  });

  test("releases capacity in finally after failure and keeps the queue usable", async () => {
    const queue = createBoundedWriteQueue({ maxPending: 1 });
    const failure = queue.tryEnqueue(() => {
      throw new Error("disk unavailable");
    });

    expect(queue.tryEnqueue(() => "too early")).toBeNull();
    await expect(failure).rejects.toThrow("disk unavailable");
    expect(queue.getPendingCount()).toBe(0);

    await expect(queue.tryEnqueue(() => "recovered")).resolves.toBe("recovered");
    expect(queue.getPendingCount()).toBe(0);
  });
});
