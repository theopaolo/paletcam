/**
 * Standalone extraction lab for comparing legacy, production, direct-grid,
 * fully perceptual grid, and grid-to-production palette pipelines.
 */

import { createColorSmoother } from "./modules/color-smoothing.js";
import { rgbToOklab } from "./modules/color-space-oklch.js";
import {
  alignPaletteToReference,
  DEFAULT_LAB_CONFIG,
  deltaEok,
  LAB_PRESETS,
  labConfigFromSearchParams,
  NEUTRAL_BALANCE_VALUES,
  normalizeLabConfig,
  PIPELINES,
  writeLabConfigToSearchParams,
} from "./modules/debug/extraction-lab-model.js";
import { traceExtraction } from "./modules/debug/extraction-trace.js";
import { createOklabScatter } from "./modules/debug/oklab-scatter.js";
import { suggestSelectorParams } from "./modules/debug/experimental-selector.js";

const ANALYSIS_MAX_DIM = 480;
const SMOOTHING_FACTOR = 0.16;
const CAMERA_FRAME_INTERVAL = 6;
const CAMERA_TARGET_FPS = 1000 / 10;
const SCENE_CHANGE_THRESHOLD = 30;
const SCENE_CHANGE_SAMPLE_STRIDE = 200;
const RGB_MATCH_THRESHOLD = 32;
const PIPELINE_IDS = PIPELINES.map((pipeline) => pipeline.id);

const colorSmoothers = Object.fromEntries(
  PIPELINES.map((pipeline) => [
    pipeline.id,
    createColorSmoother(pipeline.id === "before" ? { colorSpace: "srgb" } : undefined),
  ]),
);

const els = {
  scatter: document.getElementById("scatter"),
  gallery: document.getElementById("gallery"),
  upload: document.getElementById("image-upload"),
  cameraToggle: document.getElementById("camera-toggle"),
  pipelineTabs: document.getElementById("pipeline-tabs"),
  pipelineDescription: document.getElementById("pipeline-description"),
  layerPixels: document.getElementById("layer-pixels"),
  layerCandidates: document.getElementById("layer-candidates"),
  layerSelected: document.getElementById("layer-selected"),
  layerRepulsion: document.getElementById("layer-repulsion"),
  layerPixelLocations: document.getElementById("layer-pixel-locations"),
  preset: document.getElementById("preset"),
  presetDescription: document.getElementById("preset-description"),
  tuningToggle: document.getElementById("tuning-toggle"),
  tuningDrawer: document.getElementById("tuning-drawer"),
  configSummary: document.getElementById("config-summary"),
  copySetup: document.getElementById("copy-setup"),
  resetConfig: document.getElementById("reset-config"),
  swatchCount: document.getElementById("swatch-count"),
  swatchCountNumber: document.getElementById("swatch-count-number"),
  poolSize: document.getElementById("pool-size"),
  poolSizeNumber: document.getElementById("pool-size-number"),
  maxPixels: document.getElementById("max-pixels"),
  maxPixelsNumber: document.getElementById("max-pixels-number"),
  repulsion: document.getElementById("repulsion-radius"),
  repulsionNumber: document.getElementById("repulsion-number"),
  variety: document.getElementById("variety"),
  varietyNumber: document.getElementById("variety-number"),
  tone: document.getElementById("tone"),
  toneNumber: document.getElementById("tone-number"),
  neutralBalance: document.getElementById("neutral-balance"),
  neutralBalanceValue: document.getElementById("neutral-balance-value"),
  autoBias: document.getElementById("auto-bias"),
  smoothToggle: document.getElementById("smooth-toggle"),
  resetView: document.getElementById("reset-view"),
  workspace: document.querySelector(".workspace"),
  stats: document.getElementById("stats"),
  inspector: document.getElementById("inspector"),
  sourceStage: document.getElementById("source-stage"),
  sourcePreview: document.getElementById("source-preview"),
  cameraPreview: document.getElementById("camera-preview"),
  sourceFrame: document.getElementById("source-frame"),
  sourceFrameCanvas: document.getElementById("source-frame-canvas"),
  previewSize: document.getElementById("preview-size"),
  inspectorSize: document.getElementById("inspector-size"),
  comparisonSummary: document.getElementById("comparison-summary"),
  palette: document.getElementById("palette"),
  configReadout: document.getElementById("config-readout"),
  statusMessage: document.getElementById("status-message"),
  overlay: document.getElementById("image-overlay"),
  overlayImg: document.getElementById("image-overlay-img"),
};

