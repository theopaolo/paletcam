import { describe, expect, test } from "bun:test";

import {
  getViewerPreloadIndices,
  getViewerRenderIndices,
  getViewerSlideLayout,
} from "./palette-viewer-track-layout.js";

describe("palette viewer track layout", () => {
  test("keeps render work bounded to the active card, peeking cards, and the previous frame", () => {
    expect(getViewerRenderIndices(15, 60, [14, 15, 16])).toEqual([14, 15, 16, 17]);
    expect(getViewerRenderIndices(0, 60, [])).toEqual([0, 1, 2]);
  });

  test("preloads the adjacent previous slide as well as upcoming slides", () => {
    expect(getViewerPreloadIndices(4, 10)).toEqual([3, 4, 5, 6]);
    expect(getViewerPreloadIndices(0, 3)).toEqual([0, 1, 2]);
  });

  test("computes active slide drag transforms without reading styles back from the dom", () => {
    expect(
      getViewerSlideLayout(
        0,
        {
          offsetX: 3,
          offsetY: -2,
          rotation: 4,
        },
        40,
      ),
    ).toEqual({
      pointerEvents: "auto",
      rotate: "0.6deg",
      transform: "translateX(43px) translateY(-2px) scale(1)",
      zIndex: "100",
    });

    expect(
      getViewerSlideLayout(3, {
        offsetX: -1,
        offsetY: 2,
        rotation: -3,
      }),
    ).toEqual({
      pointerEvents: "none",
      rotate: "-3deg",
      transform: "translateX(-1px) translateY(22px) scale(0.90)",
      zIndex: "0",
    });
  });
});
