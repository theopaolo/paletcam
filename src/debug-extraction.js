/**
 * Standalone harness for inspecting the palette-extraction pipeline in OKLab.
 * Served at /debug-extraction.html. Not part of the app bundle.
 */

import { createOklabScatter } from "./modules/debug/oklab-scatter.js";
import { traceExtraction } from "./modules/debug/extraction-trace.js";
import { suggestSelectorParams } from "./modules/debug/experimental-selector.js";
import { createColorSmoother } from "./modules/color-smoothing.js";

const ANALYSIS_MAX_DIM = 480;
const SMOOTHING_FACTOR = 0.16;

const colorSmoother = createColorSmoother();

const els = {
  scatter: document.getElementById("scatter"),
  gallery: document.getElementById("gallery"),
  upload: document.getElementById("image-upload"),
  swatchCount: document.getElementById("swatch-count"),
  swatchCountValue: document.getElementById("swatch-count-value"),
  repulsion: document.getElementById("repulsion-radius"),
  repulsionValue: document.getElementById("repulsion-value"),
  selector: document.getElementById("selector"),
  layerPixels: document.getElementById("layer-pixels"),
  layerCandidates: document.getElementById("layer-candidates"),
  layerSelected: document.getElementById("layer-selected"),
  layerRepulsion: document.getElementById("layer-repulsion"),
  stats: document.getElementById("stats"),
  palette: document.getElementById("palette"),
  sourcePreview: document.getElementById("source-preview"),
  cameraPreview: document.getElementById("camera-preview"),
  cameraToggle: document.getElementById("camera-toggle"),
  sourceFrame: document.getElementById("source-frame"),
  sourceFrameCanvas: document.getElementById("source-frame-canvas"),
  layerPixelLocations: document.getElementById("layer-pixel-locations"),
  overlay: document.getElementById("image-overlay"),
  overlayImg: document.getElementById("image-overlay-img"),
  weightChroma: document.getElementById("weight-chroma"),
  weightChromaValue: document.getElementById("weight-chroma-value"),
  weightLuma: document.getElementById("weight-luma"),
  weightLumaValue: document.getElementById("weight-luma-value"),
  weightRarity: document.getElementById("weight-rarity"),
  weightRarityValue: document.getElementById("weight-rarity-value"),
  weightDiversity: document.getElementById("weight-diversity"),
  weightDiversityValue: document.getElementById("weight-diversity-value"),
  poolSize: document.getElementById("pool-size"),
  poolSizeValue: document.getElementById("pool-size-value"),
  maxPixels: document.getElementById("max-pixels"),
  maxPixelsValue: document.getElementById("max-pixels-value"),
  variety: document.getElementById("variety"),
  varietyValue: document.getElementById("variety-value"),
  tone: document.getElementById("tone"),
  toneValue: document.getElementById("tone-value"),
  autoBias: document.getElementById("auto-bias"),
  smoothToggle: document.getElementById("smooth-toggle"),
  currentControls: document.getElementById("current-controls"),
  newControls: document.getElementById("new-controls"),
};

const scatter = createOklabScatter(els.scatter);
const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });

let lastTrace = null;
let lastImageData = null;
let activeThumb = null;

// Mirrors the live pipeline's option shape, fed from the tuning sliders.
function getExtractionOptions() {
  return {
    scoring: {
      chromaWeight: Number(els.weightChroma.value),
      lumaSpreadWeight: Number(els.weightLuma.value),
      rarityWeight: Number(els.weightRarity.value),
      diversityWeight: Number(els.weightDiversity.value),
    },
    quantizedPoolSize: Number(els.poolSize.value),
    maxQuantizerPixels: Number(els.maxPixels.value),
  };
}

function getDebugOptions() {
  return {
    selector: els.selector.value,
    repulsionRadius: Number(els.repulsion.value), // Distinctness
    spreadStrength: Number(els.variety.value) / 100, // Variety
    tone: Number(els.tone.value) / 100,
    rarityStrength: 0.12, // fixed: a mild accent boost, not a user knob
  };
}

