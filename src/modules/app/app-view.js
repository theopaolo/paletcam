/**
 * @typedef {object} AppView
 * @property {HTMLVideoElement | null} cameraFeed
 * @property {HTMLButtonElement | null} captureButton
 * @property {HTMLButtonElement | null} captureModeToggle
 * @property {HTMLElement | null} allowButton
 * @property {HTMLElement | null} allowText
 * @property {HTMLElement | null} captureContainer
 * @property {HTMLElement | null} capturePaletteStage
 * @property {HTMLElement | null} captureCameraStage
 * @property {HTMLElement | null} cameraStageMount
 * @property {HTMLElement | null} cameraPreviewDock
 * @property {HTMLImageElement | null} photoOutput
 * @property {HTMLElement | null} outputPalette
 * @property {HTMLCanvasElement | null} frameCanvas
 * @property {HTMLCanvasElement | null} paletteCanvas
 * @property {HTMLElement | null} paletteLockOverlay
 * @property {HTMLButtonElement | null} rotateButton
 * @property {HTMLElement | null} swatchCountDrum
 * @property {HTMLElement | null} ralReticle
 * @property {HTMLElement | null} ralLiveSwatch
 * @property {HTMLElement | null} ralLiveSwatchColor
 * @property {HTMLElement | null} ralLiveSwatchCode
 * @property {HTMLElement | null} ralLiveSwatchName
 * @property {HTMLElement | null} ralLiveSwatchQuality
 * @property {HTMLElement | null} swatchCountControl
 * @property {Element | null} captureModeSection
 * @property {HTMLElement | null} configPanel
 * @property {HTMLButtonElement | null} viewCollectionButton
 * @property {HTMLDivElement} cameraViewportFrame
 * @property {HTMLDivElement} cameraSourceMount
 * @property {HTMLCanvasElement} paletteOriginsOverlay
 */

/** @param {Document} documentRef @returns {AppView} */
export function createAppView(documentRef) {
  const capturePaletteStage = /** @type {HTMLElement | null} */ (
    documentRef.querySelector(".capture-palette-stage")
  );

  return {
    cameraFeed: /** @type {HTMLVideoElement | null} */ (documentRef.querySelector(".camera-feed")),
    captureButton: /** @type {HTMLButtonElement | null} */ (
      documentRef.querySelector(".btn-capture")
    ),
    captureModeToggle: /** @type {HTMLButtonElement | null} */ (
      documentRef.querySelector(".btn-capture-mode-toggle")
    ),
    allowButton: /** @type {HTMLElement | null} */ (documentRef.querySelector(".btn-allow-media")),
    allowText: /** @type {HTMLElement | null} */ (
      documentRef.querySelector(".allow-container span")
    ),
    captureContainer: /** @type {HTMLElement | null} */ (documentRef.querySelector(".capture")),
    capturePaletteStage,
    captureCameraStage: /** @type {HTMLElement | null} */ (
      documentRef.querySelector(".capture-camera-stage")
    ),
    cameraStageMount: documentRef.getElementById("cameraStageMount"),
    cameraPreviewDock: documentRef.getElementById("cameraPreviewDock"),
    photoOutput: /** @type {HTMLImageElement | null} */ (documentRef.getElementById("photo")),
    outputPalette: documentRef.getElementById("outputPalette"),
    frameCanvas: /** @type {HTMLCanvasElement | null} */ (documentRef.getElementById("canvas")),
    paletteCanvas: /** @type {HTMLCanvasElement | null} */ (
      documentRef.getElementById("canvas-palette")
    ),
    paletteLockOverlay: documentRef.getElementById("paletteLockOverlay"),
    rotateButton: /** @type {HTMLButtonElement | null} */ (
      documentRef.querySelector(".btn-rotate")
    ),
    swatchCountDrum: documentRef.getElementById("swatchCountDrum"),
    ralReticle: documentRef.getElementById("ralReticle"),
    ralLiveSwatch: documentRef.getElementById("ralLiveSwatch"),
    ralLiveSwatchColor: documentRef.getElementById("ralLiveSwatchColor"),
    ralLiveSwatchCode: documentRef.getElementById("ralLiveSwatchCode"),
    ralLiveSwatchName: documentRef.getElementById("ralLiveSwatchName"),
    ralLiveSwatchQuality: documentRef.getElementById("ralLiveSwatchQuality"),
    swatchCountControl: /** @type {HTMLElement | null} */ (
      documentRef.querySelector(".swatch-count-control")
    ),
    captureModeSection: documentRef.querySelector(".capture-mode-section"),
    configPanel: /** @type {HTMLElement | null} */ (documentRef.querySelector("config-panel")),
    viewCollectionButton: /** @type {HTMLButtonElement | null} */ (
      documentRef.querySelector(".btn-view-collection")
    ),
    cameraViewportFrame: documentRef.createElement("div"),
    cameraSourceMount: documentRef.createElement("div"),
    paletteOriginsOverlay: documentRef.createElement("canvas"),
  };
}

/** @param {AppView} view */
export function getMissingRequiredAppViewElements(view) {
  return [
    ["cameraFeed", view.cameraFeed],
    ["captureButton", view.captureButton],
    ["captureContainer", view.captureContainer],
    ["frameCanvas", view.frameCanvas],
    ["paletteCanvas", view.paletteCanvas],
    ["cameraStageMount", view.cameraStageMount],
    ["cameraPreviewDock", view.cameraPreviewDock],
  ]
    .filter(([, element]) => !element)
    .map(([key]) => key);
}

/** @param {AppView} view */
export function hasRequiredAppViewElements(view) {
  return getMissingRequiredAppViewElements(view).length === 0;
}
