import { html, render, svg } from "lit";
import { subscribeAppSettings } from "../../app-settings.js";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { detentFeedback, unlockUiFeedback } from "../ui-feedback.js";

/**
 * Tuning panels for the tray, switchable in the preprod lab:
 *
 * - arc: tabs pick a setting, one curved ruler turns under a fixed needle
 *   (after Luminar);
 * - thin: one thin drum per setting, the look included (after Halide);
 * - drums: wider drums, the look included;
 * - rails: thin tracks with a raised knob carrying the setting's icon.
 *
 * Panels own no state. They drive the drawer's native inputs (the range inputs
 * and the neutral-balance radios) with the events a finger on those inputs
 * would fire, so config-panel-controller.js keeps settings, history and undo.
 */

const TAP_SLOP_PX = 4;
const DOUBLE_TAP_MS = 320;
const RUBBER_BAND = 0.25;
/** Finger travel per stop on the look's drum. */
const LOOK_DETENT_PX = 28;

/* Stroke icons (24px grid) for the arc tabs, the rail knobs and the guide. */
export const TUNE_ICONS = Object.freeze({
  look: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" fill="currentColor" fill-opacity="0.35" /></svg>`,
  analyze: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.2 2.4" /><circle class="is-dot" cx="12" cy="9" r="1.5" /><circle class="is-dot" cx="9.2" cy="14" r="1.5" /><circle class="is-dot" cx="14.8" cy="14" r="1.5" /></svg>`,
  density: html`<svg class="tune-icon" viewBox="0 0 24 24">${[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => svg`<circle class="is-dot" cx=${x} cy=${y} r="1.5" />`))}</svg>`,
  tone: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path class="is-dot" d="M12 3.5a8.5 8.5 0 0 1 0 17z" /></svg>`,
  pins: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="9.5" cy="12" r="5.5" /><path d="M8.6 10.3 10 9.4v5.2" /><path d="M15.4 7.3a5.5 5.5 0 0 1 0 9.4" /></svg>`,
  grid: html`<svg class="tune-icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" /></svg>`,
  ral: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle class="is-dot" cx="12" cy="12" r="1.6" /></svg>`,
});

/* Illustrative swatches for the three neutral-balance looks, drawn in place of
   numbers: all chromatic, mixed, mostly neutral. */
const LOOK_SWATCHES = Object.freeze({
  color: ["#d9573b", "#e9b31f", "#3f86c9", "#4f9a5e"],
  balanced: ["#d9573b", "#d9d4c8", "#3f86c9", "#5d6166"],
  neutrals: ["#d9d4c8", "#8b8a86", "#3f86c9", "#2d2f2c"],
});

/**
 * Per-setting geometry. arc: ruler angle per unit, tick spacing and labeled
 * ticks. drum: the same on a lever's drum, plus finger travel per unit.
 */
const SETTINGS = Object.freeze([
  {
    key: "look",
    titleKey: "config.production.neutralBalance.title",
    arc: { deg: 16, every: 1, major: 1 },
  },
  {
    key: "analyze",
    inputId: "configAnalyzeRange",
    unit: 1,
    arc: { deg: 1.2, every: 1, major: 10 },
    drum: { deg: 6, every: 2, major: 10, px: 5 },
  },
  {
    key: "density",
    inputId: "configDensityRange",
    unit: 1000,
    arc: { deg: 1.2, every: 1, major: 10 },
    drum: { deg: 6, every: 2, major: 10, px: 5 },
  },
  {
    key: "tone",
    inputId: "configToneRange",
    unit: 1,
    arc: { deg: 0.7, every: 2, major: 10 },
    drum: { deg: 2, every: 5, major: 25, px: 2.5 },
  },
]);

const titleOf = (setting) => t(setting.titleKey ?? `config.production.${setting.key}.title`);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/* ── Models: the native inputs seen in whole units ── */

/** A range input in ruler units (density counts thousands of pixels). */
function rangeModel(input, { key, unit = 1 }, formatValue) {
  return {
    lo: Number(input.min) / unit,
    hi: Number(input.max) / unit,
    def: Number(input.defaultValue) / unit,
    get: () => Number(input.value) / unit,
    begin: () => input.dispatchEvent(new Event("pointerdown")),
    set(units) {
      input.value = String(units * unit);
      input.dispatchEvent(new Event("input"));
    },
    commit: () => input.dispatchEvent(new Event("change")),
    format: (units) => formatValue(key, units * unit),
    swatches: null,
  };
}

/** The neutral-balance radios as a three-stop control. */
function lookModel(radios) {
  const indexOf = (predicate) => Math.max(0, radios.findIndex(predicate));
  return {
    lo: 0,
    hi: radios.length - 1,
    def: indexOf((radio) => radio.defaultChecked),
    get: () => indexOf((radio) => radio.checked),
    begin() {},
    set(index) {
      const radio = radios[index];
      if (!radio || radio.checked) {
        return;
      }
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    },
    commit() {},
    format: (index) => t(`config.production.neutralBalance.${radios[index]?.value}`),
    swatches: (index) => LOOK_SWATCHES[radios[index]?.value] ?? [],
  };
}

/* ── Shared mechanics ── */

/** Rounds to a whole unit inside the range, clicks on each `every` crossed. */
function stepTo(model, raw, every) {
  const next = clamp(Math.round(raw), model.lo, model.hi);
  const previous = model.get();
  if (next === previous) {
    return;
  }
  if (Math.floor(next / every) !== Math.floor(previous / every)) {
    detentFeedback();
  }
  model.set(next);
}

function resetToDefault(model) {
  model.begin();
  model.set(model.def);
  model.commit();
  detentFeedback();
}

function rubberBand(raw, model) {
  if (raw < model.lo) return model.lo - (model.lo - raw) * RUBBER_BAND;
  if (raw > model.hi) return model.hi + (raw - model.hi) * RUBBER_BAND;
  return raw;
}

/** Eases a value from `from` to `to`; returns a cancel function. */
function tween(from, to, durationMs, onFrame) {
  let frameId = 0;
  const start = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - start) / durationMs);
    onFrame(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) {
      frameId = requestAnimationFrame(frame);
    }
  };
  frameId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(frameId);
}

function createDoubleTap() {
  let lastTapAt = 0;
  return () => {
    const now = performance.now();
    const isDouble = now - lastTapAt < DOUBLE_TAP_MS;
    lastTapAt = isDouble ? 0 : now;
    return isDouble;
  };
}

/**
 * Pointer drag along one axis ("x", or "y" up = positive). onMove gets the
 * travel since the press; onEnd gets whether the finger moved past the tap
 * slop.
 */
function bindDrag(target, { axis, onStart, onMove, onEnd }) {
  let gesture = null;
  const travel = (event) => (axis === "x" ? event.clientX - gesture.x : gesture.y - event.clientY);

  function handleDown(event) {
    if (gesture || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    unlockUiFeedback();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    target.setPointerCapture?.(event.pointerId);
    onStart?.();
  }

  function handleMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const distance = travel(event);
    if (!gesture.moved) {
      if (Math.abs(distance) <= TAP_SLOP_PX) {
        return;
      }
      gesture.moved = true;
    }
    onMove(distance);
  }

  function handleEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { moved } = gesture;
    gesture = null;
    onEnd(moved, event);
  }

  target.addEventListener("pointerdown", handleDown);
  target.addEventListener("pointermove", handleMove);
  target.addEventListener("pointerup", handleEnd);
  target.addEventListener("pointercancel", handleEnd);
  return {
    isActive: () => gesture !== null,
    destroy() {
      target.removeEventListener("pointerdown", handleDown);
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
    },
  };
}

/** Canvas sized in CSS pixels, drawn at the device ratio. */
function prepareCanvas(canvas, width, height) {
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function readColors(root) {
  const styles = getComputedStyle(root);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    tick: token("--color-text-primary", "#f0f0f0"),
    needle: token("--color-accent-soft", "#ffe06d"),
    glow: token("--color-accent-border", "rgb(255 200 0 / 65%)"),
    faceTop: token("--color-surface-raised", "#1b1b1b"),
    faceBottom: token("--color-surface-shell", "#0c0c0c"),
    faceEdge: token("--color-border-subtle", "rgb(255 255 255 / 12%)"),
    font: token("--font-family-mono", "monospace"),
  };
}

/** The lit index across a drum, with a soft glow. */
function drawIndex(context, colors, fromX, toX, y, width) {
  context.save();
  context.shadowColor = colors.glow;
  context.shadowBlur = 7;
  context.strokeStyle = colors.needle;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(fromX, y);
  context.lineTo(toX, y);
  context.stroke();
  context.restore();
}

function paintValue(element, model, isLook) {
  element.textContent = model.format(model.get());
  element.classList.toggle("is-text", isLook);
  element.classList.toggle("is-edited", !isLook && model.get() !== model.def);
}

/* ── Arc ── */

const DIAL_HEIGHT = 104;
const DIAL_APEX = 30;
const EDGE_FADE_PX = 40;

function createArc(models, colors) {
  const element = document.createElement("div");
  element.className = "tune-arc";
  element.innerHTML = `<div class="tune-arc-tabs" role="tablist"></div><p class="tune-arc-read"><span class="tune-arc-name"></span><span class="tune-arc-value"></span></p><div class="tune-arc-dial"><canvas></canvas></div>`;
  const tabList = /** @type {HTMLElement} */ (element.querySelector(".tune-arc-tabs"));
  const nameLabel = /** @type {HTMLElement} */ (element.querySelector(".tune-arc-name"));
  const valueLabel = /** @type {HTMLElement} */ (element.querySelector(".tune-arc-value"));
  const dial = /** @type {HTMLElement} */ (element.querySelector(".tune-arc-dial"));
  const canvas = /** @type {HTMLCanvasElement} */ (dial.querySelector("canvas"));
  let context = null;
  let width = 0;

  const tabs = SETTINGS.map((setting) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tune-arc-tab";
    button.setAttribute("role", "tab");
    button.dataset.key = setting.key;
    render(TUNE_ICONS[setting.key], button);
    tabList.append(button);
    return button;
  });

  let active = SETTINGS[0];
  let position = models[active.key].get();
  let startPosition = 0;
  let cancelTween = () => {};
  const doubleTap = createDoubleTap();
  const radius = () => Math.max(220, width * 0.8);
  const pixelsPerUnit = () => (radius() * active.arc.deg * Math.PI) / 180;

  function paintText() {
    nameLabel.textContent = titleOf(active);
    paintValue(valueLabel, models[active.key], active.key === "look");
    tabs.forEach((button, index) => {
      const isActive = SETTINGS[index] === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("aria-label", titleOf(SETTINGS[index]));
    });
  }

  function draw() {
    if (!context || width <= 0) {
      return;
    }
    const { deg, every, major } = active.arc;
    const model = models[active.key];
    const r = radius();
    const cx = width / 2;
    const cy = DIAL_APEX + r;
    const span = Math.asin(Math.min(1, width / 2 / r));
    const from = -Math.PI / 2 - span - 0.2;
    const to = -Math.PI / 2 + span + 0.2;

    context.clearRect(0, 0, width, DIAL_HEIGHT);

    // The dial's face, seen from its edge: a disc rising into the tray.
    const face = context.createLinearGradient(0, DIAL_APEX, 0, DIAL_HEIGHT);
    face.addColorStop(0, colors.faceTop);
    face.addColorStop(1, colors.faceBottom);
    context.beginPath();
    context.arc(cx, cy, r + 6, from, to);
    context.lineTo(width, DIAL_HEIGHT);
    context.lineTo(0, DIAL_HEIGHT);
    context.closePath();
    context.fillStyle = face;
    context.fill();
    context.beginPath();
    context.arc(cx, cy, r + 6, from, to);
    context.strokeStyle = colors.faceEdge;
    context.lineWidth = 1;
    context.stroke();

    context.lineCap = "round";
    context.strokeStyle = colors.tick;
    context.fillStyle = colors.tick;
    context.font = `500 10px ${colors.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let unit = Math.ceil(model.lo / every) * every; unit <= model.hi; unit += every) {
      const angle = ((unit - position) * deg * Math.PI) / 180;
      if (Math.abs(angle) > span) {
        continue;
      }
      const fade = 1 - (angle / span) ** 2;
      const isMajor = unit % major === 0;
      const cos = Math.cos(angle - Math.PI / 2);
      const sin = Math.sin(angle - Math.PI / 2);
      const outer = r - 2;
      const length = model.swatches ? 20 : isMajor ? 18 : 9;
      context.globalAlpha = 0.12 + 0.68 * fade;
      context.lineWidth = isMajor ? 1.6 : 1;
      context.beginPath();
      context.moveTo(cx + cos * outer, cy + sin * outer);
      context.lineTo(cx + cos * (outer - length), cy + sin * (outer - length));
      context.stroke();
      if (!isMajor) {
        continue;
      }
      const labelRadius = outer - length - 12;
      context.save();
      context.translate(cx + cos * labelRadius, cy + sin * labelRadius);
      context.rotate(angle);
      context.globalAlpha = 0.2 + 0.7 * fade;
      if (model.swatches) {
        model.swatches(unit).forEach((swatch, index) => {
          context.fillStyle = swatch;
          context.fillRect(-9 + index * 4.75, -5, 3.5, 10);
        });
      } else {
        context.fillText(model.format(unit), 0, 0);
      }
      context.restore();
    }
    context.globalAlpha = 1;

    // Fade the ruler out at both sides, where the disc turns away.
    context.globalCompositeOperation = "destination-out";
    for (const [start, end] of [
      [0, EDGE_FADE_PX],
      [width, width - EDGE_FADE_PX],
    ]) {
      const fadeOut = context.createLinearGradient(start, 0, end, 0);
      fadeOut.addColorStop(0, "#000");
      fadeOut.addColorStop(1, "transparent");
      context.fillStyle = fadeOut;
      context.fillRect(Math.min(start, end), 0, EDGE_FADE_PX, DIAL_HEIGHT);
    }
    context.globalCompositeOperation = "source-over";

    context.save();
    context.shadowColor = colors.glow;
    context.shadowBlur = 8;
    context.strokeStyle = colors.needle;
    context.fillStyle = colors.needle;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx, 16);
    context.lineTo(cx, DIAL_APEX + 26);
    context.stroke();
    context.beginPath();
    context.arc(cx, 13, 4.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function glideTo(target, durationMs = 220) {
    cancelTween();
    cancelTween = tween(position, target, durationMs, (value) => {
      position = value;
      draw();
    });
  }

  let hasBegun = false;
  const drag = bindDrag(dial, {
    axis: "x",
    onStart() {
      cancelTween();
      startPosition = position;
    },
    onMove(travel) {
      const model = models[active.key];
      if (!hasBegun) {
        hasBegun = true;
        model.begin();
      }
      position = rubberBand(startPosition - travel / pixelsPerUnit(), model);
      stepTo(model, position, active.arc.every);
      paintText();
      draw();
    },
    onEnd(moved, event) {
      const model = models[active.key];
      if (moved) {
        hasBegun = false;
        model.commit();
        glideTo(clamp(Math.round(position), model.lo, model.hi));
        return;
      }
      if (event.type === "pointerup" && active.key !== "look" && doubleTap()) {
        resetToDefault(model);
      }
    },
  });

  function handleTabClick(event) {
    const key =
      event.target instanceof Element ? event.target.closest(".tune-arc-tab")?.dataset.key : null;
    const next = SETTINGS.find((setting) => setting.key === key);
    if (!next || next === active) {
      return;
    }
    active = next;
    const value = models[key].get();
    // The ruler spins in from a few ticks away, like a dial being handed over.
    position = value + (key === "look" ? 0.6 : 8);
    paintText();
    glideTo(value, 380);
  }
  tabList.addEventListener("click", handleTabClick);

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = dial.clientWidth;
    if (!nextWidth || nextWidth === width) {
      return;
    }
    width = nextWidth;
    context = prepareCanvas(canvas, width, DIAL_HEIGHT);
    draw();
  });
  resizeObserver.observe(dial);
  paintText();

  return {
    element,
    sync() {
      paintText();
      const value = models[active.key].get();
      if (!drag.isActive() && Math.abs(value - position) > 0.01) {
        glideTo(value, 320);
      }
    },
    destroy() {
      cancelTween();
      drag.destroy();
      resizeObserver.disconnect();
      tabList.removeEventListener("click", handleTabClick);
    },
  };
}

