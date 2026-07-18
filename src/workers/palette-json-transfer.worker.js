import {
  PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
  deserializePalettesFromImport,
  deserializePalettesFromImportBlob,
  serializePalettesForExportBlob,
  serializePalettesForExport,
} from "../palette-storage/json-transfer.js";

const pendingImportBatchAcknowledgements = new Map();

/**
 * @param {number} requestId
 * @param {{completed: number, phase: string, total: number}} progress
 */
function postExportProgress(requestId, progress) {
  globalThis.postMessage({
    type: "palette-json-progress",
    requestId,
    ...progress,
  });
}

function getImportBatchKey(requestId, batchId) {
  return `${requestId}:${batchId}`;
}

function postImportProgress(requestId, progress) {
  globalThis.postMessage({
    type: "palette-json-progress",
    requestId,
    ...progress,
  });
}

function postImportBatchAndWaitForAcknowledgement(requestId, batchId, palettes, progress) {
  const key = getImportBatchKey(requestId, batchId);

  return new Promise((resolve, reject) => {
    pendingImportBatchAcknowledgements.set(key, { reject, resolve });
    globalThis.postMessage({
      type: "palette-json-import-batch",
      requestId,
      batchId,
      palettes,
      progress,
    });
  });
}

globalThis.addEventListener("message", async (event) => {
  const payload = event?.data;
  if (
    !payload ||
    typeof payload !== "object" ||
    !Number.isInteger(payload.requestId) ||
    payload.requestId < 1
  ) {
    return;
  }

  if (payload.type === "palette-json-import-batch-ack") {
    const key = getImportBatchKey(payload.requestId, payload.batchId);
    const acknowledgement = pendingImportBatchAcknowledgements.get(key);
    if (!acknowledgement) {
      return;
    }
    pendingImportBatchAcknowledgements.delete(key);
    if (payload.accepted === true) {
      acknowledgement.resolve();
    } else {
      acknowledgement.reject(new Error(payload.message || "Palette import batch rejected."));
    }
    return;
  }

  try {
    if (payload.type === "export-palettes") {
      if (!Array.isArray(payload.palettes)) {
        throw new Error("Invalid palette export worker request.");
      }
      const json = await serializePalettesForExport(payload.palettes, {
        maxJsonBytes: payload.maxJsonBytes,
        onProgress: (progress) => postExportProgress(payload.requestId, progress),
      });

      globalThis.postMessage({
        type: "palette-json-export-result",
        requestId: payload.requestId,
        json,
      });
      return;
    }

    if (payload.type === "export-palettes-blob") {
      if (!Array.isArray(payload.palettes)) {
        throw new Error("Invalid palette export worker request.");
      }
      const blob = await serializePalettesForExportBlob(payload.palettes, {
        maxJsonBytes: payload.maxJsonBytes,
        onProgress: (progress) => postExportProgress(payload.requestId, progress),
      });

      globalThis.postMessage({
        type: "palette-json-export-blob-result",
        requestId: payload.requestId,
        blob,
      });
      return;
    }

    if (payload.type === "import-palettes") {
      const importSource = payload.importSource;
      if (
        typeof importSource !== "string" &&
        (!(importSource instanceof Blob) ||
          importSource.size > PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES)
      ) {
        throw new Error("Invalid palette import worker request.");
      }

      if (importSource instanceof Blob) {
        let batchId = 0;
        let completed = 0;
        postImportProgress(payload.requestId, {
          completed,
          loadedBytes: 0,
          phase: "parsing",
          totalBytes: importSource.size,
        });
        await deserializePalettesFromImportBlob(importSource, {
          collect: false,
          onBatch: async (palettes, progress) => {
            completed += palettes.length;
            await postImportBatchAndWaitForAcknowledgement(
              payload.requestId,
              ++batchId,
              palettes,
              progress,
            );
          },
          onProgress: (progress) => postImportProgress(payload.requestId, progress),
        });

        globalThis.postMessage({
          type: "palette-json-import-result",
          requestId: payload.requestId,
          completed,
        });
        return;
      }

      const palettes = await deserializePalettesFromImport(importSource);

      globalThis.postMessage({
        type: "palette-json-import-result",
        requestId: payload.requestId,
        palettes,
      });
    }
  } catch (error) {
    globalThis.postMessage({
      type: "palette-json-error",
      requestId: payload.requestId,
      code: typeof error?.code === "string" ? error.code : undefined,
      message: error?.message || "Palette JSON worker failed.",
    });
  }
});
