/**
 * Locates where palette colors live in the source frame.
 *
 * For each swatch, scans a sampled grid of pixels and finds the densest
 * cluster of pixels within an RGB threshold of the swatch color, then returns
 * the centroid of that cluster. A plain global centroid would float in empty
 * space whenever a color appears in several separate regions (e.g. red books
 * on one shelf and a red painting across the frame).
 */

const RGB_MATCH_THRESHOLD = 32;
const MAX_SAMPLED_PIXELS = 8000;
// Coarse density grid used to find each color's dominant region.
const CLUSTER_GRID_COLUMNS = 12;
const CLUSTER_GRID_ROWS = 9;
const CLUSTER_CELL_COUNT = CLUSTER_GRID_COLUMNS * CLUSTER_GRID_ROWS;
// Region hysteresis: keep the badge in its current region unless a competing
// region is clearly denser (here: the current one holds less than half the
// challenger's matches). Prevents badges ping-ponging between two areas of
// similar density.
const CLUSTER_STICKINESS_RATIO = 0.5;
// Previous-origin matching tolerance when carrying region state between
// extractions (colors drift slightly frame to frame).
const TRACKER_COLOR_MATCH_THRESHOLD = 48;

function sumCellNeighborhood(values, cell) {
  const row = Math.floor(cell / CLUSTER_GRID_COLUMNS);
  const column = cell % CLUSTER_GRID_COLUMNS;
  let total = 0;

  for (let r = row - 1; r <= row + 1; r += 1) {
    if (r < 0 || r >= CLUSTER_GRID_ROWS) continue;
    for (let c = column - 1; c <= column + 1; c += 1) {
      if (c < 0 || c >= CLUSTER_GRID_COLUMNS) continue;
      total += values[r * CLUSTER_GRID_COLUMNS + c];
    }
  }

  return total;
}

function cellForNormalizedPosition(position) {
  const row = Math.min(CLUSTER_GRID_ROWS - 1, Math.max(0, Math.floor(position.y * CLUSTER_GRID_ROWS)));
  const column = Math.min(
    CLUSTER_GRID_COLUMNS - 1,
    Math.max(0, Math.floor(position.x * CLUSTER_GRID_COLUMNS)),
  );
  return row * CLUSTER_GRID_COLUMNS + column;
}

/**
 * @param {Uint8ClampedArray} imageData RGBA pixels
 * @param {number} width
 * @param {number} height
 * @param {Array<{r: number, g: number, b: number}>} colors
 * @param {Array<{x: number, y: number} | null>} [previousOrigins] last known
 *   position per color (aligned with `colors`); enables region hysteresis
 * @returns {Array<{x: number, y: number} | null>} normalized (0-1) positions,
 *   null when a color has no matching pixels (e.g. a heavily blended swatch)
 */
export function computeSwatchOrigins(imageData, width, height, colors, previousOrigins = null) {
  if (!imageData || width <= 0 || height <= 0 || !Array.isArray(colors) || colors.length === 0) {
    return Array.isArray(colors) ? colors.map(() => null) : [];
  }

  // Per swatch: match count + position sums per grid cell.
  const cellCounts = colors.map(() => new Int32Array(CLUSTER_CELL_COUNT));
  const cellSumsX = colors.map(() => new Float64Array(CLUSTER_CELL_COUNT));
  const cellSumsY = colors.map(() => new Float64Array(CLUSTER_CELL_COUNT));

  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLED_PIXELS));
  const thresholdSquared = RGB_MATCH_THRESHOLD * RGB_MATCH_THRESHOLD;

  for (let i = 0; i < totalPixels; i += stride) {
    const r = imageData[i * 4];
    const g = imageData[i * 4 + 1];
    const b = imageData[i * 4 + 2];
    const x = i % width;
    const y = Math.floor(i / width);
    const cell =
      Math.min(CLUSTER_GRID_ROWS - 1, Math.floor((y / height) * CLUSTER_GRID_ROWS)) *
        CLUSTER_GRID_COLUMNS +
      Math.min(CLUSTER_GRID_COLUMNS - 1, Math.floor((x / width) * CLUSTER_GRID_COLUMNS));

    for (let s = 0; s < colors.length; s += 1) {
      const swatch = colors[s];
      const dr = r - swatch.r;
      const dg = g - swatch.g;
      const db = b - swatch.b;
      if (dr * dr + dg * dg + db * db < thresholdSquared) {
        cellCounts[s][cell] += 1;
        cellSumsX[s][cell] += x;
        cellSumsY[s][cell] += y;
      }
    }
  }

  return colors.map((_, s) => {
    const counts = cellCounts[s];

    // Densest cell is the challenger; the badge must sit on matching pixels.
    let bestCell = -1;
    let bestCount = 0;
    for (let cell = 0; cell < CLUSTER_CELL_COUNT; cell += 1) {
      if (counts[cell] > bestCount) {
        bestCount = counts[cell];
        bestCell = cell;
      }
    }

    if (bestCell < 0) {
      return null;
    }

    // Region hysteresis: if the badge's current region still holds a
    // comparable share of matches, stay there rather than hopping to a
    // marginally denser region elsewhere.
    let chosenCell = bestCell;
    const previousOrigin = previousOrigins?.[s];
    if (previousOrigin) {
      const previousCell = cellForNormalizedPosition(previousOrigin);
      if (previousCell !== bestCell) {
        const previousRegionCount = sumCellNeighborhood(counts, previousCell);
        const bestRegionCount = sumCellNeighborhood(counts, bestCell);
        if (
          previousRegionCount > 0 &&
          previousRegionCount >= bestRegionCount * CLUSTER_STICKINESS_RATIO
        ) {
          chosenCell = previousCell;
        }
      }
    }

    // Blend in the 8 neighboring cells so the position doesn't snap between
    // adjacent cells as the dominant region drifts across a boundary.
    const chosenRow = Math.floor(chosenCell / CLUSTER_GRID_COLUMNS);
    const chosenColumn = chosenCell % CLUSTER_GRID_COLUMNS;
    let clusterCount = 0;
    let clusterSumX = 0;
    let clusterSumY = 0;

    for (let row = chosenRow - 1; row <= chosenRow + 1; row += 1) {
      if (row < 0 || row >= CLUSTER_GRID_ROWS) continue;
      for (let column = chosenColumn - 1; column <= chosenColumn + 1; column += 1) {
        if (column < 0 || column >= CLUSTER_GRID_COLUMNS) continue;
        const cell = row * CLUSTER_GRID_COLUMNS + column;
        clusterCount += counts[cell];
        clusterSumX += cellSumsX[s][cell];
        clusterSumY += cellSumsY[s][cell];
      }
    }

    if (clusterCount === 0) {
      return null;
    }

    return {
      x: clusterSumX / clusterCount / width,
      y: clusterSumY / clusterCount / height,
    };
  });
}