const configPairs = {
  swatchCount: [els.swatchCount, els.swatchCountNumber],
  poolSize: [els.poolSize, els.poolSizeNumber],
  maxPixels: [els.maxPixels, els.maxPixelsNumber],
  repulsion: [els.repulsion, els.repulsionNumber],
  variety: [els.variety, els.varietyNumber],
  tone: [els.tone, els.toneNumber],
};

const NEUTRAL_BALANCE_LABELS = Object.freeze({
  color: "Color",
  balanced: "Balanced",
  neutrals: "Neutrals",
});

const scatter = createOklabScatter(els.scatter);
const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const sourceFrameContext = els.sourceFrameCanvas.getContext("2d");

const traces = Object.fromEntries(PIPELINE_IDS.map((id) => [id, null]));
const traceTimings = Object.fromEntries(PIPELINE_IDS.map((id) => [id, 0]));
const previousPipelineColors = Object.fromEntries(PIPELINE_IDS.map((id) => [id, []]));
let activePipelineId = "after";
let activePreset = "balanced";
let lastImageData = null;
let activeThumb = null;
let activeImageName = null;
let galleryItems = [];
let rerunFrame = 0;
let statusTimer = 0;

let cameraStream = null;
let cameraRafId = 0;
let cameraLastExtraction = 0;
let cameraFrame = 0;
let previousFrameData = null;

const frozenSwatches = Object.fromEntries(PIPELINE_IDS.map((id) => [id, new Map()]));

function resetSmoothers() {
  for (const smoother of Object.values(colorSmoothers)) smoother.reset();
  for (const pipelineId of PIPELINE_IDS) previousPipelineColors[pipelineId] = [];
}

function clearFrozenSwatches() {
  for (const frozen of Object.values(frozenSwatches)) frozen.clear();
}

function getConfig() {
  const input = {};
  for (const [key, [, numberInput]] of Object.entries(configPairs)) {
    input[key] = numberInput.value;
  }
  input.neutralBalance = NEUTRAL_BALANCE_VALUES[Number(els.neutralBalance.value)];
  input.auto = els.autoBias.checked;
  input.smooth = els.smoothToggle.checked;
  return normalizeLabConfig(input);
}

function writeConfigInputs(config) {
  const normalized = normalizeLabConfig(config);
  for (const [key, [rangeInput, numberInput]] of Object.entries(configPairs)) {
    rangeInput.value = String(normalized[key]);
    numberInput.value = String(normalized[key]);
  }
  const neutralIndex = NEUTRAL_BALANCE_VALUES.indexOf(normalized.neutralBalance);
  els.neutralBalance.value = String(Math.max(0, neutralIndex));
  els.neutralBalanceValue.value = NEUTRAL_BALANCE_LABELS[normalized.neutralBalance];
  els.neutralBalance.setAttribute(
    "aria-valuetext",
    NEUTRAL_BALANCE_LABELS[normalized.neutralBalance],
  );
  els.autoBias.checked = normalized.auto;
  els.smoothToggle.checked = normalized.smooth;
}

function setPresetState(key) {
  activePreset = key;
  els.preset.value = key;
  els.presetDescription.textContent =
    LAB_PRESETS[key]?.description ?? "Manual or shared configuration.";
}

function markCustom() {
  setPresetState("custom");
}

function renderConfigSummary() {
  const config = getConfig();
  const density = `${Math.round(config.maxPixels / 1000)}k px`;
  els.configSummary.textContent =
    `${config.swatchCount} sw · Analyze ${config.poolSize} · ${density} · ` +
    `Δ ${config.repulsion.toFixed(3)} · Variety ${config.variety} · Tone ${config.tone} · ` +
    `Neutral ${NEUTRAL_BALANCE_LABELS[config.neutralBalance]}`;
}

