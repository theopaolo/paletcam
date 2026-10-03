import { extractPaletteColors } from "../modules/palette-extraction.js";
import { computeColorPresence, createSwatchOriginTracker } from "../modules/palette-origins.js";
import { applyWhiteBalanceLut } from "../modules/white-balance.js";

const WHITE_BALANCE_LUT_LENGTH = 768;

const originTracker = createSwatchOriginTracker();
const MAX_EXTRACTION_PIXELS = 4_194_304;
const MAX_SWATCH_COUNT = 16;
/** @type {OffscreenCanvasRenderingContext2D | null} */
let frameContext = null;

function isFrameBitmap(value) {
  return typeof ImageBitmap === "function" && value instanceof ImageBitmap;
}

// The live preview sends a camera frame already scaled to the analysis size;
// reading its pixels here keeps the GPU readback off the main thread.
function readFramePixels(bitmap, width, height, mirror) {
  frameContext ??= new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!frameContext) {
    throw new Error("OffscreenCanvas 2D is unavailable in the extraction worker.");
  }
  const { canvas } = frameContext;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  frameContext.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
  frameContext.drawImage(bitmap, 0, 0, width, height);
  return frameContext.getImageData(0, 0, width, height).data;
}

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
    (isFrameBitmap(payload.bitmap) ||
      (payload.buffer instanceof ArrayBuffer && payload.buffer.byteLength === pixelCount * 4)) &&
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
    const imageData = isFrameBitmap(payload.bitmap)
      ? readFramePixels(payload.bitmap, payload.width, payload.height, payload.mirror === true)
      : new Uint8ClampedArray(payload.buffer);
    // Palette, origins and pin presence all read the balanced frame.
    if (
      payload.whiteBalance instanceof Uint8Array &&
      payload.whiteBalance.length === WHITE_BALANCE_LUT_LENGTH
    ) {
      applyWhiteBalanceLut(imageData, payload.whiteBalance);
    }
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
  } finally {
    if (isFrameBitmap(payload.bitmap)) {
      payload.bitmap.close();
    }
  }
});
