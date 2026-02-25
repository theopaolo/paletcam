import { describe, expect, test } from "bun:test";

import {
  getPalettePhotoAspectRatioValue,
  hasPaletteMasterPhoto,
  resolveNormalizedCropRectToPixelRect,
} from "./palette-polaroid-renderer.js";

describe("resolveNormalizedCropRectToPixelRect", () => {
  test("converts normalized crop values to pixel coordinates", () => {
    expect(
      resolveNormalizedCropRectToPixelRect({
        cropRect: { x: 0.125, y: 0.25, width: 0.5, height: 0.5 },
        imageWidth: 800,
        imageHeight: 600,
      }),
    ).toEqual({
      x: 100,
      y: 150,
      width: 400,
      height: 300,
    });
  });

  test("clamps out-of-range values and preserves a valid rect", () => {
    expect(
      resolveNormalizedCropRectToPixelRect({
        cropRect: { x: -0.2, y: 0.7, width: 2, height: 0.8 },
        imageWidth: 1000,
        imageHeight: 500,
      }),
    ).toEqual({
      x: 0,
      y: 350,
      width: 1000,
      height: 150,
    });
  });
});

describe("getPalettePhotoAspectRatioValue", () => {
  test("returns supported ratios and null for legacy/missing metadata", () => {
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "1:1" })).toBe(1);
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "4:3" })).toBeCloseTo(4 / 3);
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "weird" })).toBeNull();
    expect(getPalettePhotoAspectRatioValue({})).toBeNull();
  });
});


describe("hasPaletteMasterPhoto", () => {
  test("returns true for blob fields and legacy data url photos", () => {
    const blob = new Blob(["test"], { type: "text/plain" });

    expect(hasPaletteMasterPhoto({ photoBlob: blob })).toBe(true);
    expect(hasPaletteMasterPhoto({ masterPhotoBlob: blob })).toBe(true);
    expect(hasPaletteMasterPhoto({ photoDataUrl: "data:text/plain;base64,dGVzdA==" })).toBe(true);
    expect(hasPaletteMasterPhoto({ photoDataUrl: "broken-data-url" })).toBe(false);
    expect(hasPaletteMasterPhoto({})).toBe(false);
  });
});