function updateUrl() {
  renderConfigSummary();
  const params = writeLabConfigToSearchParams(getConfig(), new URLSearchParams(location.search));
  params.set("pipeline", activePipelineId);
  params.set("preset", activePreset);
  params.set("preview", els.previewSize.value);
  params.set("panel", els.inspectorSize.value);
  if (activeImageName) params.set("image", activeImageName);
  else params.delete("image");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setStatus(message, isError = false) {
  window.clearTimeout(statusTimer);
  els.statusMessage.textContent = message;
  els.statusMessage.style.color = isError ? "var(--color-danger-soft)" : "var(--color-text-muted)";
  if (message) {
    statusTimer = window.setTimeout(() => {
      els.statusMessage.textContent = "";
    }, 3000);
  }
}

function applyPreset(key) {
  const preset = LAB_PRESETS[key] ?? LAB_PRESETS.balanced;
  writeConfigInputs(preset.config);
  setPresetState(key in LAB_PRESETS ? key : "balanced");
  if (preset.config.auto) maybeApplyAutoParams();
  clearFrozenSwatches();
  resetSmoothers();
  updateUrl();
  scheduleTrace();
}

function maybeApplyAutoParams() {
  if (!lastImageData || !els.autoBias.checked) return;
  const { variety, distinctness } = suggestSelectorParams(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    Number(els.maxPixelsNumber.value),
  );
  const varietyValue = String(Math.round(variety * 100));
  const distinctnessValue = String(
    normalizeLabConfig({ ...getConfig(), repulsion: distinctness }).repulsion,
  );
  els.variety.value = varietyValue;
  els.varietyNumber.value = varietyValue;
  els.repulsion.value = distinctnessValue;
  els.repulsionNumber.value = distinctnessValue;
}

function getImageData(image) {
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  analysisContext.drawImage(image, 0, 0, width, height);
  return {
    data: analysisContext.getImageData(0, 0, width, height).data,
    width,
    height,
  };
}

function tracePipeline(pipelineId, config) {
  const pipeline = PIPELINES.find((entry) => entry.id === pipelineId);
  const startedAt = performance.now();
  const trace = traceExtraction(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    config.swatchCount,
    {
      quantizedPoolSize: config.poolSize,
      maxQuantizerPixels: config.maxPixels,
    },
    {
      selector: pipeline.selector,
      colorMath: pipeline.colorMath,
      toneSpace: pipeline.toneSpace,
      repulsionRadius: config.repulsion,
      spreadStrength: config.variety / 100,
      tone: config.tone / 100,
      neutralBalance: config.neutralBalance,
      rarityStrength: 0.12,
      previousColors: previousPipelineColors[pipelineId],
    },
  );
  traceTimings[pipelineId] = performance.now() - startedAt;

  const rawColors = trace.selected.map((selected) => ({ ...selected.rgb }));
  previousPipelineColors[pipelineId] = rawColors;
  if (config.smooth && trace.selected.length > 0) {
    const smoothed = colorSmoothers[pipelineId].smooth(rawColors, SMOOTHING_FACTOR);
    trace.selected = trace.selected.map((selected, index) => {
      const rgb = smoothed[index] ?? selected.rgb;
      return { ...selected, rgb, oklab: rgbToOklab(rgb.r, rgb.g, rgb.b) };
    });
  } else {
    colorSmoothers[pipelineId].reset();
  }
  return trace;
}

function scheduleTrace() {
  if (rerunFrame) return;
  rerunFrame = window.requestAnimationFrame(() => {
    rerunFrame = 0;
    rerunTrace();
  });
}

function rerunTrace() {
  if (!lastImageData) return;
  const config = getConfig();
  for (const pipelineId of PIPELINE_IDS) {
    traces[pipelineId] = tracePipeline(pipelineId, config);
  }
  renderAll();
}

function getDisplayedSelection(pipelineId) {
  const selected = traces[pipelineId]?.selected ?? [];
  return selected.map((entry, sourceIndex) => {
    const frozen = frozenSwatches[pipelineId].get(sourceIndex);
    if (!frozen) return { ...entry, sourceIndex };
    return {
      ...entry,
      sourceIndex,
      rgb: frozen,
      oklab: rgbToOklab(frozen.r, frozen.g, frozen.b),
    };
  });
}

function getAlignedSelections() {
  const after = getDisplayedSelection("after");
  return Object.fromEntries(
    PIPELINES.map((pipeline) => [
      pipeline.id,
      pipeline.id === "after"
        ? after
        : alignPaletteToReference(after, getDisplayedSelection(pipeline.id)),
    ]),
  );
}

function setActivePipeline(pipelineId) {
  if (!PIPELINE_IDS.includes(pipelineId)) return;
  activePipelineId = pipelineId;
  for (const tab of els.pipelineTabs.querySelectorAll("[data-pipeline]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.pipeline === pipelineId));
  }
  const pipeline = PIPELINES.find((entry) => entry.id === pipelineId);
  els.pipelineDescription.textContent = pipeline?.description ?? "";
  updateUrl();
  buildScene();
  renderStats();
  renderComparison();
  renderSourceFrame();
}

function buildScene() {
  const trace = traces[activePipelineId];
  if (!trace) return;
  const selected = getDisplayedSelection(activePipelineId);
  const radius = getConfig().repulsion;
  scatter.setScene({
    points: trace.points,
    markers: [
      ...(els.layerCandidates.checked
        ? trace.candidates.map((candidate) => ({
            oklab: candidate.oklab,
            rgb: candidate.rgb,
            radius: 4,
          }))
        : []),
      ...(els.layerSelected.checked
        ? selected.map((entry) => ({
            oklab: entry.oklab,
            rgb: entry.rgb,
            label: entry.index,
            radius: 9,
          }))
        : []),
    ],
    spheres: els.layerRepulsion.checked
      ? selected.map((entry) => ({ oklab: entry.oklab, radius }))
      : [],
    showPoints: els.layerPixels.checked,
    showSpheres: els.layerRepulsion.checked,
    showMarkers: true,
  });
}

function buildStat(label, value) {
  const stat = document.createElement("div");
  stat.className = "stat";
  const labelElement = document.createElement("span");
  labelElement.className = "stat-label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "stat-value";
  valueElement.textContent = value;
  stat.append(labelElement, valueElement);
  return stat;
}

function renderStats() {
  const trace = traces[activePipelineId];
  if (!trace) return;
  const { stats } = trace;
  const pipeline = PIPELINES.find((entry) => entry.id === activePipelineId);
  els.stats.replaceChildren(
    buildStat("Cloud", `L ${(stats.meanL * 100).toFixed(1)}% · C ${stats.meanChroma.toFixed(3)}`),
    buildStat("Distribution", `${stats.pixelCount} px · spread ${stats.spread.toFixed(3)}`),
    buildStat(
      pipeline?.label ?? activePipelineId,
      `${stats.candidateCount} candidates · ${stats.selectedCount} selected`,
    ),
    buildStat(
      "Neutral model",
      stats.neutralCount == null
        ? "Not reported"
        : `${stats.neutralCount} reserved · threshold ${stats.neutralThreshold.toFixed(3)}`,
    ),
  );
}

function summarizeDeltas(reference, candidate) {
  const distances = reference.map((entry, index) => {
    const compared = candidate[index];
    return compared ? deltaEok(entry.rgb, compared.rgb) : 0;
  });
  return {
    mean: distances.reduce((sum, distance) => sum + distance, 0) / (distances.length || 1),
    max: Math.max(0, ...distances),
  };
}

function buildPipelineHeading(pipeline) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pipeline-heading";
  button.classList.toggle("is-active", pipeline.id === activePipelineId);
  button.title = `Inspect ${pipeline.label} in the scatter plot`;
  button.addEventListener("click", () => setActivePipeline(pipeline.id));

  const name = document.createElement("span");
  name.className = "pipeline-name";
  name.textContent = pipeline.shortLabel;
  const meta = document.createElement("span");
  meta.className = "pipeline-meta";
  const candidates = traces[pipeline.id]?.stats.candidateCount ?? 0;
  meta.textContent = `${traceTimings[pipeline.id].toFixed(1)} ms · ${candidates} cand.`;
  button.append(name, meta);
  return button;
}

function toggleFreeze(pipelineId, sourceIndex, rgb) {
  const frozen = frozenSwatches[pipelineId];
  if (frozen.has(sourceIndex)) frozen.delete(sourceIndex);
  else frozen.set(sourceIndex, { ...rgb });
  setActivePipeline(pipelineId);
}

function buildResultCell(pipelineId, entry, rowIndex, reference) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "result-cell";
  cell.classList.toggle("is-active-pipeline", pipelineId === activePipelineId);
  if (!entry) {
    cell.disabled = true;
    cell.textContent = "—";
    return cell;
  }

  const isFrozen = frozenSwatches[pipelineId].has(entry.sourceIndex);
  cell.classList.toggle("is-frozen", isFrozen);
  cell.title = `${isFrozen ? "Unfreeze" : "Freeze"} ${pipelineId} swatch ${rowIndex + 1}`;
  cell.addEventListener("click", () => toggleFreeze(pipelineId, entry.sourceIndex, entry.rgb));

  const color = document.createElement("span");
  color.className = "swatch-color";
  color.style.background = `rgb(${entry.rgb.r} ${entry.rgb.g} ${entry.rgb.b})`;

  const data = document.createElement("span");
  data.className = "swatch-data";
  const slot = document.createElement("span");
  slot.className = "swatch-slot";
  slot.textContent = `#${rowIndex + 1} · ${entry.rgb.r} ${entry.rgb.g} ${entry.rgb.b}`;
  const delta = document.createElement("span");
  delta.className = "swatch-delta";
  delta.textContent =
    pipelineId === "after" || !reference
      ? "Reference"
      : `ΔEOK ${deltaEok(reference.rgb, entry.rgb).toFixed(3)}`;
  data.append(slot, delta);
  cell.append(color, data);
  return cell;
}