/**
 * Stateful wrapper that carries each color's last known region between
 * extractions (matching previous colors to new ones by RGB distance), so
 * `computeSwatchOrigins` can apply region hysteresis. One instance per
 * extraction context (worker or main-thread fallback).
 */
export function createSwatchOriginTracker() {
  let previousEntries = []; // [{ color, origin }]

  function findPreviousOrigin(color) {
    let bestOrigin = null;
    let bestDistanceSquared = TRACKER_COLOR_MATCH_THRESHOLD * TRACKER_COLOR_MATCH_THRESHOLD;

    for (const entry of previousEntries) {
      const dr = color.r - entry.color.r;
      const dg = color.g - entry.color.g;
      const db = color.b - entry.color.b;
      const distanceSquared = dr * dr + dg * dg + db * db;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestOrigin = entry.origin;
      }
    }

    return bestOrigin;
  }

  function compute(imageData, width, height, colors) {
    const previousOrigins = Array.isArray(colors)
      ? colors.map((color) => (color ? findPreviousOrigin(color) : null))
      : null;

    const origins = computeSwatchOrigins(imageData, width, height, colors, previousOrigins);

    previousEntries = [];
    if (Array.isArray(colors)) {
      for (let i = 0; i < colors.length; i += 1) {
        if (colors[i] && origins[i]) {
          previousEntries.push({ color: { ...colors[i] }, origin: origins[i] });
        }
      }
    }

    return origins;
  }

  function reset() {
    previousEntries = [];
  }

  return { compute, reset };
}

const MARKER_RADIUS = 11;

function getMarkerTextColor(color) {
  const luma = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return luma > 150 ? "#000" : "#fff";
}

/**
 * Draws numbered origin badges (harness style: colored disc, dark ring,
 * numbered label) onto an overlay context sized in CSS pixels. Frozen
 * markers get an extra white ring so a pinned color reads as "locked".
 *
 * @param {CanvasRenderingContext2D} context
 * @param {Array<{x: number, y: number, color: {r: number, g: number, b: number}, label: string | number, frozen?: boolean}>} markers
 *   x/y normalized 0-1
 * @param {number} width  CSS pixel width of the overlay
 * @param {number} height CSS pixel height of the overlay
 */
export function drawOriginMarkers(context, markers, width, height) {
  context.clearRect(0, 0, width, height);

  for (const marker of markers) {
    // Falling badges (clamp: false) are allowed to leave the frame.
    const shouldClamp = marker.clamp !== false;
    const px = shouldClamp
      ? Math.min(width - MARKER_RADIUS, Math.max(MARKER_RADIUS, marker.x * width))
      : marker.x * width;
    const py = shouldClamp
      ? Math.min(height - MARKER_RADIUS, Math.max(MARKER_RADIUS, marker.y * height))
      : marker.y * height;
    const { color } = marker;

    context.save();
    context.translate(px, py);
    context.rotate(marker.rotation ?? 0);
    context.scale(marker.scale ?? 1, marker.scale ?? 1);
    context.globalAlpha = Math.max(0, Math.min(1, marker.alpha ?? 1));

    context.beginPath();
    context.arc(0, 0, MARKER_RADIUS, 0, Math.PI * 2);
    context.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgb(0 0 0 / 80%)";
    context.stroke();

    if (marker.frozen) {
      context.beginPath();
      context.arc(0, 0, MARKER_RADIUS + 3, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = "rgb(255 255 255 / 95%)";
      context.stroke();
    }

    context.fillStyle = getMarkerTextColor(color);
    context.font = "bold 11px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(marker.label), 0, 0);

    context.restore();
  }
}

/** Hit-tests a tap (CSS px) against rendered markers; returns the slot label index or -1. */
export function hitTestOriginMarkers(markers, tapX, tapY, width, height, hitRadius = 22) {
  let bestSlot = -1;
  let bestDistance = hitRadius;

  for (const marker of markers) {
    const px = Math.min(width - MARKER_RADIUS, Math.max(MARKER_RADIUS, marker.x * width));
    const py = Math.min(height - MARKER_RADIUS, Math.max(MARKER_RADIUS, marker.y * height));
    const distance = Math.hypot(px - tapX, py - tapY);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestSlot = marker.slot;
    }
  }

  return bestSlot;
}
