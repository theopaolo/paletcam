import { describe, expect, test } from "bun:test";

import {
  findClosestRalFromContext,
  getSamplingWindow,
  sampleColorFromContextAtPoint,
} from "./ral-live-sampling.js";

function createContextStub(pixelDataByRect, calls) {
  return {
    getImageData(x, y, width, height) {
      calls.push({ height, width, x, y });
      const key = `${x},${y},${width},${height}`;
      const data = pixelDataByRect.get(key);
      if (!data) {
        throw new Error(`Missing test data for ${key}`);
      }

      return { data };
    },
  };
}

describe("ral-live-sampling", () => {
  test("limits the sampled read to the live point neighborhood", () => {
    const calls = [];
    const context = createContextStub(
      new Map([["16,6,9,9", new Uint8ClampedArray(9 * 9 * 4).fill(255)]]),
      calls,
    );

    sampleColorFromContextAtPoint(context, 41, 29, 20, 10);

    expect(calls).toEqual([{ height: 9, width: 9, x: 16, y: 6 }]);
  });

  test("clamps the sampling window at image edges", () => {
    expect(getSamplingWindow(6, 6, 0, 0)).toEqual({
      height: 5,
      localX: 0,
      localY: 0,
      width: 5,
      x: 0,
      y: 0,
    });
  });

  test("returns the closest RAL match from a sampled patch", () => {
    const calls = [];
    const context = createContextStub(
      new Map([
        [
          "0,0,9,9",
          new Uint8ClampedArray(Array.from({ length: 9 * 9 }, () => [243, 118, 33, 255]).flat()),
        ],
      ]),
      calls,
    );

    const result = findClosestRalFromContext(context, 9, 9, 4, 4);

    expect(calls).toEqual([{ height: 9, width: 9, x: 0, y: 0 }]);
    expect(result.sampledColor).toEqual({ r: 243, g: 118, b: 33 });
    expect(result.matches[0]?.ral.code).toBe("RAL 2003");
  });
});
