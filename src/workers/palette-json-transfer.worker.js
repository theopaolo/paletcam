import {
  deserializePalettesFromImport,
  serializePalettesForExportBlob,
  serializePalettesForExport,
} from "../palette-storage/json-transfer.js";

function postExportProgress(requestId, progress) {
  globalThis.postMessage({
    type: "palette-json-progress",
    requestId,
    ...progress,
  });
}

globalThis.addEventListener("message", async (event) => {
  const payload = event?.data;
  if (!payload || typeof payload !== "object") {
    return;
  }

  try {
    if (payload.type === "export-palettes") {
      const json = await serializePalettesForExport(payload.palettes, {
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
      const blob = await serializePalettesForExportBlob(payload.palettes, {
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
      const palettes = await deserializePalettesFromImport(payload.jsonString);

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
      message: error?.message || "Palette JSON worker failed.",
    });
  }
});
