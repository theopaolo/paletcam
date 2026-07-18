// The quantizer samples at most ~40k pixels, so anything above ~320px wide is
// pure getImageData readback cost with no extraction-quality gain.
const DEFAULT_ANALYSIS_MAX_WIDTH = 320;

/**
 * Browser adapter for the live preview's canvas surfaces and camera-frame
 * acquisition. Layout and capture-mode policy stay with the caller; this
 * boundary owns only dimensions, drawing, and pixel readback.
 *
 * @param {object} options
 * @param {HTMLVideoElement | null} options.cameraFeed
 * @param {HTMLCanvasElement | null} options.frameCanvas
 * @param {HTMLCanvasElement | null} options.paletteCanvas
 * @param {HTMLCanvasElement} options.analysisCanvas
 * @param {CanvasRenderingContext2D | null} [options.analysisContext]
 * @param {HTMLCanvasElement | null} [options.originsOverlayCanvas]
 * @param {(options: {
 *   context: CanvasRenderingContext2D,
 *   cameraFeed: HTMLVideoElement | null,
 *   width: number,
 *   height: number,
 *   facingMode: string,
 *   shouldMirrorUserFacing: boolean,
 *   sourceRect: CropRect | null,
 * }) => void} options.drawFrame
 * @param {(sourceWidth: number, sourceHeight: number) => CropRect | null} options.getCropRect
 * @param {(width: number) => number} options.getFrameHeight
 * @param {() => number} [options.getDevicePixelRatio]
 * @param {number} [options.analysisMaxWidth]
 */
export function createLivePreviewFrameAcquisition({
  cameraFeed,
  frameCanvas,
  paletteCanvas,
  analysisCanvas,
  analysisContext = analysisCanvas?.getContext("2d", { willReadFrequently: true }) ??
    analysisCanvas?.getContext("2d"),
  originsOverlayCanvas = null,
  drawFrame,
  getCropRect,
  getFrameHeight,
  getDevicePixelRatio = () => 1,
  analysisMaxWidth = DEFAULT_ANALYSIS_MAX_WIDTH,
}) {
  const frameContext =
    frameCanvas?.getContext("2d", { willReadFrequently: true }) ?? frameCanvas?.getContext("2d");
  const paletteContext = paletteCanvas?.getContext("2d");
  const originsOverlayContext = originsOverlayCanvas?.getContext("2d") ?? null;

  let frameWidth = 0;
  let frameHeight = 0;
  let analysisWidth = 0;
  let analysisHeight = 0;
  let paletteWidth = 0;
  let paletteHeight = 0;

  function clearAnalysisDimensions() {
    analysisWidth = 0;
    analysisHeight = 0;
    analysisCanvas.width = 0;
    analysisCanvas.height = 0;
  }

  function updateAnalysisDimensions() {
    if (frameWidth <= 0 || frameHeight <= 0) {
      clearAnalysisDimensions();
      return false;
    }

    const scale = Math.min(1, analysisMaxWidth / frameWidth);
    const nextAnalysisWidth = Math.max(1, Math.round(frameWidth * scale));
    const nextAnalysisHeight = Math.max(1, Math.round(frameHeight * scale));

    analysisWidth = nextAnalysisWidth;
    analysisHeight = nextAnalysisHeight;

    if (
      analysisCanvas.width !== nextAnalysisWidth ||
      analysisCanvas.height !== nextAnalysisHeight
    ) {
      analysisCanvas.width = nextAnalysisWidth;
      analysisCanvas.height = nextAnalysisHeight;
    }

    return true;
  }

  /** @param {{ viewportWidth: number, viewportHeight: number }} dimensions */
  function resize({ viewportWidth, viewportHeight }) {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      paletteWidth = 0;
      paletteHeight = 0;
      frameWidth = 0;
      frameHeight = 0;
      clearAnalysisDimensions();
      return false;
    }

    paletteWidth = viewportWidth;
    paletteHeight = viewportHeight;
    frameWidth = viewportWidth;
    frameHeight = getFrameHeight(frameWidth);

    if (
      !cameraFeed ||
      !frameCanvas ||
      !paletteCanvas ||
      !analysisContext ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return false;
    }

    cameraFeed.setAttribute("width", String(frameWidth));
    cameraFeed.setAttribute("height", String(frameHeight));

    if (frameCanvas.width !== frameWidth || frameCanvas.height !== frameHeight) {
      frameCanvas.width = frameWidth;
      frameCanvas.height = frameHeight;
    }

    if (originsOverlayCanvas) {
      const dpr = getDevicePixelRatio() || 1;
      const overlayWidth = Math.round(frameWidth * dpr);
      const overlayHeight = Math.round(frameHeight * dpr);
      if (
        originsOverlayCanvas.width !== overlayWidth ||
        originsOverlayCanvas.height !== overlayHeight
      ) {
        originsOverlayCanvas.width = overlayWidth;
        originsOverlayCanvas.height = overlayHeight;
      }
      originsOverlayContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (paletteCanvas.width !== frameWidth || paletteCanvas.height !== paletteHeight) {
      paletteCanvas.width = frameWidth;
      paletteCanvas.height = paletteHeight;
    }

    updateAnalysisDimensions();
    return true;
  }

  function getCameraFrameSourceRect() {
    return getCropRect(cameraFeed?.videoWidth ?? 0, cameraFeed?.videoHeight ?? 0);
  }

  /** @param {{ facingMode: string, shouldMirrorUserFacing: boolean }} options */
  function drawPreview({ facingMode, shouldMirrorUserFacing }) {
    if (!frameContext || frameWidth <= 0 || frameHeight <= 0) {
      return false;
    }

    drawFrame({
      context: frameContext,
      cameraFeed,
      width: frameWidth,
      height: frameHeight,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: getCameraFrameSourceRect(),
    });
    return true;
  }

  /** @param {{ facingMode: string, shouldMirrorUserFacing: boolean }} options */
  function drawCurrentFrameToAnalysisCanvas({ facingMode, shouldMirrorUserFacing }) {
    if (!analysisContext || analysisWidth <= 0 || analysisHeight <= 0) {
      return false;
    }

    drawFrame({
      context: analysisContext,
      cameraFeed,
      width: analysisWidth,
      height: analysisHeight,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: getCameraFrameSourceRect(),
    });
    return true;
  }

  function copyVisibleFrameToAnalysisCanvas() {
    if (
      !analysisContext ||
      !frameCanvas ||
      analysisWidth <= 0 ||
      analysisHeight <= 0 ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return false;
    }

    analysisContext.drawImage(
      frameCanvas,
      0,
      0,
      frameWidth,
      frameHeight,
      0,
      0,
      analysisWidth,
      analysisHeight,
    );
    return true;
  }

  function readAnalysisPixels() {
    if (!analysisContext || analysisWidth <= 0 || analysisHeight <= 0) {
      return null;
    }

    return analysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  }

  function getDimensions() {
    return {
      analysisHeight,
      analysisWidth,
      frameHeight,
      frameWidth,
      paletteHeight,
      paletteWidth,
    };
  }

  return {
    copyVisibleFrameToAnalysisCanvas,
    drawCurrentFrameToAnalysisCanvas,
    drawPreview,
    getAnalysisContext: () => analysisContext,
    getCameraFrameSourceRect,
    getDimensions,
    getFrameContext: () => frameContext,
    getOriginsOverlayContext: () => originsOverlayContext,
    getPaletteContext: () => paletteContext,
    readAnalysisPixels,
    resize,
  };
}
