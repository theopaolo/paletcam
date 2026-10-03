import { describe, expect, mock, test } from "bun:test";

import { createLivePreviewExtractionPipeline } from "./live-preview-extraction-pipeline.js";

const RAW_COLORS = [
  { r: 220, g: 30, b: 20, population: 12 },
  { r: 20, g: 40, b: 210, population: 7 },
];
const ORIGINS = [
  { x: 0.2, y: 0.3 },
  { x: 0.7, y: 0.8 },
];
const FROZEN_ENTRIES = [
  { slot: 1, color: { r: 10, g: 20, b: 30 } },
  { slot: 4, color: { r: 40, g: 50, b: 60 } },
];

/**
 * @param {{
 *   workerAccepted?: boolean,
 *   requestExtraction?: (request: object) => boolean,
 *   extractPalette?: (
 *     imageData: Uint8ClampedArray,
 *     width: number,
 *     height: number,
 *     swatchCount: number,
 *     options: object,
 *   ) => {colors: Array<RgbColor & {population?: number}>},
 *   computeOrigins?: (
 *     imageData: Uint8ClampedArray,
 *     width: number,
 *     height: number,
 *     colors: Array<RgbColor & {population?: number}>,
 *   ) => Array<{x: number, y: number} | null>,
 *   computePresence?: (
 *     imageData: Uint8ClampedArray,
 *     width: number,
 *     height: number,
 *     colors: RgbColor[],
 *   ) => number[],
 * }} [options]
 */
function createFixture({
  workerAccepted = true,
  requestExtraction,
  extractPalette,
  computeOrigins,
  computePresence,
} = {}) {
  const requestExtractionMock = mock(requestExtraction ?? (() => workerAccepted));
  const worker = {
    invalidate: mock(() => {}),
    requestExtraction: requestExtractionMock,
  };
  const originTracker = {
    compute: computeOrigins ?? mock(() => ORIGINS),
    reset: mock(() => {}),
  };
  const extract = extractPalette ?? mock(() => ({ colors: RAW_COLORS }));
  const presence = computePresence ?? mock(() => [0.25, 0]);
  const pipeline = createLivePreviewExtractionPipeline({
    worker,
    extractPalette: extract,
    originTracker,
    computePresence: presence,
  });

  return { extract, originTracker, pipeline, presence, requestExtractionMock, worker };
}

function extractionRequest(overrides = {}) {
  return {
    frozenEntries: FROZEN_ENTRIES,
    height: 2,
    hybridSettings: { candidatePoolSize: 24, previousColors: ["untrusted"] },
    imageData: new Uint8ClampedArray(4 * 3 * 2),
    medianCutSettings: { colorBits: 5 },
    swatchCount: 2,
    width: 3,
    ...overrides,
  };
}

describe("live preview extraction worker path", () => {
  test("forwards an exact request and does not run or commit the synchronous fallback", () => {
    const fixture = createFixture();
    const request = extractionRequest();

    expect(fixture.pipeline.request(request)).toEqual({ delegated: true, result: null });

    expect(fixture.worker.requestExtraction).toHaveBeenCalledWith({
      frozenColors: FROZEN_ENTRIES,
      height: 2,
      imageData: request.imageData,
      options: {
        hybrid: { candidatePoolSize: 24, previousColors: [] },
        medianCut: { colorBits: 5 },
      },
      swatchCount: 2,
      width: 3,
    });
    expect(fixture.extract).not.toHaveBeenCalled();
    expect(fixture.originTracker.compute).not.toHaveBeenCalled();
    expect(fixture.presence).not.toHaveBeenCalled();
    expect(fixture.pipeline.getSnapshot()).toEqual({ colors: null, origins: [] });
  });

  test("never reads a pixel buffer after the worker accepts and transfers it", () => {
    const request = extractionRequest();
    const workerRequest = mock(({ imageData }) => {
      structuredClone(imageData.buffer, { transfer: [imageData.buffer] });
      return true;
    });
    const fixture = createFixture({ requestExtraction: workerRequest });

    expect(fixture.pipeline.request(request)).toEqual({ delegated: true, result: null });
    expect(request.imageData.byteLength).toBe(0);
    expect(fixture.extract).not.toHaveBeenCalled();
  });

  test("accepts the normalized worker result and exposes duration exactly once", () => {
    const fixture = createFixture();
    const frozenPresence = [{ slot: 1, presence: 0.4 }];

    expect(
      fixture.pipeline.acceptWorkerResult({
        colors: RAW_COLORS,
        durationMs: 0,
        frozenPresence,
        origins: ORIGINS,
      }),
    ).toEqual({ colors: RAW_COLORS, frozenPresence, origins: ORIGINS });
    expect(fixture.pipeline.getSnapshot()).toEqual({ colors: RAW_COLORS, origins: ORIGINS });
    expect(fixture.pipeline.takeLatestWorkerDurationMs()).toBe(0);
    expect(fixture.pipeline.takeLatestWorkerDurationMs()).toBeNull();
  });

  test("preserves the public handler's non-array origin normalization", () => {
    const fixture = createFixture();

    const result = fixture.pipeline.acceptWorkerResult({
      colors: RAW_COLORS,
      durationMs: 7,
      frozenPresence: [],
      origins: null,
    });

    expect(result.origins).toEqual([]);
    expect(fixture.pipeline.getSnapshot().origins).toEqual([]);
  });
});