function renderComparison() {
  if (!traces.after) return;
  const aligned = getAlignedSelections();
  const deltaSummary = PIPELINES.filter((pipeline) => pipeline.id !== "after")
    .map((pipeline) => {
      const delta = summarizeDeltas(aligned.after, aligned[pipeline.id]);
      return `${pipeline.shortLabel} ${delta.mean.toFixed(3)} / ${delta.max.toFixed(3)}`;
    })
    .join(" · ");
  els.comparisonSummary.textContent = `ΔEOK vs Production, mean / max · ${deltaSummary}. Select a heading to inspect; select a swatch to freeze it.`;

  const fragment = document.createDocumentFragment();
  for (const pipeline of PIPELINES) fragment.append(buildPipelineHeading(pipeline));
  const rowCount = Math.max(...PIPELINE_IDS.map((id) => aligned[id].length));
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const reference = aligned.after[rowIndex];
    for (const pipeline of PIPELINES) {
      fragment.append(
        buildResultCell(pipeline.id, aligned[pipeline.id][rowIndex], rowIndex, reference),
      );
    }
  }
  els.palette.replaceChildren(fragment);
}

function renderConfigReadout() {
  const config = getConfig();
  renderConfigSummary();
  const values = [
    ["Swatches", config.swatchCount],
    ["Analyze", config.poolSize],
    ["Density", config.maxPixels],
    ["Distinctness", config.repulsion.toFixed(3)],
    ["Variety", config.variety],
    ["Tone", config.tone],
    ["Neutral balance", NEUTRAL_BALANCE_LABELS[config.neutralBalance]],
    ["Auto", config.auto ? "On" : "Off"],
    ["Smoothing", config.smooth ? "On" : "Off"],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of values) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    row.append(term, description);
    fragment.append(row);
  }
  els.configReadout.replaceChildren(fragment);
}

