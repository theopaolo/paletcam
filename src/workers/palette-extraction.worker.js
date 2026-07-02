import { extractPaletteColors } from "../modules/palette-extraction.js";
import { createSwatchOriginTracker } from "../modules/palette-origins.js";

const originTracker = createSwatchOriginTracker();

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

    globalThis.postMessage({
      type: "palette-extraction-result",
      requestId: payload.requestId,
      generation: payload.generation,
      colors: result.colors,
      origins,
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
