import { reportAppError } from "./error-reporting.js";
import { recordOperationalMetric } from "./operational-metrics.js";
import { PALETTE_IMPORT_MAX_COUNT } from "../palette-storage/json-transfer.js";

const PALETTE_JSON_WORKER_FAILURE_MESSAGE = "Palette JSON worker unavailable.";
const PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE = "Unexpected palette JSON worker response.";
const PALETTE_JSON_WORKER_DESTROYED_MESSAGE = "Palette JSON worker controller destroyed.";

function isValidProgressPayload(payload) {
  if (payload.phase === "parsing") {
    return (
      Number.isInteger(payload.completed) &&
      Number.isInteger(payload.loadedBytes) &&
      Number.isInteger(payload.totalBytes) &&
      payload.completed >= 0 &&
      payload.loadedBytes >= 0 &&
      payload.totalBytes >= 0 &&
      payload.loadedBytes <= payload.totalBytes
    );
  }
  return (
    payload.phase === "serializing" &&
    Number.isInteger(payload.completed) &&
    Number.isInteger(payload.total) &&
    payload.completed >= 0 &&
    payload.total >= 0 &&
    payload.completed <= payload.total
  );
}

function isValidResultPayload(payload, resultType) {
  if (resultType === "palette-json-export-result") {
    return typeof payload.json === "string";
  }
  if (resultType === "palette-json-export-blob-result") {
    return payload.blob instanceof Blob && payload.blob.type.startsWith("application/json");
  }
  if (resultType === "palette-json-import-result") {
    return (
      Array.isArray(payload.palettes) ||
      (Number.isInteger(payload.completed) && payload.completed >= 0)
    );
  }
  return false;
}

