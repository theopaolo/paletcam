import { describe, expect, mock, test } from "bun:test";

import { createLivePreviewFrameAcquisition } from "./live-preview-frame-acquisition.js";
import { getCenteredAspectCropRect, getTargetFrameHeight } from "./geometry.js";

function createCanvas(context, initialWidth = 0, initialHeight = 0) {
  let width = initialWidth;
  let height = initialHeight;
  const widthWrites = [];
  const heightWrites = [];

  return {
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      widthWrites.push(value);
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
      heightWrites.push(value);
    },
    getContext: mock(() => context),
    widthWrites,
    heightWrites,
  };
}

function createFixture({
  analysisContextOverrides = {},
  analysisMaxWidth,
  devicePixelRatio = 2,
} = {}) {
  const pixels = new Uint8ClampedArray([1, 2, 3, 4]);
  const frameContext = {};
  const paletteContext = {};
  const originsOverlayContext = {
    setTransform: mock(() => {}),
  };
  const analysisContext = {
    drawImage: mock(() => {}),
    getImageData: mock(() => ({ data: pixels })),
    ...analysisContextOverrides,
  };
  const frameCanvas = createCanvas(frameContext);
  const paletteCanvas = createCanvas(paletteContext);
  const analysisCanvas = createCanvas(analysisContext);
  const originsOverlayCanvas = createCanvas(originsOverlayContext);
  const attributes = new Map();
  const cameraFeed = {
    videoHeight: 1080,
    videoWidth: 1920,
    setAttribute: mock((name, value) => attributes.set(name, value)),
  };
  const drawFrame = mock(() => {});

  const acquisition = createLivePreviewFrameAcquisition({
    cameraFeed,
    frameCanvas,
    paletteCanvas,
    analysisCanvas,
    analysisContext,
    originsOverlayCanvas,
    drawFrame,
    getCropRect: getCenteredAspectCropRect,
    getFrameHeight: getTargetFrameHeight,
    getDevicePixelRatio: () => devicePixelRatio,
    ...(analysisMaxWidth === undefined ? {} : { analysisMaxWidth }),
  });

  return {
    acquisition,
    analysisCanvas,
    analysisContext,
    attributes,
    cameraFeed,
    drawFrame,
    frameCanvas,
    frameContext,
    originsOverlayCanvas,
    originsOverlayContext,
    paletteCanvas,
    paletteContext,
    pixels,
  };
}