function setTuningOpen(isOpen, { restoreFocus = false } = {}) {
  els.tuningDrawer.hidden = !isOpen;
  els.tuningToggle.setAttribute("aria-expanded", String(isOpen));
  els.tuningToggle.title = isOpen ? "Close detailed tuning" : "Open detailed tuning";
  if (restoreFocus) els.tuningToggle.focus();
}

function computeSwatchCentroids(imageData, width, height, swatches) {
  if (!imageData || width <= 0 || height <= 0 || swatches.length === 0) {
    return swatches.map(() => null);
  }
  const sums = swatches.map(() => ({ x: 0, y: 0, count: 0 }));
  const stride = Math.max(1, Math.floor((width * height) / 8000));
  for (let index = 0; index < width * height; index += stride) {
    const r = imageData[index * 4];
    const g = imageData[index * 4 + 1];
    const b = imageData[index * 4 + 2];
    const x = index % width;
    const y = Math.floor(index / width);
    for (let swatchIndex = 0; swatchIndex < swatches.length; swatchIndex++) {
      const swatch = swatches[swatchIndex];
      const dr = r - swatch.r;
      const dg = g - swatch.g;
      const db = b - swatch.b;
      if (dr * dr + dg * dg + db * db < RGB_MATCH_THRESHOLD * RGB_MATCH_THRESHOLD) {
        sums[swatchIndex].x += x;
        sums[swatchIndex].y += y;
        sums[swatchIndex].count += 1;
      }
    }
  }
  return sums.map((sum) =>
    sum.count === 0 ? null : { x: sum.x / sum.count / width, y: sum.y / sum.count / height },
  );
}

