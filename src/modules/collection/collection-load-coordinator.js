/**
 * Coordinates latest-wins collection loading without importing storage, DOM,
 * telemetry, or a global clock. Presentation and persistence remain adapters.
 *
 * @param {object} options
 * @param {() => Promise<Palette[]>} options.loadPalettes
 * @param {(palettes: Palette[]) => Palette[]} options.selectPalettes
 * @param {(palettes: Palette[]) => boolean | void} options.applyPalettes
 * @param {(error: unknown) => void} options.handleFailure
 * @param {(eventName: string, fields: Record<string, unknown>) => unknown} options.recordMetric
 * @param {() => number} options.now
 */
export function createCollectionLoadCoordinator({
  loadPalettes,
  selectPalettes,
  applyPalettes,
  handleFailure,
  recordMetric,
  now,
}) {
  let revision = 0;
  let destroyed = false;

  /** @param {number} candidateRevision */
  function isCurrent(candidateRevision) {
    return !destroyed && candidateRevision === revision;
  }

  /** @param {string} eventName @param {Record<string, unknown>} fields */
  function recordMetricSafely(eventName, fields) {
    try {
      recordMetric(eventName, fields);
    } catch {
      // Telemetry is best-effort and must not change collection behavior.
    }
  }

  function invalidate() {
    if (destroyed) return false;
    revision += 1;
    return true;
  }

  function captureGuard() {
    const capturedRevision = revision;
    return () => isCurrent(capturedRevision);
  }

  async function load() {
    if (destroyed) return "destroyed";

    const loadRevision = ++revision;
    const startTime = now();
    try {
      const fetchStartTime = now();
      const fetchedPalettes = await loadPalettes();
      if (!isCurrent(loadRevision)) return destroyed ? "destroyed" : "stale";
      const fetchMs = now() - fetchStartTime;

      const filterStartTime = now();
      const palettes = selectPalettes(fetchedPalettes);
      const filterMs = now() - filterStartTime;
      if (!isCurrent(loadRevision)) return destroyed ? "destroyed" : "stale";

      const renderStartTime = now();
      const applied = applyPalettes(palettes);
      const renderMs = now() - renderStartTime;
      if (applied === false || !isCurrent(loadRevision)) {
        return destroyed ? "destroyed" : "stale";
      }

      recordMetricSafely("loadCollectionUi:success", {
        totalMs: Math.round(now() - startTime),
        fetchMs: Math.round(fetchMs),
        filterMs: Math.round(filterMs),
        renderMs: Math.round(renderMs),
        fetchedCount: fetchedPalettes.length,
        displayedCount: palettes.length,
      });
      return "applied";
    } catch (error) {
      if (!isCurrent(loadRevision)) return destroyed ? "destroyed" : "stale";

      const errorName =
        error && typeof error === "object" && "name" in error && typeof error.name === "string"
          ? error.name
          : "";
      recordMetricSafely("loadCollectionUi:error", {
        totalMs: Math.round(now() - startTime),
        errorName,
      });
      handleFailure(error);
      return "failed";
    }
  }

  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    revision += 1;
    return true;
  }

  return {
    captureGuard,
    destroy,
    invalidate,
    isDestroyed: () => destroyed,
    load,
  };
}
