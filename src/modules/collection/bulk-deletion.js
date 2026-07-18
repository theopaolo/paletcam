export const BULK_DELETION_CONCURRENCY = 2;

function normalizeDeleteResult(result) {
  if (result && typeof result === "object" && typeof result.success === "boolean") {
    return result;
  }
  return {
    success: false,
    error: new Error("Palette deletion returned an invalid result."),
  };
}

/**
 * Runs irreversible deletions with bounded storage/network fan-out. Results
 * retain input order even though at most two items may be active concurrently.
 * Cancellation is observed before each new item; already-running deletes finish.
 *
 * @param {object} options
 * @param {Array<{palette: Palette, removedIndex: number}>} options.deletions
 * @param {(deletion: {palette: Palette, removedIndex: number}) => Promise<Record<string, unknown>>} options.runDelete
 * @param {() => boolean} [options.isCancelled]
 * @param {number} [options.concurrency]
 */
export async function runBoundedBulkDeletion({
  deletions,
  runDelete,
  isCancelled = () => false,
  concurrency = BULK_DELETION_CONCURRENCY,
}) {
  const items = Array.isArray(deletions) ? deletions : [];
  const workerCount = Math.max(1, Math.min(4, Math.floor(Number(concurrency) || 1), items.length));
  const orderedResults = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (!isCancelled()) {
      const index = nextIndex;
      if (index >= items.length) {
        return;
      }
      nextIndex += 1;

      let result;
      try {
        result = normalizeDeleteResult(await runDelete(items[index]));
      } catch (error) {
        result = { success: false, error };
      }
      orderedResults[index] = result;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  const results = orderedResults.filter(Boolean);
  const failedResults = results.filter((result) => !result.success);

  return {
    cancelled: isCancelled(),
    cancelledCount: items.length - results.length,
    completedCount: results.length,
    failedResults,
    results,
    successCount: results.length - failedResults.length,
  };
}
