import {
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_ROW_COUNT,
} from './palette-extract-grid.js';
import './camera/sample-grid-overlay-element.js';

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.overlayElement]
 * @param {HTMLVideoElement | null} [options.cameraFeed]
 * @param {number} [options.sampleColCount]
 * @param {number} [options.sampleDiameter]
 * @param {number} [options.sampleRowCount]
 * @returns {SampleGridOverlayController}
 */
export function createSampleGridOverlayController({
  overlayElement,
  cameraFeed,
  sampleColCount = SAMPLE_COL_COUNT,
  sampleDiameter = SAMPLE_DIAMETER,
  sampleRowCount = SAMPLE_ROW_COUNT,
} = {}) {
  if (overlayElement) {
    overlayElement.sampleColCount = sampleColCount;
    overlayElement.sampleDiameter = sampleDiameter;
    overlayElement.sampleRowCount = sampleRowCount;
  }

  function markChosenSquares(chosenIndices = []) {
    if (!overlayElement) {
      return;
    }

    overlayElement.chosenIndices = Array.isArray(chosenIndices) ? [...chosenIndices] : [];
  }

  function setVisible(nextVisibility) {
    if (!overlayElement) {
      return;
    }

    const nextVisible = Boolean(nextVisibility);
    overlayElement.visible = nextVisible;

    if (!nextVisible) {
      markChosenSquares([]);
      return;
    }

    updatePointSizes();
  }

  function updatePointSizes() {
    if (!overlayElement || !cameraFeed) {
      return;
    }

    const videoWidth = cameraFeed.videoWidth;
    if (videoWidth <= 0) {
      return;
    }

    overlayElement.videoWidth = videoWidth;
    overlayElement.updatePointSize?.();
  }

  function configureGrid(nextGrid = {}) {
    if (!overlayElement) {
      return;
    }

    const safeGrid = nextGrid && typeof nextGrid === 'object' ? nextGrid : {};

    if ('sampleColCount' in safeGrid) {
      overlayElement.sampleColCount = safeGrid.sampleColCount;
    }

    if ('sampleDiameter' in safeGrid) {
      overlayElement.sampleDiameter = safeGrid.sampleDiameter;
    }

    if ('sampleRowCount' in safeGrid) {
      overlayElement.sampleRowCount = safeGrid.sampleRowCount;
    }

    updatePointSizes();
  }

  function ensureBuilt() {
    updatePointSizes();
  }

  return {
    configureGrid,
    ensureBuilt,
    markChosenSquares,
    setVisible,
    updatePointSizes,
  };
}
