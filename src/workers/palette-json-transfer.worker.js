import {
  deserializePalettesFromImport,
  serializePalettesForExport,
} from "../palette-storage/json-transfer.js";

globalThis.addEventListener("message", async (event) => {
  const payload = event?.data;
  if (!payload || typeof payload !== "object") {
    return;
  }

  try {
    if (payload.type === "export-palettes") {
      const json = await serializePalettesForExport(payload.palettes);

      globalThis.postMessage({
        type: "palette-json-export-result",
        requestId: payload.requestId,
        json,
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
