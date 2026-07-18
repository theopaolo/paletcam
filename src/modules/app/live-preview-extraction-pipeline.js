/** @typedef {RgbColor & {population?: number}} ExtractedColor */
/** @typedef {{x: number, y: number} | null} SwatchOrigin */
/** @typedef {{slot: number, color: RgbColor}} FrozenEntry */
/** @typedef {{slot: number, presence: number}} FrozenPresence */
/**
 * @typedef {{
 *   colors: ExtractedColor[],
 *   origins: SwatchOrigin[],
 *   frozenPresence: FrozenPresence[],
 * }} ExtractionResult
 */

/**
 * Coordinates live palette extraction without owning frame acquisition,
 * cadence, frozen-pin policy, or rendering. Worker and synchronous fallback
 * results leave this boundary with the same shape.
 *
 * @param {{
 *   worker: {
 *     requestExtraction(request: {
 *       imageData: Uint8ClampedArray,
 *       width: number,
 *       height: number,
 *       swatchCount: number,
 *       options: object,
 *       frozenColors: FrozenEntry[],
 *     }): boolean,
 *     invalidate(): void,
 *   },
 *   extractPalette(
 *     imageData: Uint8ClampedArray,
 *     width: number,
 *     height: number,
 *     swatchCount: number,
 *     options: object,
 *   ): {colors: ExtractedColor[]},
 *   originTracker: {
 *     compute(
 *       imageData: Uint8ClampedArray,
 *       width: number,
 *       height: number,
 *       colors: ExtractedColor[],
 *     ): SwatchOrigin[],
 *     reset(): void,
 *   },
 *   computePresence(
 *     imageData: Uint8ClampedArray,
 *     width: number,
 *     height: number,
 *     colors: RgbColor[],
 *   ): number[],
 * }} dependencies
 */
export function createLivePreviewExtractionPipeline({
  worker,
  extractPalette,
  originTracker,
  computePresence,
}) {
  /** @type {ExtractedColor[] | null} */
  let lastExtractedColors = null;
  /** @type {SwatchOrigin[]} */
  let lastExtractedOrigins = [];
  /** @type {number | null} */
  let latestWorkerDurationMs = null;

  /** @param {object} medianCutSettings @param {object} hybridSettings */
  function buildOptions(medianCutSettings, hybridSettings) {
    return {
      medianCut: { ...medianCutSettings },
      hybrid: {
        ...hybridSettings,
        // Keep the raw quantizer output as the perceptual selector's stability
        // bias. Smoothed display colors must never feed back into extraction.
        previousColors: lastExtractedColors ?? [],
      },
    };
  }

  /** @param {ExtractionResult} result @returns {ExtractionResult} */
  function commitResult({ colors, origins, frozenPresence }) {
    lastExtractedColors = colors;
    lastExtractedOrigins = Array.isArray(origins) ? origins : [];

    return {
      colors: lastExtractedColors,
      origins: lastExtractedOrigins,
      frozenPresence,
    };
  }

  /**
   * @param {{
   *   imageData: Uint8ClampedArray,
   *   width: number,
   *   height: number,
   *   swatchCount: number,
   *   medianCutSettings: object,
   *   hybridSettings: object,
   *   frozenEntries: FrozenEntry[],
   * }} request
   * @returns {{delegated: true, result: null} | {delegated: false, result: ExtractionResult}}
   */
  function request({
    imageData,
    width,
    height,
    swatchCount,
    medianCutSettings,
    hybridSettings,
    frozenEntries,
  }) {
    const frozenColors = Array.isArray(frozenEntries) ? frozenEntries : [];
    const options = buildOptions(medianCutSettings, hybridSettings);
    const delegatedToWorker = worker.requestExtraction({
      imageData,
      width,
      height,
      swatchCount,
      options,
      frozenColors,
    });

    // The worker may already have transferred imageData.buffer. Never inspect
    // or reuse it after an accepted request.
    if (delegatedToWorker) {
      return { delegated: true, result: null };
    }

    const extraction = extractPalette(imageData, width, height, swatchCount, options);
    const origins = originTracker.compute(imageData, width, height, extraction.colors);
    /** @type {FrozenPresence[]} */
    let frozenPresence = [];

    if (frozenColors.length > 0) {
      const presence = computePresence(
        imageData,
        width,
        height,
        frozenColors.map((entry) => entry.color),
      );
      frozenPresence = frozenColors.map((entry, index) => ({
        slot: entry.slot,
        presence: presence[index] ?? 0,
      }));
    }

    return {
      delegated: false,
      result: commitResult({
        colors: extraction.colors,
        origins,
        frozenPresence,
      }),
    };
  }

  /**
   * @param {ExtractionResult & {durationMs: number}} result
   * @returns {ExtractionResult}
   */
  function acceptWorkerResult({ colors, durationMs, origins, frozenPresence }) {
    latestWorkerDurationMs = durationMs;
    return commitResult({ colors, origins, frozenPresence });
  }

  function getSnapshot() {
    return {
      colors: lastExtractedColors,
      origins: lastExtractedOrigins,
    };
  }

  function takeLatestWorkerDurationMs() {
    const durationMs = latestWorkerDurationMs;
    latestWorkerDurationMs = null;
    return durationMs;
  }

  function reset() {
    lastExtractedColors = null;
    lastExtractedOrigins = [];
    latestWorkerDurationMs = null;
    originTracker.reset();
    worker.invalidate();
  }

  return {
    acceptWorkerResult,
    getSnapshot,
    request,
    reset,
    takeLatestWorkerDurationMs,
  };
}
