import { afterEach, describe, expect, test } from "bun:test";

import {
  getPalettePhotoAspectRatioValue,
  renderPalettePolaroidBlob,
  resolveNormalizedCropRectToPixelRect,
} from "./palette-polaroid-renderer.js";

const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

function setGlobalProperty(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  if (originalImageDescriptor) {
    Object.defineProperty(globalThis, "Image", originalImageDescriptor);
  }

  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
  }

  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
});

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
    expect(
      getPalettePhotoAspectRatioValue({
        captureCropRect: { x: 0, y: 0, width: 1, height: 0.75 },
      }),
    ).toBeNull();
  });
});

describe("renderPalettePolaroidBlob", () => {
  test("keeps the source blob URL alive until after the canvas draw completes", async () => {
    const revokedUrls = [];
    const drawStates = [];
    const photoUrl = "blob:palette-preview-source";
    const fakeContext = {
      drawImage() {
        drawStates.push(revokedUrls.length);
      },
      fillRect() {},
      fillText() {},
      measureText() {
        return { width: 120 };
      },
      restore() {},
      save() {},
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeContext;
      },
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };

    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName === "canvas") {
          return fakeCanvas;
        }

        throw new Error(`Unexpected element creation: ${tagName}`);
      },
      fonts: {
        load() {
          return Promise.resolve();
        },
      },
      querySelector() {
        return null;
      },
    });
    globalThis.URL.createObjectURL = () => photoUrl;
    globalThis.URL.revokeObjectURL = (url) => {
      revokedUrls.push(url);
    };
    setGlobalProperty("Image", class MockImage {
      constructor() {
        this.width = 1600;
        this.height = 1200;
        this.onload = null;
        this.onerror = null;
      }

      set src(value) {
        this._src = value;

        if (!value) {
          return;
        }

        queueMicrotask(() => {
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }
    });

    const result = await renderPalettePolaroidBlob({
      colors: [{ r: 255, g: 106, b: 0 }],
      photoBlob: new Blob(["source"], { type: "image/webp" }),
    });

    expect(result).toBeInstanceOf(Blob);
    expect(drawStates).toEqual([0]);
    expect(revokedUrls).toEqual([photoUrl]);
  });
});
