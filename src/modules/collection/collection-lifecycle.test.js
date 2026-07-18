import { describe, expect, mock, test } from "bun:test";
import { createCollectionLifecycle } from "./collection-lifecycle.js";

describe("collection lifecycle", () => {
  test("aborts event bindings and runs every registered cleanup exactly once", () => {
    const firstCleanup = mock(() => {});
    const secondCleanup = mock(() => {});
    const lifecycle = createCollectionLifecycle();

    lifecycle.registerCleanup(firstCleanup);
    lifecycle.registerCleanup(secondCleanup);

    expect(lifecycle.signal.aborted).toBe(false);
    expect(lifecycle.destroy()).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.destroy()).toBe(false);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
  });

  test("contains cleanup failures and still releases later resources", () => {
    const failure = new Error("cleanup failed");
    const onCleanupError = mock(() => {});
    const finalCleanup = mock(() => {});
    const lifecycle = createCollectionLifecycle({ onCleanupError });

    lifecycle.registerCleanup(() => {
      throw failure;
    });
    lifecycle.registerCleanup(finalCleanup);

    expect(lifecycle.destroy()).toBe(true);
    expect(onCleanupError).toHaveBeenCalledWith(failure);
    expect(finalCleanup).toHaveBeenCalledTimes(1);
  });

  test("supports unregistering and immediately cleans resources registered after destroy", () => {
    const removedCleanup = mock(() => {});
    const lateCleanup = mock(() => {});
    const lifecycle = createCollectionLifecycle();

    const unregister = lifecycle.registerCleanup(removedCleanup);
    unregister();
    lifecycle.destroy();
    lifecycle.registerCleanup(lateCleanup);

    expect(removedCleanup).not.toHaveBeenCalled();
    expect(lateCleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.isDestroyed()).toBe(true);
  });
});
