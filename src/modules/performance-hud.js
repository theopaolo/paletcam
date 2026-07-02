import { css, html, LitElement } from "lit";
import { subscribeLocaleChange, t } from "../i18n.js";

const HUD_UPDATE_INTERVAL_MS = 250;
const MEMORY_SAMPLE_INTERVAL_MS = 2000;
const AVERAGE_BLEND_FACTOR = 0.18;
const PERFORMANCE_HUD_TAG = "performance-hud";
const POSITION_STORAGE_KEY = "paletcam:performance-hud-position:v1";
const VIEWPORT_PADDING_PX = 8;
const HUD_FIELDS = [
  ["fps", "fpsLabel"],
  ["frame", "frameLabel"],
  ["extract", "extractLabel"],
  ["interval", "intervalLabel"],
  ["longTask", "longTaskLabel"],
  ["heap", "heapLabel"],
  ["camera", "cameraLabel"],
  ["analysis", "analysisLabel"],
  ["mode", "modeLabel"],
  ["thermal", "thermalLabel"],
];

function createDefaultMetrics() {
  return {
    analysisLabel: "n/a",
    cameraLabel: "n/a",
    extractLabel: "n/a",
    fpsLabel: "0",
    frameLabel: "n/a",
    heapLabel: "n/a",
    intervalLabel: "1/4",
    longTaskLabel: "0",
    modeLabel: t("hud.state.idle"),
    streamLabel: t("hud.state.paused"),
    thermalLabel: "n/a",
  };
}

function blendAverage(currentValue, nextValue) {
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    return currentValue;
  }

  if (!Number.isFinite(currentValue) || currentValue <= 0) {
    return nextValue;
  }

  return currentValue + (nextValue - currentValue) * AVERAGE_BLEND_FACTOR;
}

function formatResolution(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "n/a";
  }

  return `${Math.round(width)}x${Math.round(height)}`;
}

function formatFps(frameDurationMs) {
  if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
    return "0";
  }

  return (1000 / frameDurationMs).toFixed(1);
}

function formatMilliseconds(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }

  return `${value.toFixed(1)} ms`;
}

function formatMegabytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "n/a";
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCameraFps(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "n/a";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} fps`;
}

function supportsLongTaskObserver() {
  return (
    typeof PerformanceObserver === "function" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
  );
}

function readHeapMetrics() {
  const memory =
    /** @type {Performance & { memory?: { usedJSHeapSize?: number, jsHeapSizeLimit?: number } }} */ (
      performance
    ).memory;

  return {
    limit: memory?.jsHeapSizeLimit ?? null,
    used: memory?.usedJSHeapSize ?? null,
  };
}

function clampPosition(value, maxValue) {
  if (!Number.isFinite(value)) {
    return VIEWPORT_PADDING_PX;
  }

  return Math.min(Math.max(VIEWPORT_PADDING_PX, value), Math.max(VIEWPORT_PADDING_PX, maxValue));
}

function readStoredPosition() {
  try {
    const rawValue = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) {
      return null;
    }

    return {
      x: parsed.x,
      y: parsed.y,
    };
  } catch (_error) {
    return null;
  }
}

function persistPosition(position) {
  try {
    if (!position) {
      localStorage.removeItem(POSITION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch (_error) {
    // Ignore persistence failures in private mode / storage-restricted contexts.
  }
}

class PerformanceHudElement extends LitElement {
  static properties = {
    hasCustomPosition: { attribute: false, type: Boolean },
    metrics: { attribute: false },
    positionX: { attribute: false, type: Number },
    positionY: { attribute: false, type: Number },
  };

  static styles = css`
    :host {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + var(--space-16));
      right: min(var(--space-16), 3vw);
      z-index: 1300;
      display: block;
      width: min(15rem, calc(100vw - var(--space-24)));
      pointer-events: none;
    }

    :host([hidden]) {
      display: none;
    }

    .hud-shell {
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
      background:
        linear-gradient(180deg, var(--color-surface-overlay), rgba(0, 0, 0, 0.82)),
        var(--color-surface-overlay);
      box-shadow:
        0 0.8rem 2rem rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
      color: var(--color-text-secondary);
      backdrop-filter: blur(10px);
      font-family: var(--font-family-mono);
    }

    .hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-16);
      padding: var(--space-16) var(--space-16) var(--space-8);
      font-size: var(--font-size-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: grab;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
    }

    :host([data-dragging="true"]) .hud-header {
      cursor: grabbing;
    }

    .hud-pill {
      padding: 2px var(--space-8);
      border-radius: var(--radius-pill);
      background: var(--color-accent-dim);
      color: var(--color-accent-soft);
    }

    .hud-grid {
      margin: 0;
      padding: 0 var(--space-16) var(--space-16);
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-8) var(--space-16);
    }

    .hud-grid div {
      min-width: 0;
    }

    dt {
      margin: 0 0 2px;
      font-size: var(--font-size-xs);
      opacity: 0.62;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    dd {
      margin: 0;
      font-size: var(--font-size-sm);
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  constructor() {
    super();
    this.metrics = createDefaultMetrics();
    this.hasCustomPosition = false;
    this.positionX = 0;
    this.positionY = 0;
    this.dragPointerId = null;
    this.dragOriginX = 0;
    this.dragOriginY = 0;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.handleWindowPointerMove = this.handleWindowPointerMove.bind(this);
    this.handleWindowPointerUp = this.handleWindowPointerUp.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.unsubscribeLocaleChange = subscribeLocaleChange(() => {
      this.requestUpdate();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    const storedPosition = readStoredPosition();
    if (storedPosition) {
      this.hasCustomPosition = true;
      this.positionX = storedPosition.x;
      this.positionY = storedPosition.y;
    }

    window.addEventListener("pointermove", this.handleWindowPointerMove);
    window.addEventListener("pointerup", this.handleWindowPointerUp);
    window.addEventListener("pointercancel", this.handleWindowPointerUp);
    window.addEventListener("resize", this.handleWindowResize);
  }

  disconnectedCallback() {
    window.removeEventListener("pointermove", this.handleWindowPointerMove);
    window.removeEventListener("pointerup", this.handleWindowPointerUp);
    window.removeEventListener("pointercancel", this.handleWindowPointerUp);
    window.removeEventListener("resize", this.handleWindowResize);
    this.unsubscribeLocaleChange?.();
    super.disconnectedCallback();
  }

  firstUpdated() {
    if (!this.hasCustomPosition) {
      return;
    }

    this.applyClampedPosition();
  }

  updated(changedProperties) {
    if (
      changedProperties.has("hasCustomPosition") ||
      changedProperties.has("positionX") ||
      changedProperties.has("positionY")
    ) {
      this.syncPositionStyles();
    }
  }

  syncPositionStyles() {
    if (!this.hasCustomPosition) {
      this.style.removeProperty("left");
      this.style.removeProperty("top");
      this.style.removeProperty("right");
      return;
    }

    this.style.left = `${Math.round(this.positionX)}px`;
    this.style.top = `${Math.round(this.positionY)}px`;
    this.style.right = "auto";
  }

  applyClampedPosition({ persist = true } = {}) {
    if (!this.hasCustomPosition) {
      return;
    }

    const nextPosition = this.clampToViewport();
    this.positionX = nextPosition.x;
    this.positionY = nextPosition.y;

    if (persist) {
      persistPosition(nextPosition);
    }
  }

  clampToViewport(nextX = this.positionX, nextY = this.positionY) {
    const rect = this.getBoundingClientRect();
    return {
      x: clampPosition(nextX, window.innerWidth - rect.width - VIEWPORT_PADDING_PX),
      y: clampPosition(nextY, window.innerHeight - rect.height - VIEWPORT_PADDING_PX),
    };
  }

  handleDragStart(event) {
    if (event.button !== 0) {
      return;
    }

    const rect = this.getBoundingClientRect();
    this.hasCustomPosition = true;
    this.positionX = rect.left;
    this.positionY = rect.top;
    this.dragPointerId = event.pointerId;
    this.dragOriginX = rect.left;
    this.dragOriginY = rect.top;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.setAttribute("data-dragging", "true");
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  handleWindowPointerMove(event) {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    const nextPosition = this.clampToViewport(
      this.dragOriginX + event.clientX - this.dragStartX,
      this.dragOriginY + event.clientY - this.dragStartY,
    );
    this.positionX = nextPosition.x;
    this.positionY = nextPosition.y;
  }

  handleWindowPointerUp(event) {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    this.applyClampedPosition();
    this.dragPointerId = null;
    this.removeAttribute("data-dragging");
  }

  handleWindowResize() {
    if (!this.hasCustomPosition) {
      return;
    }

    this.applyClampedPosition();
  }

  render() {
    return html`
      <section class="hud-shell" aria-hidden="true">
        <div class="hud-header" @pointerdown=${this.handleDragStart}>
          <strong>${t("hud.title")}</strong>
          <span class="hud-pill">${this.metrics.streamLabel}</span>
        </div>
        <dl class="hud-grid">
          ${HUD_FIELDS.map(
            ([labelKey, key]) => html`
              <div>
                <dt>${t(`hud.label.${labelKey}`)}</dt>
                <dd>${this.metrics[key]}</dd>
              </div>
            `,
          )}
        </dl>
      </section>
    `;
  }
}

if (!customElements.get(PERFORMANCE_HUD_TAG)) {
  customElements.define(PERFORMANCE_HUD_TAG, PerformanceHudElement);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.initialEnabled]
 * @returns {PerformanceHudController}
 */
export function createPerformanceHudController({ initialEnabled = false } = {}) {
  let enabled = false;
  let root = null;
  let longTaskObserver = null;
  let lastFrameTimestamp = 0;
  let averageFrameDurationMs = 0;
  let averageRefreshDurationMs = 0;
  let averageAnalysisDurationMs = 0;
  let lastLongTaskDurationMs = 0;
  let longTaskCount = 0;
  let lastHudRenderAt = 0;
  let lastMemorySampleAt = 0;
  let usedHeapBytes = null;
  let heapLimitBytes = null;
  let frameIntervalLabel = "1/4";
  let cameraResolutionLabel = "n/a";
  let cameraFpsLabel = "n/a";
  let analysisResolutionLabel = "n/a";
  let captureModeLabel = "palette";
  let paletteAlgorithmLabel = "median-cut";
  let streamStatus = "paused";
  const unsubscribeLocaleChange = subscribeLocaleChange(() => {
    if (enabled) {
      renderHud();
    }
  });

  function ensureRoot() {
    if (root || !document.body) {
      return root;
    }

    const nextRoot = /** @type {PerformanceHudElement} */ (
      document.createElement(PERFORMANCE_HUD_TAG)
    );
    nextRoot.hidden = true;
    document.body.appendChild(nextRoot);
    root = nextRoot;
    return root;
  }

  function renderHud(now = performance.now()) {
    if (!enabled) {
      return;
    }

    refreshHeapMetrics(now);
    const host = ensureRoot();
    host.hidden = false;
    host.metrics = {
      analysisLabel: analysisResolutionLabel,
      cameraLabel:
        cameraFpsLabel === "n/a"
          ? cameraResolutionLabel
          : `${cameraResolutionLabel} @ ${cameraFpsLabel}`,
      extractLabel: formatMilliseconds(averageAnalysisDurationMs),
      fpsLabel: streamStatus === "live" ? formatFps(averageFrameDurationMs) : "0",
      frameLabel: formatMilliseconds(averageRefreshDurationMs),
      heapLabel: usedHeapBytes
        ? `${formatMegabytes(usedHeapBytes)}${heapLimitBytes ? ` / ${formatMegabytes(heapLimitBytes)}` : ""}`
        : "n/a",
      intervalLabel: frameIntervalLabel,
      longTaskLabel:
        longTaskCount > 0
          ? `${longTaskCount} / ${formatMilliseconds(lastLongTaskDurationMs)}`
          : "0",
      modeLabel:
        streamStatus === "live"
          ? `${captureModeLabel} / ${paletteAlgorithmLabel}`
          : t("hud.state.idle"),
      streamLabel: t(`hud.state.${streamStatus}`),
      thermalLabel: "n/a",
    };
    lastHudRenderAt = now;
  }

  function refreshHeapMetrics(now = performance.now()) {
    if (now - lastMemorySampleAt < MEMORY_SAMPLE_INTERVAL_MS) {
      return;
    }

    const metrics = readHeapMetrics();
    usedHeapBytes = metrics.used;
    heapLimitBytes = metrics.limit;
    lastMemorySampleAt = now;
  }

  function attachLongTaskObserver() {
    if (longTaskObserver || !supportsLongTaskObserver()) {
      return;
    }

    longTaskObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      if (entries.length === 0) {
        return;
      }

      for (const entry of entries) {
        longTaskCount += 1;
        lastLongTaskDurationMs = entry.duration;
      }

      renderHud();
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  }

  function detachLongTaskObserver() {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);

    if (!enabled) {
      detachLongTaskObserver();
      if (root) {
        root.hidden = true;
      }
      lastFrameTimestamp = 0;
      lastHudRenderAt = 0;
      return;
    }

    attachLongTaskObserver();
    renderHud();
  }

  function recordFrame({
    analysisDurationMs = null,
    analysisHeight = 0,
    analysisWidth = 0,
    cameraFps = null,
    captureMode = "palette",
    extractionInterval = 1,
    extractionIntervalMs = null,
    paletteAlgorithm = "median-cut",
    rafTimestamp = 0,
    refreshDurationMs = null,
    sourceHeight = 0,
    sourceWidth = 0,
    streaming = false,
  } = {}) {
    if (!enabled) {
      return;
    }

    streamStatus = streaming ? "live" : "paused";
    cameraResolutionLabel = formatResolution(sourceWidth, sourceHeight);
    cameraFpsLabel = formatCameraFps(cameraFps);
    analysisResolutionLabel = formatResolution(analysisWidth, analysisHeight);
    captureModeLabel = captureMode;
    paletteAlgorithmLabel = paletteAlgorithm;
    frameIntervalLabel =
      Number.isFinite(extractionIntervalMs) && extractionIntervalMs > 0
        ? `${Math.round(extractionIntervalMs)} ms`
        : `1/${Math.max(1, Math.round(extractionInterval) || 1)}`;

    if (Number.isFinite(rafTimestamp) && rafTimestamp > 0) {
      if (lastFrameTimestamp > 0) {
        averageFrameDurationMs = blendAverage(
          averageFrameDurationMs,
          rafTimestamp - lastFrameTimestamp,
        );
      }

      lastFrameTimestamp = rafTimestamp;
    }

    averageRefreshDurationMs = blendAverage(averageRefreshDurationMs, refreshDurationMs);

    if (Number.isFinite(analysisDurationMs) && analysisDurationMs >= 0) {
      averageAnalysisDurationMs = blendAverage(averageAnalysisDurationMs, analysisDurationMs);
    }

    const now = performance.now();
    if (!lastHudRenderAt || now - lastHudRenderAt >= HUD_UPDATE_INTERVAL_MS) {
      renderHud(now);
    }
  }

  function destroy() {
    detachLongTaskObserver();
    root?.remove();
    root = null;
    unsubscribeLocaleChange();
  }

  setEnabled(initialEnabled);

  return {
    destroy,
    recordFrame,
    renderHud,
    setEnabled,
  };
}
