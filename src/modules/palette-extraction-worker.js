const MAX_EXTRACTION_PIXELS = 4_194_304;
const MAX_SWATCH_COUNT = 16;

function isRgbColor(value) {
  return (
    value &&
    typeof value === "object" &&
    [value.r, value.g, value.b].every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    ) &&
    (value.population === undefined || (Number.isFinite(value.population) && value.population >= 0))
  );
}

function isOrigin(value) {
  return (
    value === null ||
    (value &&
      typeof value === "object" &&
      Number.isFinite(value.x) &&
      value.x >= 0 &&
      value.x <= 1 &&
      Number.isFinite(value.y) &&
      value.y >= 0 &&
      value.y <= 1)
  );
}

function isFrozenPresence(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isInteger(value.slot) &&
    value.slot >= 0 &&
    value.slot < MAX_SWATCH_COUNT &&
    Number.isFinite(value.presence) &&
    value.presence >= 0 &&
    value.presence <= 1
  );
}

function normalizeExtractionResult(payload) {
  if (
    !Array.isArray(payload.colors) ||
    payload.colors.length > MAX_SWATCH_COUNT ||
    !payload.colors.every(isRgbColor) ||
    !Array.isArray(payload.origins) ||
    payload.origins.length !== payload.colors.length ||
    !payload.origins.every(isOrigin) ||
    !Array.isArray(payload.frozenPresence) ||
    payload.frozenPresence.length > MAX_SWATCH_COUNT ||
    !payload.frozenPresence.every(isFrozenPresence) ||
    !Number.isFinite(payload.durationMs) ||
    payload.durationMs < 0
  ) {
    return null;
  }

  return {
    colors: payload.colors,
    origins: payload.origins,
    frozenPresence: payload.frozenPresence,
    durationMs: payload.durationMs,
  };
}

/**
 * @param {{ onError?: (error: unknown) => void, onResult?: (result: { colors: RgbColor[], origins: unknown[], frozenPresence: Array<{slot: number, presence: number}>, durationMs: number }) => void }} [options]
 */
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
    if (!completedJob || payload.requestId !== completedJob.requestId) {
      return;
    }

    activeJob = null;

    if (
      payload.generation === completedJob.generation &&
      payload.generation === currentGeneration
    ) {
      const result = normalizeExtractionResult(payload);
      if (!result) {
        disableWorker(new Error("Invalid palette extraction worker response."));
        return;
      }
      onResult?.(result);
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

    const pixelCount = width * height;
    if (
      !(imageData instanceof Uint8ClampedArray) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      pixelCount > MAX_EXTRACTION_PIXELS ||
      imageData.length !== pixelCount * 4 ||
      !Number.isInteger(swatchCount) ||
      swatchCount < 1 ||
      swatchCount > MAX_SWATCH_COUNT
    ) {
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
    isEnabled = false;
    cleanupWorker();
  }

  return {
    destroy,
    invalidate,
    isEnabled: () => isEnabled,
    requestExtraction,
  };
}
