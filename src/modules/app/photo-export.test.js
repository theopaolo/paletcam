import { afterEach, expect, mock, test } from "bun:test";
import { createPhotoExportCanvas } from "./photo-export.js";

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

test("exports the frozen fallback frame when native camera pixels are unavailable", () => {
  const drawImage = mock(() => {});
  const outputContext = {
    drawImage,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  };
  const outputCanvas = {
    getContext: () => outputContext,
    height: 0,
    width: 0,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => outputCanvas },
  });
  const fallbackCanvas = { kind: "frozen-frame" };
  const unavailableCameraFeed = { videoHeight: 0, videoWidth: 0 };

  const result = createPhotoExportCanvas({
    fallbackCanvas,
    fallbackHeight: 300,
    fallbackWidth: 400,
    cameraFeed: unavailableCameraFeed,
    facingMode: "environment",
    shouldMirrorUserFacing: false,
  });

  expect(result).toBe(outputCanvas);
  expect(outputCanvas.width).toBe(400);
  expect(outputCanvas.height).toBe(300);
  expect(drawImage).toHaveBeenCalledWith(fallbackCanvas, 0, 0, 400, 300, 0, 0, 400, 300);
});

test("freezes the native camera frame up to the high-resolution export cap", () => {
  const drawImage = mock(() => {});
  const outputContext = {
    drawImage,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    restore: mock(() => {}),
    save: mock(() => {}),
    scale: mock(() => {}),
  };
  const outputCanvas = {
    getContext: () => outputContext,
    height: 0,
    width: 0,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => outputCanvas },
  });
  const cameraFeed = { videoHeight: 3024, videoWidth: 4032 };

  const result = createPhotoExportCanvas({
    fallbackCanvas: {},
    fallbackHeight: 300,
    fallbackWidth: 400,
    cameraFeed,
    facingMode: "environment",
    shouldMirrorUserFacing: false,
    sourceRect: null,
  });

  expect(result).toBe(outputCanvas);
  expect(outputCanvas.width).toBe(2048);
  expect(outputCanvas.height).toBe(1536);
  expect(drawImage).toHaveBeenCalledWith(cameraFeed, 0, 0, 2048, 1536);
});