function renderSourceFrame() {
  if (!lastImageData || !traces[activePipelineId] || !els.layerPixelLocations.checked) {
    els.sourceFrame.hidden = true;
    return;
  }
  els.sourceFrame.hidden = false;
  const rect = els.sourceStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const canvas = els.sourceFrameCanvas;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  sourceFrameContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  sourceFrameContext.clearRect(0, 0, width, height);

  const sourceAspect = lastImageData.width / lastImageData.height;
  const stageAspect = width / height;
  const displayWidth = sourceAspect > stageAspect ? width : height * sourceAspect;
  const displayHeight = sourceAspect > stageAspect ? width / sourceAspect : height;
  const offsetX = (width - displayWidth) / 2;
  const offsetY = (height - displayHeight) / 2;
  const swatches = getDisplayedSelection(activePipelineId).map((entry) => entry.rgb);
  const centroids = computeSwatchCentroids(
    lastImageData.data,
    lastImageData.width,
    lastImageData.height,
    swatches,
  );

  for (let index = 0; index < centroids.length; index++) {
    const centroid = centroids[index];
    if (!centroid) continue;
    const swatch = swatches[index];
    const x = offsetX + centroid.x * displayWidth;
    const y = offsetY + centroid.y * displayHeight;
    sourceFrameContext.beginPath();
    sourceFrameContext.arc(x, y, 10, 0, Math.PI * 2);
    sourceFrameContext.fillStyle = `rgb(${swatch.r} ${swatch.g} ${swatch.b})`;
    sourceFrameContext.fill();
    sourceFrameContext.lineWidth = 2;
    sourceFrameContext.strokeStyle = "#000";
    sourceFrameContext.stroke();
    sourceFrameContext.fillStyle = "#fff";
    sourceFrameContext.font = "bold 11px monospace";
    sourceFrameContext.textAlign = "center";
    sourceFrameContext.textBaseline = "middle";
    sourceFrameContext.fillText(String(index + 1), x, y);
  }
}

function renderAll() {
  buildScene();
  renderStats();
  renderComparison();
  renderConfigReadout();
  renderSourceFrame();
}

function resizeScatter() {
  const rect = els.scatter.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.scatter.width = Math.round(rect.width * dpr);
  els.scatter.height = Math.round(rect.height * dpr);
  scatter.render();
  renderSourceFrame();
}

function runTrace(image) {
  lastImageData = getImageData(image);
  resetSmoothers();
  clearFrozenSwatches();
  maybeApplyAutoParams();
  updateUrl();
  rerunTrace();
}

function computeFrameDelta(currentData, previousData) {
  if (!previousData || previousData.length !== currentData.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < currentData.length; index += SCENE_CHANGE_SAMPLE_STRIDE) {
    sum += Math.abs(currentData[index] - previousData[index]);
    sum += Math.abs(currentData[index + 1] - previousData[index + 1]);
    sum += Math.abs(currentData[index + 2] - previousData[index + 2]);
    count += 3;
  }
  return count > 0 ? sum / count : 0;
}

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
      setStatus(`Camera unavailable: ${error?.message ?? error}`, true);
      return;
    }
  }
  cameraStream = stream;
  activeImageName = null;
  els.cameraPreview.srcObject = stream;
  await els.cameraPreview.play().catch(() => {});
  els.cameraPreview.hidden = false;
  els.sourcePreview.hidden = true;
  els.cameraToggle.textContent = "Stop camera";
  els.cameraToggle.setAttribute("aria-pressed", "true");
  cameraFrame = 0;
  cameraLastExtraction = 0;
  updateUrl();
  cameraRafId = window.requestAnimationFrame(tickCamera);
}

function stopCamera() {
  if (cameraRafId) window.cancelAnimationFrame(cameraRafId);
  cameraRafId = 0;
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
  }
  cameraStream = null;
  els.cameraPreview.srcObject = null;
  els.cameraPreview.hidden = true;
  els.cameraToggle.textContent = "Camera";
  els.cameraToggle.setAttribute("aria-pressed", "false");
  previousFrameData = null;
  clearFrozenSwatches();
  resetSmoothers();
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
  if (computeFrameDelta(frameData, previousFrameData) > SCENE_CHANGE_THRESHOLD) {
    clearFrozenSwatches();
  }
  previousFrameData = frameData;
  lastImageData = { data: frameData, width, height };
  rerunTrace();
}

