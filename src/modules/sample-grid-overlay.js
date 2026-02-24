import {
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_ROW_COUNT,
} from './palette-extract-grid.js';

export function createSampleGridOverlayController({
  overlayElement,
  cameraFeed,
  sampleColCount = SAMPLE_COL_COUNT,
  sampleDiameter = SAMPLE_DIAMETER,
  sampleRowCount = SAMPLE_ROW_COUNT,
} = {}) {
  let overlayBuilt = false;
  let currentSampleColCount = Math.max(1, Math.floor(sampleColCount) || SAMPLE_COL_COUNT);
  let currentSampleDiameter = Math.max(1, Math.floor(sampleDiameter) || SAMPLE_DIAMETER);
  let currentSampleRowCount = Math.max(1, Math.floor(sampleRowCount) || SAMPLE_ROW_COUNT);

  function rebuildOverlay() {
    if (!overlayElement) {
      overlayBuilt = false;
      return;
    }

    overlayElement.innerHTML = '';
    overlayBuilt = false;
  }

  function markChosenSquares(chosenIndices = []) {
    if (!overlayElement) {
      return;
    }

    const safeChosenIndices = Array.isArray(chosenIndices) ? chosenIndices : [];
    const chosenSet = new Set(safeChosenIndices.map(String));

    overlayElement.querySelectorAll('.sample-row-point').forEach((element) => {
      element.classList.toggle('is-chosen', chosenSet.has(element.dataset.gridIndex));
    });
  }

  function setVisible(isVisible) {
    if (!overlayElement) {
      return;
    }

    overlayElement.style.display = isVisible ? '' : 'none';

    if (!isVisible) {
      markChosenSquares([]);
    }
  }

  function updatePointSizes() {
    if (!overlayElement || !cameraFeed) {
      return;
    }

    const videoWidth = cameraFeed.videoWidth;
    if (videoWidth <= 0) {
      return;
    }

    const displayWidth = overlayElement.offsetWidth;
    const scale = displayWidth / videoWidth;
    const size = Math.max(2, Math.round(currentSampleDiameter * scale));

    overlayElement.style.setProperty('--sample-size', `${size}px`);
  }

  function configureGrid({
    sampleColCount: nextSampleColCount = currentSampleColCount,
    sampleDiameter: nextSampleDiameter = currentSampleDiameter,
    sampleRowCount: nextSampleRowCount = currentSampleRowCount,
  } = {}) {
    const normalizedSampleColCount = Math.max(1, Math.floor(nextSampleColCount) || currentSampleColCount);
    const normalizedSampleDiameter = Math.max(1, Math.floor(nextSampleDiameter) || currentSampleDiameter);
    const normalizedSampleRowCount = Math.max(1, Math.floor(nextSampleRowCount) || currentSampleRowCount);

    const hasChanged = (
      normalizedSampleColCount !== currentSampleColCount ||
      normalizedSampleDiameter !== currentSampleDiameter ||
      normalizedSampleRowCount !== currentSampleRowCount
    );

    if (!hasChanged) {
      return;
    }

    currentSampleColCount = normalizedSampleColCount;
    currentSampleDiameter = normalizedSampleDiameter;
    currentSampleRowCount = normalizedSampleRowCount;
    rebuildOverlay();
  }

  function ensureBuilt() {
    if (!overlayElement || overlayBuilt) {
      return;
    }

    overlayBuilt = true;

    for (let row = 0; row < currentSampleRowCount; row += 1) {
      const rowPercent = ((row + 1) / (currentSampleRowCount + 1)) * 100;

      const line = document.createElement('div');
      line.className = 'sample-row-line';
      line.style.top = `${rowPercent}%`;
      overlayElement.appendChild(line);

      for (let col = 0; col < currentSampleColCount; col += 1) {
        const square = document.createElement('div');
        square.className = 'sample-row-point';
        square.dataset.gridIndex = String((col * currentSampleRowCount) + row);
        square.style.left = `${((col + 0.5) / currentSampleColCount) * 100}%`;
        square.style.top = `${rowPercent}%`;
        overlayElement.appendChild(square);
      }
    }

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
