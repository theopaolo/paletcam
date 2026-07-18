import { describe, expect, mock, test } from "bun:test";
import { BULK_DELETION_CONCURRENCY, runBoundedBulkDeletion } from "./bulk-deletion.js";

const deletions = Array.from({ length: 8 }, (_, index) => ({
  palette: { id: index + 1 },
  removedIndex: index,
}));

describe("bounded bulk deletion", () => {
  test("never exceeds the owned concurrency cap and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;
    const releases = [];
    const runDelete = mock(async ({ palette }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return { success: true, paletteId: palette.id };
    });

    const pending = runBoundedBulkDeletion({ deletions, runDelete });
    await Promise.resolve();
    expect(runDelete).toHaveBeenCalledTimes(BULK_DELETION_CONCURRENCY);

    while (releases.length > 0 || runDelete.mock.calls.length < deletions.length) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    releases.splice(0).forEach((release) => {
      release();
    });

    const result = await pending;
    expect(maxActive).toBe(BULK_DELETION_CONCURRENCY);
    expect(result.results.map((entry) => entry.paletteId)).toEqual(
      deletions.map(({ palette }) => palette.id),
    );
    expect(result).toMatchObject({
      cancelled: false,
      cancelledCount: 0,
      completedCount: 8,
      successCount: 8,
    });
  });

  test("observes cancellation before scheduling more work", async () => {
    let cancelled = false;
    const runDelete = mock(async ({ palette }) => {
      cancelled = true;
      return { success: true, paletteId: palette.id };
    });

    const result = await runBoundedBulkDeletion({
      deletions,
      runDelete,
      isCancelled: () => cancelled,
    });

    expect(runDelete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      cancelled: true,
      cancelledCount: 7,
      completedCount: 1,
      successCount: 1,
    });
  });

  test("contains rejected and malformed adapter results as aggregate failures", async () => {
    const error = new Error("quota");
    const runDelete = mock(async ({ palette }) => {
      if (palette.id === 1) throw error;
      if (palette.id === 2) return null;
      return { success: true };
    });

    const result = await runBoundedBulkDeletion({ deletions: deletions.slice(0, 3), runDelete });

    expect(result.successCount).toBe(1);
    expect(result.failedResults).toHaveLength(2);
    expect(result.failedResults[0].error).toBe(error);
    expect(result.failedResults[1].error.message).toBe(
      "Palette deletion returned an invalid result.",
    );
  });
});