function loadImage(src, name = null) {
  stopCamera();
  activeImageName = name;
  els.sourcePreview.src = src;
  els.sourcePreview.hidden = false;
  els.overlayImg.src = src;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => runTrace(image);
  image.onerror = () => setStatus(`Failed to load image: ${src}`, true);
  image.src = src;
}

function setActiveThumb(thumb) {
  activeThumb?.classList.remove("is-active");
  activeThumb = thumb;
  activeThumb?.classList.add("is-active");
}

const CURATED_DEBUG_IMAGES = new Set([
  "01.jpg",
  "08.jpg",
  "14.jpg",
  "17.jpg",
  "23.jpg",
  "fish.jpeg",
  "sleepingcat.jpeg",
  "northern-lights.jpeg",
  "winters-night.jpeg",
  "morts-thriumphans.jpeg",
]);

function activateGalleryItem(index) {
  const item = galleryItems[index];
  if (!item) return;
  setActiveThumb(item.thumb);
  loadImage(item.url, item.name);
  item.thumb.scrollIntoView({ block: "nearest" });
}

async function buildGallery(requestedImage) {
  let entries = [];
  try {
    entries = await (await fetch("/debug/images.json")).json();
  } catch {
    setStatus("Could not load image manifest (/debug/images.json).", true);
    return;
  }
  entries = entries.filter((entry) => !entry.set && CURATED_DEBUG_IMAGES.has(entry.name));
  if (entries.length === 0) {
    setStatus("No images found in public/assets/img.", true);
    return;
  }
  const order = [...CURATED_DEBUG_IMAGES];
  entries.sort((left, right) => order.indexOf(left.name) - order.indexOf(right.name));

  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  galleryItems = entries.map((item, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "thumb";
    thumb.title = `${item.name} · image ${index + 1} of ${entries.length}`;
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.src = item.url;
    image.alt = item.name;
    thumb.append(image);
    thumb.addEventListener("click", () => activateGalleryItem(index));
    grid.append(thumb);
    return { ...item, thumb };
  });
  els.gallery.replaceChildren(grid);
  const initialIndex = Math.max(
    0,
    galleryItems.findIndex((item) => item.name === requestedImage),
  );
  activateGalleryItem(initialIndex);
}

function bindConfigPair(key, rangeInput, numberInput) {
  rangeInput.addEventListener("input", () => {
    numberInput.value = rangeInput.value;
    if (key === "repulsion" || key === "variety") els.autoBias.checked = false;
    if (key === "maxPixels" && els.autoBias.checked) maybeApplyAutoParams();
    markCustom();
    clearFrozenSwatches();
    resetSmoothers();
    updateUrl();
    scheduleTrace();
  });

  const applyNumberValue = () => {
    if (!numberInput.value || !numberInput.validity.valid) return;
    const config = normalizeLabConfig({ ...getConfig(), [key]: numberInput.value });
    rangeInput.value = String(config[key]);
    numberInput.value = String(config[key]);
    if (key === "repulsion" || key === "variety") els.autoBias.checked = false;
    if (key === "maxPixels" && els.autoBias.checked) maybeApplyAutoParams();
    markCustom();
    clearFrozenSwatches();
    resetSmoothers();
    updateUrl();
    scheduleTrace();
  };

  numberInput.addEventListener("input", applyNumberValue);
  numberInput.addEventListener("blur", () => {
    if (!numberInput.value || !numberInput.validity.valid) {
      numberInput.value = rangeInput.value;
    }
  });
}

function applyNeutralBalance() {
  const index = Math.max(
    0,
    Math.min(NEUTRAL_BALANCE_VALUES.length - 1, Number(els.neutralBalance.value)),
  );
  const value = NEUTRAL_BALANCE_VALUES[index];
  const label = NEUTRAL_BALANCE_LABELS[value];
  els.neutralBalanceValue.value = label;
  els.neutralBalance.setAttribute("aria-valuetext", label);
  markCustom();
  clearFrozenSwatches();
  resetSmoothers();
  updateUrl();
  scheduleTrace();
}

