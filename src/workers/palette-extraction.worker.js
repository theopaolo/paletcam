import { extractPaletteColors } from "../modules/palette-extraction.js";
import { computeColorPresence, createSwatchOriginTracker } from "../modules/palette-origins.js";

const originTracker = createSwatchOriginTracker();
const MAX_EXTRACTION_PIXELS = 4_194_304;
const MAX_SWATCH_COUNT = 16;

function isValidExtractionRequest(payload) {
  const pixelCount = payload.width * payload.height;
  return (
    Number.isInteger(payload.requestId) &&
    payload.requestId > 0 &&
    Number.isInteger(payload.generation) &&
    payload.generation >= 0 &&
    Number.isInteger(payload.width) &&
    payload.width > 0 &&
    Number.isInteger(payload.height) &&
    payload.height > 0 &&
    pixelCount <= MAX_EXTRACTION_PIXELS &&
    Number.isInteger(payload.swatchCount) &&
    payload.swatchCount >= 1 &&
    payload.swatchCount <= MAX_SWATCH_COUNT &&
    payload.buffer instanceof ArrayBuffer &&
    payload.buffer.byteLength === pixelCount * 4 &&
    (payload.frozenColors === undefined || Array.isArray(payload.frozenColors))
  );
}

function computeFrozenPresence(imageData, width, height, frozenColors) {
  if (!Array.isArray(frozenColors) || frozenColors.length === 0) {
    return [];
  }

  const presence = computeColorPresence(
    imageData,
    width,
    height,
    frozenColors.map((entry) => entry.color),
  );

  return frozenColors.map((entry, index) => ({
    slot: entry.slot,
    presence: presence[index] ?? 0,
  }));
}

globalThis.addEventListener("message", (event) => {
  const payload = event?.data;
  if (!payload || payload.type !== "extract-palette") {
    return;
  }

  try {
    if (!isValidExtractionRequest(payload)) {
      throw new Error("Invalid palette extraction worker request.");
    }
    const startedAt = performance.now();
    const imageData = new Uint8ClampedArray(payload.buffer);
    const result = extractPaletteColors(
      imageData,
      payload.width,
      payload.height,
      payload.swatchCount,
      payload.options,
    );

    const origins = originTracker.compute(imageData, payload.width, payload.height, result.colors);
    const frozenPresence = computeFrozenPresence(
      imageData,
      payload.width,
      payload.height,
      payload.frozenColors,
    );

    globalThis.postMessage({
      type: "palette-extraction-result",
      requestId: payload.requestId,
      generation: payload.generation,
      colors: result.colors,
      origins,
      frozenPresence,
      durationMs: performance.now() - startedAt,
    });
  } catch (error) {
    globalThis.postMessage({
      type: "palette-extraction-error",
      requestId: payload.requestId,
      generation: payload.generation,
      message: error?.message || "Palette extraction worker failed.",
    });
  }
});
