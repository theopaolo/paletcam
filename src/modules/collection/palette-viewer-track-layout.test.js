import { describe, expect, test } from "bun:test";

import {
  getViewerDragDelta,
  getViewerGestureAxis,
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

  test("locks touch gestures to a dominant axis after a short activation distance", () => {
    expect(getViewerGestureAxis(4, 3)).toBe("pending");
    expect(getViewerGestureAxis(18, 5)).toBe("horizontal");
    expect(getViewerGestureAxis(6, 16)).toBe("vertical");
  });

  test("applies edge resistance when dragging beyond the first or last capture", () => {
    expect(getViewerDragDelta(80, 0, 5)).toBe(28);
    expect(getViewerDragDelta(-80, 4, 5)).toBe(-28);
    expect(getViewerDragDelta(-80, 2, 5)).toBe(-80);
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
      transform: "translate3d(43px, -2px, 0) scale(1)",
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
      transform: "translate3d(-1px, 22px, 0) scale(0.90)",
      zIndex: "0",
    });
  });
});