// New/Hybrid modes show Variety / Tone / Auto; Current shows the scorer weights.
function syncSelectorMode() {
  const isNew = els.selector.value === "new" || els.selector.value === "hybrid";
  els.currentControls.hidden = isNew;
  els.newControls.hidden = !isNew;
}

// David's "preset from the image": when Auto is on, derive Variety + Distinctness
// from the current image so good output needs no manual tuning.
function maybeApplyAutoParams() {
  if (!lastImageData || (els.selector.value !== "new" && els.selector.value !== "hybrid") || !els.autoBias.checked) return;
  const { variety, distinctness } = suggestSelectorParams(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    Number(els.maxPixels.value),
  );
  els.variety.value = String(Math.round(variety * 100));
  els.varietyValue.textContent = els.variety.value;
  els.repulsion.value = distinctness.toFixed(3);
  els.repulsionValue.textContent = distinctness.toFixed(3);
}

function resizeScatter() {
  const rect = els.scatter.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.scatter.width = Math.round(rect.width * dpr);
  els.scatter.height = Math.round(rect.height * dpr);
  scatter.render();
}

function getImageData(image) {
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  analysisContext.drawImage(image, 0, 0, width, height);
  return { data: analysisContext.getImageData(0, 0, width, height).data, width, height };
}

function buildScene() {
  if (!lastTrace) return;
  const radius = Number(els.repulsion.value);

  scatter.setScene({
    points: lastTrace.points,
    markers: [
      ...(els.layerCandidates.checked
        ? lastTrace.candidates.map((c) => ({ oklab: c.oklab, rgb: c.rgb, radius: 4 }))
        : []),
      ...(els.layerSelected.checked
        ? lastTrace.selected.map((s) => ({ oklab: s.oklab, rgb: s.rgb, label: s.index, radius: 9 }))
        : []),
    ],
    spheres: els.layerRepulsion.checked
      ? lastTrace.selected.map((s) => ({ oklab: s.oklab, radius }))
      : [],
    showPoints: els.layerPixels.checked,
    showSpheres: els.layerRepulsion.checked,
    showMarkers: true,
  });
}

function renderStats() {
  if (!lastTrace) return;
  const { stats } = lastTrace;
  const neutralLine =
    stats.neutralCount != null
      ? `\nreserved neutrals: ${stats.neutralCount}  •  neutral thr: ${stats.neutralThreshold.toFixed(3)}`
      : "";

  els.stats.textContent =
    `Lightness: ${(stats.meanL * 100).toFixed(1)}%  •  ` +
    `Chroma: ${stats.meanChroma.toFixed(3)}  •  ` +
    `Spread: ${stats.spread.toFixed(3)}  •  ` +
    `Sparse: ${stats.sparse ? "Yes" : "No"}\n` +
    `${stats.pixelCount} pixels  •  ${stats.candidateCount} candidates  •  ` +
    `${stats.selectedCount} selected  •  repulsion r=${Number(els.repulsion.value).toFixed(3)}` +
    neutralLine;

  const displayColors = lastTrace.selected.map((s, i) => {
    const frozen = frozenSwatches.get(i);
    return { rgb: frozen ?? s.rgb, frozen: Boolean(frozen), index: i };
  });

  const existing = els.palette.querySelectorAll(".swatch");
  if (existing.length !== displayColors.length) {
    els.palette.replaceChildren(
      ...displayColors.map((entry) => buildSwatch(entry.index)),
    );
  }
  paintSwatches(displayColors);
}

function buildSwatch(slotIndex) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "swatch";
  cell.dataset.slot = String(slotIndex);
  cell.addEventListener("click", () => toggleFreeze(slotIndex));
  return cell;
}

function paintSwatches(displayColors) {
  els.palette.querySelectorAll(".swatch").forEach((cell, i) => {
    const entry = displayColors[i];
    if (!entry) return;
    const { rgb, frozen } = entry;
    cell.classList.toggle("is-frozen", frozen);
    cell.style.background = `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
    cell.title = frozen
      ? `#${i + 1} FROZEN rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) — click to unfreeze`
      : `#${i + 1} rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) — click to freeze`;
  });
}