/* ── Drums: levers after Halide ── */

function createLeverShell(className, setting, width, height) {
  const element = document.createElement("div");
  element.className = className;
  element.innerHTML = `<span class="tune-lever-label"></span><span class="tune-lever-value"></span><div class="tune-lever-drum"><canvas></canvas></div>`;
  const drum = /** @type {HTMLElement} */ (element.querySelector(".tune-lever-drum"));
  const canvas = /** @type {HTMLCanvasElement} */ (element.querySelector("canvas"));
  return {
    element,
    label: /** @type {HTMLElement} */ (element.querySelector(".tune-lever-label")),
    value: /** @type {HTMLElement} */ (element.querySelector(".tune-lever-value")),
    drum,
    context: prepareCanvas(canvas, width, height),
    setting,
  };
}

/** A drum of ticks for a numeric setting. Drag up to raise; double-tap resets. */
function createLever(model, setting, { thin, colors }) {
  const { deg, every, major, px } = setting.drum;
  const width = thin ? 34 : 52;
  const height = thin ? 108 : 96;
  const inset = thin ? 5 : 9;
  const shell = createLeverShell(
    thin ? "tune-lever is-thin" : "tune-lever",
    setting,
    width,
    height,
  );
  const { context } = shell;
  let position = model.get();
  let startPosition = 0;
  let cancelTween = () => {};
  const doubleTap = createDoubleTap();

  function draw() {
    if (!context) {
      return;
    }
    context.clearRect(0, 0, width, height);
    const middle = height / 2;
    const r = middle - 4;
    context.strokeStyle = colors.tick;
    context.lineCap = "round";
    // Ticks sit on a cylinder: they crowd and fade toward the edges, and stop
    // at the setting's limits.
    for (let unit = Math.ceil(model.lo / every) * every; unit <= model.hi; unit += every) {
      const angle = ((unit - position) * deg * Math.PI) / 180;
      if (Math.abs(angle) > 1.45) {
        continue;
      }
      const cos = Math.cos(angle);
      const isMajor = unit % major === 0;
      const length = (isMajor ? (thin ? 16 : 30) : thin ? 9 : 18) * (0.7 + 0.3 * cos);
      const y = middle + r * Math.sin(angle);
      context.globalAlpha = 0.1 + 0.55 * cos * cos;
      context.lineWidth = thin ? 0.8 + 0.6 * cos : 1 + cos;
      context.beginPath();
      context.moveTo(width / 2 - length / 2, y);
      context.lineTo(width / 2 + length / 2, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    drawIndex(context, colors, inset, width - inset, middle, thin ? 1.6 : 2.5);
  }

  function paintText() {
    shell.label.textContent = titleOf(setting);
    paintValue(shell.value, model, false);
  }

  function glideTo(target, durationMs = 200) {
    cancelTween();
    cancelTween = tween(position, target, durationMs, (value) => {
      position = value;
      draw();
    });
  }

  let hasBegun = false;
  const drag = bindDrag(shell.drum, {
    axis: "y",
    onStart() {
      cancelTween();
      startPosition = position;
    },
    onMove(travel) {
      if (!hasBegun) {
        hasBegun = true;
        model.begin();
        shell.element.classList.add("is-active");
      }
      position = rubberBand(startPosition + travel / px, model);
      stepTo(model, position, every);
      paintText();
      draw();
    },
    onEnd(moved, event) {
      shell.element.classList.remove("is-active");
      if (moved) {
        hasBegun = false;
        model.commit();
        glideTo(clamp(Math.round(position), model.lo, model.hi));
        return;
      }
      if (event.type === "pointerup" && doubleTap()) {
        resetToDefault(model);
      }
    },
  });

  paintText();
  draw();
  return {
    element: shell.element,
    sync() {
      paintText();
      const value = model.get();
      if (!drag.isActive() && Math.abs(value - position) > 0.01) {
        glideTo(value, 320);
      }
    },
    destroy() {
      cancelTween();
      drag.destroy();
    },
  };
}

/**
 * Drum for the look: its mini palettes roll past the index like the numbers'
 * major ticks, with fine ticks between the stops. Tap for the next.
 */
function createLookDrum(model, setting, { thin, colors }) {
  const width = thin ? 34 : 52;
  const height = thin ? 108 : 96;
  const stepDeg = 38;
  const swatchWidth = thin ? 3.5 : 5.5;
  const swatchPitch = thin ? 4.75 : 6.75;
  const swatchHeight = thin ? 8 : 10;
  const tickLength = thin ? 9 : 18;
  const shell = createLeverShell(
    thin ? "tune-lever is-thin" : "tune-lever",
    setting,
    width,
    height,
  );
  const { context } = shell;
  let position = model.get();
  let startPosition = 0;
  let cancelTween = () => {};

  function draw() {
    if (!context) {
      return;
    }
    context.clearRect(0, 0, width, height);
    const middle = height / 2;
    const r = middle - 4;
    const paletteWidth = swatchPitch * 3 + swatchWidth;
    context.strokeStyle = colors.tick;
    context.lineCap = "round";
    // Four steps per stop: the palette on the stop, fine ticks between.
    for (let step = model.lo * 4; step <= model.hi * 4; step++) {
      const angle = ((step / 4 - position) * stepDeg * Math.PI) / 180;
      if (Math.abs(angle) > 1.45) {
        continue;
      }
      const cos = Math.cos(angle);
      const y = middle + r * Math.sin(angle);
      if (step % 4 === 0) {
        const barHeight = swatchHeight * cos;
        context.globalAlpha = 0.2 + 0.8 * cos * cos;
        model.swatches(step / 4).forEach((swatch, slot) => {
          context.fillStyle = swatch;
          context.fillRect(
            width / 2 - paletteWidth / 2 + slot * swatchPitch,
            y - barHeight / 2,
            swatchWidth,
            barHeight,
          );
        });
        continue;
      }
      const length = tickLength * (0.7 + 0.3 * cos);
      context.globalAlpha = 0.1 + 0.55 * cos * cos;
      context.lineWidth = thin ? 0.8 + 0.6 * cos : 1 + cos;
      context.beginPath();
      context.moveTo(width / 2 - length / 2, y);
      context.lineTo(width / 2 + length / 2, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    // The index stops short of the palette on each side.
    const inset = thin ? 3 : 5;
    const reach = (width - paletteWidth) / 2 - 2;
    drawIndex(context, colors, inset, reach, middle, thin ? 1.6 : 2.5);
    drawIndex(context, colors, width - reach, width - inset, middle, thin ? 1.6 : 2.5);
  }

  function paintText() {
    shell.label.textContent = titleOf(setting);
    paintValue(shell.value, model, true);
  }

  function glideTo(target, durationMs = 240) {
    cancelTween();
    cancelTween = tween(position, target, durationMs, (value) => {
      position = value;
      draw();
    });
  }

  const drag = bindDrag(shell.drum, {
    axis: "y",
    onStart() {
      cancelTween();
      startPosition = position;
    },
    onMove(travel) {
      shell.element.classList.add("is-active");
      position = rubberBand(startPosition + travel / LOOK_DETENT_PX, model);
      stepTo(model, position, 1);
      paintText();
      draw();
    },
    onEnd(moved, event) {
      shell.element.classList.remove("is-active");
      if (!moved && event.type === "pointerup") {
        stepTo(model, (model.get() + 1) % (model.hi + 1), 1);
      }
      glideTo(model.get());
    },
  });

  paintText();
  draw();
  return {
    element: shell.element,
    sync() {
      paintText();
      if (!drag.isActive() && Math.abs(model.get() - position) > 0.01) {
        glideTo(model.get());
      }
    },
    destroy() {
      cancelTween();
      drag.destroy();
    },
  };
}

/* ── Rails ── */

const RAIL_KNOB_PX = 28;

/** Thin track with an engraved scale and a raised icon knob. Tap the track to jump there. */
function createRail(model, setting) {
  const isLook = setting.key === "look";
  const element = document.createElement("div");
  element.className = isLook ? "tune-rail is-steps" : "tune-rail";
  element.innerHTML = `<span class="tune-rail-name"></span><span class="tune-rail-value"></span><div class="tune-rail-track"><span class="tune-rail-line"><span class="tune-rail-fill"></span></span><span class="tune-rail-scale"></span><span class="tune-rail-knob"></span></div>`;
  const name = /** @type {HTMLElement} */ (element.querySelector(".tune-rail-name"));
  const value = /** @type {HTMLElement} */ (element.querySelector(".tune-rail-value"));
  const track = /** @type {HTMLElement} */ (element.querySelector(".tune-rail-track"));
  render(
    TUNE_ICONS[setting.key],
    /** @type {HTMLElement} */ (element.querySelector(".tune-rail-knob")),
  );
  const every = isLook ? 1 : Math.max(1, Math.round((model.hi - model.lo) / 20));
  const doubleTap = createDoubleTap();
  let startUnits = 0;
  let hasBegun = false;

  const unitsPerPixel = () =>
    (model.hi - model.lo) / Math.max(1, track.getBoundingClientRect().width - RAIL_KNOB_PX);

  function paint(units = model.get()) {
    element.style.setProperty(
      "--rail-progress",
      ((units - model.lo) / (model.hi - model.lo)).toFixed(4),
    );
    name.textContent = titleOf(setting);
    paintValue(value, model, isLook);
  }

  const drag = bindDrag(track, {
    axis: "x",
    onStart() {
      startUnits = model.get();
      element.classList.add("is-dragging");
    },
    onMove(travel) {
      if (!hasBegun) {
        hasBegun = true;
        model.begin();
      }
      const units = clamp(startUnits + travel * unitsPerPixel(), model.lo, model.hi);
      stepTo(model, units, every);
      paint(units);
    },
    onEnd(moved, event) {
      element.classList.remove("is-dragging");
      if (moved) {
        hasBegun = false;
        model.commit();
      } else if (event.type === "pointerup") {
        if (!isLook && doubleTap()) {
          resetToDefault(model);
        } else {
          const bounds = track.getBoundingClientRect();
          const share = clamp(
            (event.clientX - bounds.left - RAIL_KNOB_PX / 2) / (bounds.width - RAIL_KNOB_PX),
            0,
            1,
          );
          model.begin();
          stepTo(model, model.lo + share * (model.hi - model.lo), every);
          model.commit();
        }
      }
      paint();
    },
  });

  paint();
  return {
    element,
    sync() {
      if (!drag.isActive()) {
        paint();
      }
    },
    destroy() {
      drag.destroy();
    },
  };
}

/**
 * Mounts one tuning panel into #configTunePanel.
 *
 * @param {HTMLElement} root The config panel, holding the host and the inputs.
 * @param {{ formatValue: (key: string, value: number) => string, kind?: string }} options
 * @returns {() => void} cleanup
 */
export function mountTunePanel(root, { formatValue, kind = "drums" }) {
  const host = /** @type {HTMLElement | null} */ (root.querySelector("#configTunePanel"));
  const radios = /** @type {HTMLInputElement[]} */ ([
    ...root.querySelectorAll(".config-drawer-neutral-input"),
  ]);
  const inputs = SETTINGS.filter((setting) => setting.inputId).map((setting) =>
    root.querySelector(`#${setting.inputId}`),
  );
  if (!host || radios.length === 0 || inputs.some((input) => !input)) {
    return () => {};
  }

  const models = Object.fromEntries(
    SETTINGS.map((setting) => [
      setting.key,
      setting.inputId
        ? rangeModel(root.querySelector(`#${setting.inputId}`), setting, formatValue)
        : lookModel(radios),
    ]),
  );
  const colors = readColors(root);

  let parts;
  let container;
  if (kind === "rails") {
    parts = SETTINGS.map((setting) => createRail(models[setting.key], setting));
    container = document.createElement("div");
    container.className = "tune-rails";
  } else if (kind === "thin" || kind === "drums") {
    const thin = kind === "thin";
    parts = SETTINGS.map((setting) => {
      const model = models[setting.key];
      return setting.key === "look"
        ? createLookDrum(model, setting, { thin, colors })
        : createLever(model, setting, { thin, colors });
    });
    container = document.createElement("div");
    container.className = thin ? "tune-levers is-thin" : "tune-levers";
  } else {
    parts = [createArc(models, colors)];
  }

  host.dataset.kind = kind;
  if (container) {
    container.append(...parts.map((part) => part.element));
    host.replaceChildren(container);
  } else {
    host.replaceChildren(parts[0].element);
  }

  const sync = () => {
    for (const part of parts) {
      part.sync();
    }
  };
  const unsubscribeSettings = subscribeAppSettings(sync);
  const unsubscribeLocale = subscribeLocaleChange(sync);

  return () => {
    for (const part of parts) {
      part.destroy();
    }
    unsubscribeSettings();
    unsubscribeLocale();
    host.replaceChildren();
  };
}
