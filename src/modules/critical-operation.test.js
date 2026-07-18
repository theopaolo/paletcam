import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  beginCriticalOperation,
  isCriticalOperationActive,
  resetCriticalOperationsForTests,
  subscribeCriticalOperations,
  tryBeginCriticalOperation,
  tryBeginExclusiveCriticalOperation,
} from "./critical-operation.js";

afterEach(() => {
  resetCriticalOperationsForTests();
});

describe("critical operation coordinator", () => {
  test("remains busy until every nested operation releases", () => {
    const snapshots = [];
    subscribeCriticalOperations((snapshot) => snapshots.push(snapshot));

    const releaseCapture = beginCriticalOperation("capture-save");
    const releasePublish = beginCriticalOperation("community-publish");
    expect(isCriticalOperationActive()).toBe(true);

    releaseCapture();
    expect(isCriticalOperationActive()).toBe(true);
    releasePublish();
    expect(isCriticalOperationActive()).toBe(false);
    releasePublish();

    expect(snapshots.map(({ activeCount }) => activeCount)).toEqual([1, 2, 1, 0]);
  });

  test("unsubscription removes lifecycle ownership", () => {
    const listener = mock(() => {});
    const unsubscribe = subscribeCriticalOperations(listener);
    unsubscribe();

    const release = beginCriticalOperation("capture-save");
    release();
    expect(listener).not.toHaveBeenCalled();
  });

  test("exclusive work cannot start while shared work is active", () => {
    const releaseCapture = beginCriticalOperation("camera-capture");

    expect(tryBeginExclusiveCriticalOperation("local-data-flush")).toBeNull();
    expect(isCriticalOperationActive()).toBe(true);

    releaseCapture();
    const releaseFlush = tryBeginExclusiveCriticalOperation("local-data-flush");
    expect(releaseFlush).toBeFunction();
    releaseFlush();
    expect(isCriticalOperationActive()).toBe(false);
  });

  test("exclusive work blocks new shared operations until it releases", () => {
    const snapshots = [];
    subscribeCriticalOperations((snapshot) => snapshots.push(snapshot));
    const releaseFlush = tryBeginExclusiveCriticalOperation("local-data-flush");

    expect(releaseFlush).toBeFunction();
    expect(tryBeginCriticalOperation("camera-capture")).toBeNull();
    expect(() => beginCriticalOperation("community-publication")).toThrow(
      "destructive local-data operation",
    );

    releaseFlush();
    const releaseCapture = tryBeginCriticalOperation("camera-capture");
    expect(releaseCapture).toBeFunction();
    releaseCapture();
    expect(snapshots.map(({ activeCount, exclusive }) => [activeCount, exclusive])).toEqual([
      [1, true],
      [0, false],
      [1, false],
      [0, false],
    ]);
  });
});