/** @typedef {(progress: Record<string, number | string>) => void} ProgressCallback */
/** @typedef {(palettes: object[], progress: Record<string, number | string>) => void | Promise<void>} ImportBatchCallback */
/** @typedef {{maxJsonBytes?: number, onProgress?: ProgressCallback}} WorkerExportOptions */
/** @typedef {{collect?: boolean, onBatch?: ImportBatchCallback, onProgress?: ProgressCallback}} WorkerImportOptions */
/**
 * @typedef {object} PendingWorkerRequest
 * @property {ProgressCallback | undefined} onProgress
 * @property {(value: any) => void} resolve
 * @property {(reason?: any) => void} reject
 * @property {string} resultType
 * @property {boolean} collectImport
 * @property {number} importedCount
 * @property {object[]} importedPalettes
 * @property {number} lastBatchId
 * @property {ImportBatchCallback | undefined} onBatch
 */

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
  /** @type {Map<number, PendingWorkerRequest>} */
  const pendingRequests = new Map();

  function reportFailure(error) {
    if (hasReportedFailure) {
      return;
    }

    hasReportedFailure = true;
    recordOperationalMetric("worker-fallback", {
      worker: "palette-json",
      errorName: error?.name ?? "Error",
    });
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

  function destroy(reason) {
    if (!isEnabled && !worker && pendingRequests.size === 0) {
      return;
    }

    isEnabled = false;
    cleanupWorker();
    rejectPendingRequests(normalizeWorkerError(reason, PALETTE_JSON_WORKER_DESTROYED_MESSAGE));
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

    if (payload.type === "palette-json-import-batch") {
      const progress = payload.progress;
      if (
        pendingRequest.resultType !== "palette-json-import-result" ||
        !Number.isInteger(payload.batchId) ||
        payload.batchId !== pendingRequest.lastBatchId + 1 ||
        !Array.isArray(payload.palettes) ||
        payload.palettes.length === 0 ||
        !progress ||
        typeof progress !== "object" ||
        !isValidProgressPayload(progress) ||
        pendingRequest.importedCount + payload.palettes.length > PALETTE_IMPORT_MAX_COUNT ||
        progress.completed !== pendingRequest.importedCount + payload.palettes.length
      ) {
        pendingRequests.delete(payload.requestId);
        const error = new Error(PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE);
        pendingRequest.reject(error);
        worker?.postMessage({
          type: "palette-json-import-batch-ack",
          requestId: payload.requestId,
          batchId: payload.batchId,
          accepted: false,
          message: error.message,
        });
        return;
      }

      pendingRequest.lastBatchId = payload.batchId;
      pendingRequest.importedCount += payload.palettes.length;
      if (pendingRequest.collectImport) {
        pendingRequest.importedPalettes.push(...payload.palettes);
      }

      Promise.resolve()
        .then(() => pendingRequest.onBatch?.(payload.palettes, progress))
        .then(
          () => {
            if (!pendingRequests.has(payload.requestId)) {
              return;
            }
            worker?.postMessage({
              type: "palette-json-import-batch-ack",
              requestId: payload.requestId,
              batchId: payload.batchId,
              accepted: true,
            });
          },
          (error) => {
            const normalizedError = normalizeWorkerError(error);
            pendingRequests.delete(payload.requestId);
            pendingRequest.reject(normalizedError);
            worker?.postMessage({
              type: "palette-json-import-batch-ack",
              requestId: payload.requestId,
              batchId: payload.batchId,
              accepted: false,
              message: normalizedError.message,
            });
          },
        );
      return;
    }

    if (payload.type === "palette-json-progress") {
      if (!isValidProgressPayload(payload)) {
        pendingRequests.delete(payload.requestId);
        pendingRequest.reject(new Error(PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE));
        return;
      }
      pendingRequest.onProgress?.(
        payload.phase === "parsing"
          ? {
              completed: payload.completed,
              loadedBytes: payload.loadedBytes,
              phase: payload.phase,
              totalBytes: payload.totalBytes,
            }
          : {
              completed: payload.completed,
              phase: payload.phase,
              total: payload.total,
            },
      );
      return;
    }

    pendingRequests.delete(payload.requestId);

    if (payload.type === "palette-json-error") {
      const workerError = new Error(payload.message || "Palette JSON worker failed.");
      if (typeof payload.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code)) {
        Object.assign(workerError, { code: payload.code });
      }
      pendingRequest.reject(workerError);
      return;
    }

    if (
      payload.type !== pendingRequest.resultType ||
      !isValidResultPayload(payload, pendingRequest.resultType)
    ) {
      pendingRequest.reject(new Error(PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE));
      return;
    }

    if (pendingRequest.resultType === "palette-json-import-result") {
      if (Array.isArray(payload.palettes)) {
        if (!pendingRequest.collectImport) {
          payload.palettes = [];
        }
      } else {
        if (payload.completed !== pendingRequest.importedCount) {
          pendingRequest.reject(new Error(PALETTE_JSON_WORKER_UNEXPECTED_RESPONSE_MESSAGE));
          return;
        }
        payload.palettes = pendingRequest.collectImport ? pendingRequest.importedPalettes : [];
      }
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

  /**
   * @param {string} type
   * @param {Record<string, unknown>} payload
   * @param {string} resultType
   * @param {{collectImport?: boolean, onBatch?: ImportBatchCallback, onProgress?: ProgressCallback}} [options]
   */
  function request(type, payload, resultType, { collectImport = true, onBatch, onProgress } = {}) {
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const requestId = ++nextRequestId;

      pendingRequests.set(requestId, {
        collectImport,
        importedCount: 0,
        importedPalettes: [],
        lastBatchId: 0,
        onBatch,
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
    destroy,
    /** @param {unknown[]} palettes @param {WorkerExportOptions} [options] */
    exportPalettes(palettes, options = {}) {
      const { maxJsonBytes, onProgress } = options;
      return request("export-palettes", { maxJsonBytes, palettes }, "palette-json-export-result", {
        onProgress,
      });
    },
    /** @param {unknown[]} palettes @param {WorkerExportOptions} [options] */
    exportPalettesBlob(palettes, options = {}) {
      const { maxJsonBytes, onProgress } = options;
      return request(
        "export-palettes-blob",
        { maxJsonBytes, palettes },
        "palette-json-export-blob-result",
        { onProgress },
      );
    },
    /** @param {string | Blob} importSource @param {WorkerImportOptions} [options] */
    importPalettes(importSource, options = {}) {
      const { collect = true, onBatch, onProgress } = options;
      return request("import-palettes", { importSource }, "palette-json-import-result", {
        collectImport: collect,
        onBatch,
        onProgress,
      });
    },
    isEnabled() {
      return isEnabled;
    },
  };
}