const sourceFrameContext = els.sourceFrameCanvas.getContext("2d");
const RGB_MATCH_THRESHOLD = 32;
const SOURCE_FRAME_WIDTH = 200;
const SOURCE_FRAME_HEIGHT = 150;

function computeSwatchCentroids(imageData, width, height, swatches) {
  if (!imageData || width <= 0 || height <= 0 || swatches.length === 0) {
    return swatches.map(() => null);
  }

  const sums = swatches.map(() => ({ x: 0, y: 0, count: 0 }));
  const stride = Math.max(1, Math.floor((width * height) / 8000));
  for (let i = 0; i < width * height; i += stride) {
    const r = imageData[i * 4];
    const g = imageData[i * 4 + 1];
    const b = imageData[i * 4 + 2];
    const x = i % width;
    const y = Math.floor(i / width);
    for (let s = 0; s < swatches.length; s++) {
      const sw = swatches[s];
      const dr = r - sw.r;
      const dg = g - sw.g;
      const db = b - sw.b;
      if (dr * dr + dg * dg + db * db < RGB_MATCH_THRESHOLD * RGB_MATCH_THRESHOLD) {
        sums[s].x += x;
        sums[s].y += y;
        sums[s].count += 1;
      }
    }
  }

  return sums.map((s) => {
    if (s.count === 0) return null;
    return {
      x: (s.x / s.count) / width,
      y: (s.y / s.count) / height,
    };
  });
}

function renderSourceFrame() {
  if (!lastImageData || !lastTrace || !els.layerPixelLocations.checked) {
    els.sourceFrame.hidden = true;
    return;
  }
  els.sourceFrame.hidden = false;
  const canvas = els.sourceFrameCanvas;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SOURCE_FRAME_WIDTH * dpr;
  canvas.height = SOURCE_FRAME_HEIGHT * dpr;
  sourceFrameContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  sourceFrameContext.clearRect(0, 0, SOURCE_FRAME_WIDTH, SOURCE_FRAME_HEIGHT);

  const swatches = lastTrace.selected.map((s, i) => {
    const frozen = frozenSwatches.get(i);
    return frozen ?? s.rgb;
  });

  const centroids = computeSwatchCentroids(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    swatches,
  );

  for (let i = 0; i < centroids.length; i++) {
    const c = centroids[i];
    const sw = swatches[i];
    if (!c) continue;
    const px = c.x * SOURCE_FRAME_WIDTH;
    const py = c.y * SOURCE_FRAME_HEIGHT;

    sourceFrameContext.beginPath();
    sourceFrameContext.arc(px, py, 10, 0, Math.PI * 2);
    sourceFrameContext.fillStyle = `rgb(${sw.r} ${sw.g} ${sw.b})`;
    sourceFrameContext.fill();
    sourceFrameContext.lineWidth = 2;
    sourceFrameContext.strokeStyle = "#000";
    sourceFrameContext.stroke();

    sourceFrameContext.fillStyle = "#fff";
    sourceFrameContext.font = "bold 11px monospace";
    sourceFrameContext.textAlign = "center";
    sourceFrameContext.textBaseline = "middle";
    sourceFrameContext.fillText(String(i + 1), px, py);
  }
}

function toggleFreeze(slotIndex) {
  if (frozenSwatches.has(slotIndex)) {
    frozenSwatches.delete(slotIndex);
  } else {
    const swatch = lastTrace?.selected?.[slotIndex];
    if (swatch) frozenSwatches.set(slotIndex, { ...swatch.rgb });
  }
  renderStats();
}

function applyFrozenSwatches() {
  if (frozenSwatches.size === 0 || !lastTrace) return;
  lastTrace = {
    ...lastTrace,
    selected: lastTrace.selected.map((s, i) => {
      const frozen = frozenSwatches.get(i);
      return frozen ? { ...s, rgb: frozen } : s;
    }),
  };
}

function computeFrameDelta(currentData, prevData) {
  if (!prevData || prevData.length !== currentData.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < currentData.length; i += SCENE_CHANGE_SAMPLE_STRIDE) {
    sum += Math.abs(currentData[i] - prevData[i]);
    sum += Math.abs(currentData[i + 1] - prevData[i + 1]);
    sum += Math.abs(currentData[i + 2] - prevData[i + 2]);
    count += 3;
  }
  return count > 0 ? sum / count : 0;
}

