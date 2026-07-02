export function createPaletteExtractionWorkerController({ onError, onResult } = {}) {
  let worker = null;
  let isEnabled = typeof Worker === "function";
  let currentGeneration = 0;
  let nextRequestId = 0;
  let activeJob = null;
  let queuedJob = null;
  let hasReportedFailure = false;

  function reportFailure(error) {
    if (hasReportedFailure) {
      return;
    }

    hasReportedFailure = true;
    onError?.(error);
  }

  function cleanupWorker() {
    worker?.terminate();
    worker = null;
    activeJob = null;
    queuedJob = null;
  }

  function disableWorker(error) {
    isEnabled = false;
    cleanupWorker();
    reportFailure(error);
  }

  function flushQueuedJob() {
    if (!worker || !queuedJob) {
      return;
    }

    const nextJob = queuedJob;
    queuedJob = null;
    activeJob = nextJob;

    try {
      worker.postMessage(
        {
          type: "extract-palette",
          requestId: nextJob.requestId,
          generation: nextJob.generation,
          width: nextJob.width,
          height: nextJob.height,
          swatchCount: nextJob.swatchCount,
          options: nextJob.options,
          frozenColors: nextJob.frozenColors,
          buffer: nextJob.buffer,
        },
        [nextJob.buffer],
      );
    } catch (error) {
      disableWorker(error);
    }
  }

  function handleWorkerMessage(event) {
    const payload = event?.data;
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.type === "palette-extraction-error") {
      disableWorker(new Error(payload.message || "Palette extraction worker failed."));
      return;
    }

    if (payload.type !== "palette-extraction-result") {
      return;
    }

    const completedJob = activeJob;
    activeJob = null;

    if (
      completedJob &&
      payload.requestId === completedJob.requestId &&
      payload.generation === currentGeneration
    ) {
      onResult?.({
        colors: Array.isArray(payload.colors) ? payload.colors : [],
        origins: Array.isArray(payload.origins) ? payload.origins : [],
        frozenPresence: Array.isArray(payload.frozenPresence) ? payload.frozenPresence : [],
        durationMs: Number(payload.durationMs) || 0,
      });
    }

    flushQueuedJob();
  }

  function ensureWorker() {
    if (!isEnabled) {
      return null;
    }

    if (worker) {
      return worker;
    }

    try {
      worker = new Worker(new URL("../workers/palette-extraction.worker.js", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", handleWorkerMessage);
      worker.addEventListener("error", disableWorker);
    } catch (error) {
      disableWorker(error);
    }

    return worker;
  }

  function requestExtraction({ imageData, options, swatchCount, width, height, frozenColors }) {
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return false;
    }

    if (!(imageData instanceof Uint8ClampedArray) || width <= 0 || height <= 0) {
      return false;
    }

    const nextJob = {
      buffer: imageData.buffer,
      frozenColors: Array.isArray(frozenColors) ? frozenColors : [],
      generation: currentGeneration,
      height,
      options,
      requestId: ++nextRequestId,
      swatchCount,
      width,
    };

    if (activeJob) {
      queuedJob = nextJob;
      return true;
    }

    queuedJob = nextJob;
    flushQueuedJob();
    return true;
  }

  function invalidate() {
    currentGeneration += 1;
    queuedJob = null;
  }

  function destroy() {
    cleanupWorker();
  }

  return {
    destroy,
    invalidate,
    isEnabled: () => isEnabled,
    requestExtraction,
  };
}