describe("live preview extraction synchronous fallback", () => {
  test("computes origins and slot-preserving frozen presence, then commits the result", () => {
    const fixture = createFixture({ workerAccepted: false });
    const request = extractionRequest();

    const response = fixture.pipeline.request(request);

    expect(response).toEqual({
      delegated: false,
      result: {
        colors: RAW_COLORS,
        frozenPresence: [
          { slot: 1, presence: 0.25 },
          { slot: 4, presence: 0 },
        ],
        origins: ORIGINS,
      },
    });
    const options = {
      hybrid: { candidatePoolSize: 24, previousColors: [] },
      medianCut: { colorBits: 5 },
    };
    expect(fixture.extract).toHaveBeenCalledWith(request.imageData, 3, 2, 2, options);
    expect(fixture.originTracker.compute).toHaveBeenCalledWith(request.imageData, 3, 2, RAW_COLORS);
    expect(fixture.presence).toHaveBeenCalledWith(request.imageData, 3, 2, [
      FROZEN_ENTRIES[0].color,
      FROZEN_ENTRIES[1].color,
    ]);
    expect(fixture.pipeline.getSnapshot()).toEqual({ colors: RAW_COLORS, origins: ORIGINS });
  });

  test("skips the presence scan when no pins are supplied", () => {
    const fixture = createFixture({ workerAccepted: false });

    const response = fixture.pipeline.request(extractionRequest({ frozenEntries: [] }));

    expect(response.result.frozenPresence).toEqual([]);
    expect(fixture.presence).not.toHaveBeenCalled();
  });

  test("does not catch failures from worker dispatch or synchronous dependencies", () => {
    const workerError = new Error("worker adapter failed");
    const workerFixture = createFixture({
      requestExtraction: mock(() => {
        throw workerError;
      }),
    });
    expect(() => workerFixture.pipeline.request(extractionRequest())).toThrow(workerError);

    for (const dependency of ["extract", "origins", "presence"]) {
      const error = new Error(`${dependency} failed`);
      const fixture = createFixture({
        workerAccepted: false,
        ...(dependency === "extract"
          ? {
              extractPalette: mock(() => {
                throw error;
              }),
            }
          : {}),
        ...(dependency === "origins"
          ? {
              computeOrigins: mock(() => {
                throw error;
              }),
            }
          : {}),
        ...(dependency === "presence"
          ? {
              computePresence: mock(() => {
                throw error;
              }),
            }
          : {}),
      });

      expect(() => fixture.pipeline.request(extractionRequest())).toThrow(error);
    }
  });
});

describe("live preview extraction state", () => {
  test("uses only the previous raw result as the next request's stability bias", () => {
    const fixture = createFixture({ workerAccepted: false });
    fixture.pipeline.request(extractionRequest());
    fixture.requestExtractionMock.mockImplementation(() => true);

    fixture.pipeline.request(
      extractionRequest({
        hybridSettings: { previousColors: [{ r: 1, g: 1, b: 1 }], threshold: 8 },
      }),
    );

    const secondPayload = fixture.requestExtractionMock.mock.calls[1][0];
    expect(secondPayload.options.hybrid).toEqual({
      previousColors: RAW_COLORS,
      threshold: 8,
    });
    expect(secondPayload.options.hybrid.previousColors).toBe(RAW_COLORS);
  });

  test("reset clears all state and invalidates both fallback and worker generations once", () => {
    const fixture = createFixture({ workerAccepted: false });
    fixture.pipeline.request(extractionRequest());
    fixture.pipeline.acceptWorkerResult({
      colors: RAW_COLORS,
      durationMs: 12,
      frozenPresence: [],
      origins: ORIGINS,
    });

    fixture.pipeline.reset();

    expect(fixture.pipeline.getSnapshot()).toEqual({ colors: null, origins: [] });
    expect(fixture.pipeline.takeLatestWorkerDurationMs()).toBeNull();
    expect(fixture.originTracker.reset).toHaveBeenCalledTimes(1);
    expect(fixture.worker.invalidate).toHaveBeenCalledTimes(1);

    fixture.requestExtractionMock.mockImplementation(() => true);
    fixture.pipeline.request(extractionRequest());
    const latestPayload = fixture.requestExtractionMock.mock.calls.at(-1)[0];
    expect(latestPayload.options.hybrid.previousColors).toEqual([]);
  });
});