function rerunTrace() {
  if (!lastImageData) return;
  const swatchCount = Number(els.swatchCount.value);
  const trace = traceExtraction(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    swatchCount,
    getExtractionOptions(),
    getDebugOptions(),
  );

  if (els.smoothToggle.checked && trace.selected.length > 0) {
    const rawColors = trace.selected.map((s) => ({ ...s.rgb }));
    const smoothed = colorSmoother.smooth(rawColors, SMOOTHING_FACTOR);
    trace.selected = trace.selected.map((s, i) => ({ ...s, rgb: smoothed[i] ?? s.rgb }));
  } else {
    colorSmoother.reset();
  }

  lastTrace = trace;
  applyFrozenSwatches();
  buildScene();
  renderStats();
  renderSourceFrame();
}

function runTrace(image) {
  lastImageData = getImageData(image);
  colorSmoother.reset();
  maybeApplyAutoParams();
  rerunTrace();
}

const CAMERA_FRAME_INTERVAL = 6;
const CAMERA_TARGET_FPS = 1000 / 10;
const SCENE_CHANGE_THRESHOLD = 30;
const SCENE_CHANGE_SAMPLE_STRIDE = 200;

let cameraStream = null;
let cameraRafId = 0;
let cameraLastExtraction = 0;
let cameraFrame = 0;
let previousFrameData = null;
const frozenSwatches = new Map();

async function startCamera() {
  if (cameraStream) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (error) {
      els.stats.textContent = `Camera unavailable: ${error?.message ?? error}`;
      return;
    }
  }
  cameraStream = stream;
  els.cameraPreview.srcObject = stream;
  await els.cameraPreview.play().catch(() => {});
  els.cameraPreview.hidden = false;
  els.sourcePreview.hidden = true;
  els.cameraToggle.textContent = "Stop camera";
  els.cameraToggle.setAttribute("aria-pressed", "true");
  cameraFrame = 0;
  cameraLastExtraction = 0;
  cameraRafId = window.requestAnimationFrame(tickCamera);
}

function stopCamera() {
  if (cameraRafId) {
    window.cancelAnimationFrame(cameraRafId);
    cameraRafId = 0;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  els.cameraPreview.srcObject = null;
  els.cameraPreview.hidden = true;
  els.cameraToggle.textContent = "Camera";
  els.cameraToggle.setAttribute("aria-pressed", "false");
  previousFrameData = null;
  frozenSwatches.clear();
  colorSmoother.reset();
}

function tickCamera(now) {
  if (!cameraStream) return;
  cameraRafId = window.requestAnimationFrame(tickCamera);
  cameraFrame += 1;
  if (cameraFrame % CAMERA_FRAME_INTERVAL !== 0) return;
  if (now - cameraLastExtraction < CAMERA_TARGET_FPS) return;
  cameraLastExtraction = now;

  const video = els.cameraPreview;
  if (!video.videoWidth || !video.videoHeight) return;

  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  analysisContext.drawImage(video, 0, 0, width, height);
  const frameData = analysisContext.getImageData(0, 0, width, height).data;
  const delta = computeFrameDelta(frameData, previousFrameData);
  if (delta > SCENE_CHANGE_THRESHOLD && frozenSwatches.size > 0) {
    frozenSwatches.clear();
  }
  previousFrameData = frameData;
  lastImageData = { data: frameData, width, height };
  rerunTrace();
}

function loadImage(src) {
  stopCamera();
  els.sourcePreview.src = src;
  els.sourcePreview.hidden = false;
  els.overlayImg.src = src;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => runTrace(image);
  image.onerror = () => {
    els.stats.textContent = `Failed to load image: ${src}`;
  };
  image.src = src;
}

function setActiveThumb(thumb) {
  activeThumb?.classList.remove("is-active");
  activeThumb = thumb;
  thumb?.classList.add("is-active");
}

async function buildGallery() {
  let entries = [];
  try {
    entries = await (await fetch("/debug/images.json")).json();
  } catch {
    els.stats.textContent = "Could not load image manifest (/debug/images.json).";
    return;
  }
  if (entries.length === 0) {
    els.stats.textContent = "No images found in public/assets/img.";
    return;
  }

  // Group by set; loose top-level images go first under "img/".
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.set || "img/";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const fragment = document.createDocumentFragment();
  let firstThumb = null;
  let firstSrc = null;

  for (const [label, items] of groups) {
    const heading = document.createElement("div");
    heading.className = "gallery-group-label";
    heading.textContent = label;
    fragment.append(heading);

    const grid = document.createElement("div");
    grid.className = "gallery-grid";
    for (const item of items) {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "thumb";
      thumb.title = `${item.set ? `${item.set} / ` : ""}${item.name}`;

      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = item.url;
      img.alt = item.name;
      thumb.append(img);

      thumb.addEventListener("click", () => {
        setActiveThumb(thumb);
        loadImage(item.url);
      });

      grid.append(thumb);
      if (!firstThumb) {
        firstThumb = thumb;
        firstSrc = item.url;
      }
    }
    fragment.append(grid);
  }

  els.gallery.replaceChildren(fragment);

  if (firstThumb) {
    setActiveThumb(firstThumb);
    loadImage(firstSrc);
  }
}

// --- wiring ---
els.sourcePreview.addEventListener("click", () => {
  els.overlay.hidden = false;
});
els.overlay.addEventListener("click", () => {
  els.overlay.hidden = true;
});

els.upload.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setActiveThumb(null);
  loadImage(URL.createObjectURL(file));
});

