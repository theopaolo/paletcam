import { extractPaletteColors } from "../modules/palette-extraction.js";
import { computeColorPresence, createSwatchOriginTracker } from "../modules/palette-origins.js";

const originTracker = createSwatchOriginTracker();

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