describe("live preview frame sizing", () => {
  test("sizes every surface and bounds analysis readback while preserving aspect ratio", () => {
    const fixture = createFixture();

    expect(
      fixture.acquisition.resize({
        viewportWidth: 640,
        viewportHeight: 512,
      }),
    ).toBe(true);

    expect(fixture.acquisition.getDimensions()).toEqual({
      analysisHeight: 240,
      analysisWidth: 320,
      frameHeight: 480,
      frameWidth: 640,
      paletteHeight: 512,
      paletteWidth: 640,
    });
    expect(fixture.attributes).toEqual(
      new Map([
        ["width", "640"],
        ["height", "480"],
      ]),
    );
    expect([fixture.frameCanvas.width, fixture.frameCanvas.height]).toEqual([640, 480]);
    expect([fixture.paletteCanvas.width, fixture.paletteCanvas.height]).toEqual([640, 512]);
    expect([fixture.analysisCanvas.width, fixture.analysisCanvas.height]).toEqual([320, 240]);
    expect([fixture.originsOverlayCanvas.width, fixture.originsOverlayCanvas.height]).toEqual([
      1280, 960,
    ]);
    expect(fixture.originsOverlayContext.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  test("does not rewrite unchanged canvas dimensions and reapplies the DPR transform", () => {
    const fixture = createFixture();
    const size = { viewportWidth: 320, viewportHeight: 300 };

    fixture.acquisition.resize(size);
    const writeCounts = {
      analysisHeight: fixture.analysisCanvas.heightWrites.length,
      analysisWidth: fixture.analysisCanvas.widthWrites.length,
      frameHeight: fixture.frameCanvas.heightWrites.length,
      frameWidth: fixture.frameCanvas.widthWrites.length,
      overlayHeight: fixture.originsOverlayCanvas.heightWrites.length,
      overlayWidth: fixture.originsOverlayCanvas.widthWrites.length,
      paletteHeight: fixture.paletteCanvas.heightWrites.length,
      paletteWidth: fixture.paletteCanvas.widthWrites.length,
    };

    fixture.acquisition.resize(size);

    expect({
      analysisHeight: fixture.analysisCanvas.heightWrites.length,
      analysisWidth: fixture.analysisCanvas.widthWrites.length,
      frameHeight: fixture.frameCanvas.heightWrites.length,
      frameWidth: fixture.frameCanvas.widthWrites.length,
      overlayHeight: fixture.originsOverlayCanvas.heightWrites.length,
      overlayWidth: fixture.originsOverlayCanvas.widthWrites.length,
      paletteHeight: fixture.paletteCanvas.heightWrites.length,
      paletteWidth: fixture.paletteCanvas.widthWrites.length,
    }).toEqual(writeCounts);
    expect(fixture.originsOverlayContext.setTransform).toHaveBeenCalledTimes(2);
    expect(fixture.cameraFeed.setAttribute).toHaveBeenCalledTimes(4);
  });

  test("clears only logical and analysis dimensions for an invalid viewport", () => {
    const fixture = createFixture();
    fixture.acquisition.resize({ viewportWidth: 640, viewportHeight: 512 });

    expect(fixture.acquisition.resize({ viewportWidth: 0, viewportHeight: 512 })).toBe(false);

    expect(fixture.acquisition.getDimensions()).toEqual({
      analysisHeight: 0,
      analysisWidth: 0,
      frameHeight: 0,
      frameWidth: 0,
      paletteHeight: 0,
      paletteWidth: 0,
    });
    expect([fixture.analysisCanvas.width, fixture.analysisCanvas.height]).toEqual([0, 0]);
    // Existing visible bitmaps remain intact, matching the former controller behavior.
    expect([fixture.frameCanvas.width, fixture.frameCanvas.height]).toEqual([640, 480]);
    expect([fixture.paletteCanvas.width, fixture.paletteCanvas.height]).toEqual([640, 512]);
  });

  test("keeps small frames at native analysis dimensions", () => {
    const fixture = createFixture();
    fixture.acquisition.resize({ viewportWidth: 200, viewportHeight: 180 });

    expect(fixture.acquisition.getDimensions()).toMatchObject({
      analysisHeight: 150,
      analysisWidth: 200,
      frameHeight: 150,
      frameWidth: 200,
    });
  });
});

describe("live preview frame acquisition", () => {
  test("uses the intrinsic centered crop and forwards preview mirror/facing arguments exactly", () => {
    const fixture = createFixture();
    fixture.acquisition.resize({ viewportWidth: 640, viewportHeight: 512 });

    expect(fixture.acquisition.getCameraFrameSourceRect()).toEqual({
      height: 1080,
      width: 1440,
      x: 240,
      y: 0,
    });
    expect(
      fixture.acquisition.drawPreview({
        facingMode: "user",
        shouldMirrorUserFacing: true,
      }),
    ).toBe(true);
    expect(fixture.drawFrame).toHaveBeenLastCalledWith({
      cameraFeed: fixture.cameraFeed,
      context: fixture.frameContext,
      facingMode: "user",
      height: 480,
      shouldMirrorUserFacing: true,
      sourceRect: { height: 1080, width: 1440, x: 240, y: 0 },
      width: 640,
    });
  });

  test("draws camera and visible-preview analysis frames at the bounded size", () => {
    const fixture = createFixture();
    fixture.acquisition.resize({ viewportWidth: 640, viewportHeight: 512 });

    expect(
      fixture.acquisition.drawCurrentFrameToAnalysisCanvas({
        facingMode: "environment",
        shouldMirrorUserFacing: false,
      }),
    ).toBe(true);
    expect(fixture.drawFrame).toHaveBeenLastCalledWith({
      cameraFeed: fixture.cameraFeed,
      context: fixture.analysisContext,
      facingMode: "environment",
      height: 240,
      shouldMirrorUserFacing: false,
      sourceRect: { height: 1080, width: 1440, x: 240, y: 0 },
      width: 320,
    });

    expect(fixture.acquisition.copyVisibleFrameToAnalysisCanvas()).toBe(true);
    expect(fixture.analysisContext.drawImage).toHaveBeenCalledWith(
      fixture.frameCanvas,
      0,
      0,
      640,
      480,
      0,
      0,
      320,
      240,
    );
    expect(fixture.acquisition.readAnalysisPixels()).toBe(fixture.pixels);
    expect(fixture.analysisContext.getImageData).toHaveBeenCalledWith(0, 0, 320, 240);
  });

  test("does not hide getImageData failures", () => {
    const readError = new Error("readback failed");
    const fixture = createFixture({
      analysisContextOverrides: {
        getImageData: mock(() => {
          throw readError;
        }),
      },
    });
    fixture.acquisition.resize({ viewportWidth: 640, viewportHeight: 512 });

    expect(() => fixture.acquisition.readAnalysisPixels()).toThrow(readError);
  });

  test("returns false or null before valid dimensions are available", () => {
    const fixture = createFixture();

    expect(
      fixture.acquisition.drawPreview({
        facingMode: "environment",
        shouldMirrorUserFacing: false,
      }),
    ).toBe(false);
    expect(
      fixture.acquisition.drawCurrentFrameToAnalysisCanvas({
        facingMode: "environment",
        shouldMirrorUserFacing: false,
      }),
    ).toBe(false);
    expect(fixture.acquisition.copyVisibleFrameToAnalysisCanvas()).toBe(false);
    expect(fixture.acquisition.readAnalysisPixels()).toBeNull();
  });
});
