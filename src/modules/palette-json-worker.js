import { reportAppError } from "./error-reporting.js";

const PALETTE_JSON_WORKER_FAILURE_MESSAGE = "Palette JSON worker unavailable.";
const PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE = "Unexpected palette JSON worker response.";

function normalizeWorkerError(error, fallbackMessage = PALETTE_JSON_WORKER_FAILURE_MESSAGE) {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return new Error(error.message.trim());
  }

  return new Error(fallbackMessage);
}

export function createPaletteJsonWorkerController() {
  let worker = null;
  let isEnabled = typeof Worker === "function";
  let nextRequestId = 0;
  let hasReportedFailure = false;
  const pendingRequests = new Map();

  function reportFailure(error) {
    if (hasReportedFailure) {
      return;
    }

    hasReportedFailure = true;
    reportAppError(error, {
      consoleMessage: `${PALETTE_JSON_WORKER_FAILURE_MESSAGE}:`,
      includeClientLog: false,
    });
  }

  function cleanupWorker() {
    worker?.terminate();
    worker = null;
  }

  function rejectPendingRequests(error) {
    pendingRequests.forEach(({ reject }) => {
      reject(error);
    });
    pendingRequests.clear();
  }

  function disableWorker(error) {
    isEnabled = false;
    cleanupWorker();
    rejectPendingRequests(error);
    reportFailure(error);
  }

  function handleWorkerMessage(event) {
    const payload = event?.data;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const pendingRequest = pendingRequests.get(payload.requestId);
    if (!pendingRequest) {
      return;
    }

    if (payload.type === "palette-json-progress") {
      pendingRequest.onProgress?.({
        completed: payload.completed,
        phase: payload.phase,
        total: payload.total,
      });
      return;
    }

    pendingRequests.delete(payload.requestId);

    if (payload.type === "palette-json-error") {
      pendingRequest.reject(new Error(payload.message || "Palette JSON worker failed."));
      return;
    }

    if (payload.type !== pendingRequest.resultType) {
      pendingRequest.reject(new Error(PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE));
      return;
    }

    pendingRequest.resolve(payload);
  }

  function ensureWorker() {
    if (!isEnabled) {
      return null;
    }

    if (worker) {
      return worker;
    }

    try {
      worker = new Worker(new URL("../workers/palette-json-transfer.worker.js", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", handleWorkerMessage);
      worker.addEventListener("error", (event) => {
        disableWorker(
          normalizeWorkerError(
            event?.error ?? event,
            typeof event?.message === "string" ? event.message : undefined,
          ),
        );
      });
    } catch (error) {
      disableWorker(normalizeWorkerError(error));
    }

    return worker;
  }

  function request(type, payload, resultType, { onProgress } = {}) {
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const requestId = ++nextRequestId;

      pendingRequests.set(requestId, {
        onProgress,
        resolve,
        reject,
        resultType,
      });

      try {
        activeWorker.postMessage({
          type,
          requestId,
          ...payload,
        });
      } catch (error) {
        const normalizedError = normalizeWorkerError(error);
        pendingRequests.delete(requestId);
        disableWorker(normalizedError);
        reject(normalizedError);
      }
    });
  }

  return {
    exportPalettes(palettes, options) {
      return request("export-palettes", { palettes }, "palette-json-export-result", options);
    },
    exportPalettesBlob(palettes, options) {
      return request(
        "export-palettes-blob",
        { palettes },
        "palette-json-export-blob-result",
        options,
      );
    },
    importPalettes(jsonString) {
      return request("import-palettes", { jsonString }, "palette-json-import-result");
    },
    isEnabled() {
      return isEnabled;
    },
  };
}