function applyWorkspaceSize() {
  document.documentElement.style.setProperty("--lab-source-height", `${els.previewSize.value}px`);
  document.documentElement.style.setProperty(
    "--lab-inspector-width",
    `${els.inspectorSize.value}px`,
  );
  updateUrl();
  window.requestAnimationFrame(resizeScatter);
}

function initializeFromUrl() {
  const params = new URLSearchParams(location.search);
  const hasSharedConfig = [
    "swatchCount",
    "poolSize",
    "maxPixels",
    "repulsion",
    "variety",
    "tone",
    "neutralBalance",
    "auto",
    "smooth",
  ].some((key) => params.has(key));
  const requestedPreset = params.get("preset");
  const requestedPresetConfig = requestedPreset ? LAB_PRESETS[requestedPreset]?.config : null;
  writeConfigInputs(
    hasSharedConfig
      ? labConfigFromSearchParams(params)
      : (requestedPresetConfig ?? DEFAULT_LAB_CONFIG),
  );
  setPresetState(
    requestedPreset && (requestedPreset in LAB_PRESETS || requestedPreset === "custom")
      ? requestedPreset
      : hasSharedConfig
        ? "custom"
        : "balanced",
  );

  const pipeline = params.get("pipeline");
  if (PIPELINE_IDS.includes(pipeline)) activePipelineId = pipeline;
  const preview = Math.max(160, Math.min(420, Number(params.get("preview")) || 260));
  const panel = Math.max(320, Math.min(800, Number(params.get("panel")) || 576));
  els.previewSize.value = String(preview);
  els.inspectorSize.value = String(panel);
  applyWorkspaceSize();
  setActivePipeline(activePipelineId);
  return params.get("image");
}

// Source and camera.
els.sourceStage.addEventListener("click", () => {
  if (els.sourcePreview.hidden) return;
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

// Pipeline and plot controls.
els.pipelineTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pipeline]");
  if (button) setActivePipeline(button.dataset.pipeline);
});
els.resetView.addEventListener("click", () => scatter.resetView());
for (const toggle of [
  els.layerPixels,
  els.layerCandidates,
  els.layerSelected,
  els.layerRepulsion,
]) {
  toggle.addEventListener("change", buildScene);
}
els.layerPixelLocations.addEventListener("change", renderSourceFrame);

// Configuration.
els.preset.addEventListener("change", () => applyPreset(els.preset.value));
els.tuningToggle.addEventListener("click", () => {
  setTuningOpen(els.tuningToggle.getAttribute("aria-expanded") !== "true");
});
for (const [key, pair] of Object.entries(configPairs)) bindConfigPair(key, ...pair);
els.neutralBalance.addEventListener("input", applyNeutralBalance);
els.autoBias.addEventListener("change", () => {
  if (els.autoBias.checked) maybeApplyAutoParams();
  markCustom();
  resetSmoothers();
  updateUrl();
  scheduleTrace();
});
els.smoothToggle.addEventListener("change", () => {
  markCustom();
  resetSmoothers();
  updateUrl();
  scheduleTrace();
});
els.copySetup.addEventListener("click", async () => {
  updateUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus("Setup link copied.");
  } catch {
    setStatus("Clipboard unavailable. Copy the URL from the address bar.", true);
  }
});
els.resetConfig.addEventListener("click", () => applyPreset("balanced"));
els.workspace.addEventListener("pointerdown", () => setTuningOpen(false));

// Workspace geometry.
els.previewSize.addEventListener("input", applyWorkspaceSize);
els.inspectorSize.addEventListener("input", applyWorkspaceSize);
window.addEventListener("resize", resizeScatter);
new ResizeObserver(() => renderSourceFrame()).observe(els.sourceStage);

// Keyboard shortcuts are intentionally limited to non-form focus.
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.tuningToggle.getAttribute("aria-expanded") === "true") {
    setTuningOpen(false, { restoreFocus: true });
    return;
  }
  if (event.target.closest("input, select, button")) return;
  if (event.key >= "1" && event.key <= String(PIPELINE_IDS.length)) {
    setActivePipeline(PIPELINE_IDS[Number(event.key) - 1]);
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const currentIndex = galleryItems.findIndex((item) => item.thumb === activeThumb);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    activateGalleryItem((currentIndex + direction + galleryItems.length) % galleryItems.length);
  }
});

const requestedImage = initializeFromUrl();
resizeScatter();
buildGallery(requestedImage);