els.cameraToggle.addEventListener("click", () => {
  if (cameraStream) stopCamera();
  else startCamera();
});

els.swatchCount.addEventListener("input", () => {
  els.swatchCountValue.textContent = els.swatchCount.value;
  frozenSwatches.clear();
  colorSmoother.reset();
  rerunTrace();
});

els.repulsion.addEventListener("input", () => {
  els.repulsionValue.textContent = Number(els.repulsion.value).toFixed(3);
  // In "new" mode the radius IS the Distinctness control, so re-trace; a manual
  // move counts as an override, so turn Auto off.
  if (els.selector.value === "new" || els.selector.value === "hybrid") {
    els.autoBias.checked = false;
    rerunTrace();
  } else {
    buildScene();
    renderStats();
  }
});

els.selector.addEventListener("change", () => {
  syncSelectorMode();
  colorSmoother.reset();
  maybeApplyAutoParams();
  rerunTrace();
});

// New-mode controls.
els.variety.addEventListener("input", () => {
  els.varietyValue.textContent = els.variety.value;
  els.autoBias.checked = false; // manual override
  rerunTrace();
});
els.tone.addEventListener("input", () => {
  els.toneValue.textContent = els.tone.value;
  rerunTrace();
});
els.autoBias.addEventListener("change", () => {
  if (els.autoBias.checked) maybeApplyAutoParams();
  rerunTrace();
});

// Tuning sliders mirror the live app's controls; re-trace live so their
// effect on candidates and selection is visible.
for (const [slider, valueEl] of [
  [els.weightChroma, els.weightChromaValue],
  [els.weightLuma, els.weightLumaValue],
  [els.weightRarity, els.weightRarityValue],
  [els.weightDiversity, els.weightDiversityValue],
  [els.poolSize, els.poolSizeValue],
  [els.maxPixels, els.maxPixelsValue],
]) {
  slider.addEventListener("input", () => {
    valueEl.textContent = slider.value;
    rerunTrace();
  });
}

for (const toggle of [els.layerPixels, els.layerCandidates, els.layerSelected, els.layerRepulsion, els.layerPixelLocations]) {
  toggle.addEventListener("change", () => {
    if (toggle === els.layerPixelLocations) {
      renderSourceFrame();
    } else {
      buildScene();
    }
  });
}

window.addEventListener("resize", resizeScatter);

resizeScatter();
syncSelectorMode();
els.swatchCountValue.textContent = els.swatchCount.value;
els.repulsionValue.textContent = Number(els.repulsion.value).toFixed(3);
els.varietyValue.textContent = els.variety.value;
els.toneValue.textContent = els.tone.value;
buildGallery();
