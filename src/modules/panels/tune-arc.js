import { html, render, svg } from "lit";
import { subscribeAppSettings } from "../../app-settings.js";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { detentFeedback, unlockUiFeedback } from "../ui-feedback.js";

/**
 * Tuning arc, after Luminar: tabs pick a setting, and one curved ruler turns
 * under a fixed needle. The ruler follows the finger, so the travel per unit is
 * the arc length between two ticks.
 *
 * The arc owns no state. It drives the drawer's native inputs (the range
 * inputs and the neutral-balance radios) with the same events a finger on them
 * would fire, so config-panel-controller.js keeps settings, history and undo.
 */

const TAP_SLOP_PX = 4;
const DOUBLE_TAP_MS = 320;
const RUBBER_BAND = 0.25;
const DIAL_HEIGHT = 104;
/** Apex of the ruler's arc, from the top of the dial. */
const DIAL_APEX = 30;
const EDGE_FADE_PX = 40;

/* Stroke icons (24px grid) for the tabs and the guide. */
export const TUNE_ICONS = Object.freeze({
  look: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" fill="currentColor" fill-opacity="0.35" /></svg>`,
  analyze: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.2 2.4" /><circle class="is-dot" cx="12" cy="9" r="1.5" /><circle class="is-dot" cx="9.2" cy="14" r="1.5" /><circle class="is-dot" cx="14.8" cy="14" r="1.5" /></svg>`,
  density: html`<svg class="tune-icon" viewBox="0 0 24 24">${[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => svg`<circle class="is-dot" cx=${x} cy=${y} r="1.5" />`))}</svg>`,
  tone: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path class="is-dot" d="M12 3.5a8.5 8.5 0 0 1 0 17z" /></svg>`,
  pins: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="9.5" cy="12" r="5.5" /><path d="M8.6 10.3 10 9.4v5.2" /><path d="M15.4 7.3a5.5 5.5 0 0 1 0 9.4" /></svg>`,
  grid: html`<svg class="tune-icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" /></svg>`,
  ral: html`<svg class="tune-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle class="is-dot" cx="12" cy="12" r="1.6" /></svg>`,
});

/* Illustrative swatches for the three neutral-balance looks, drawn on the ruler
   in place of numbers: all chromatic, mixed, mostly neutral. */
const LOOK_SWATCHES = Object.freeze({
  color: ["#d9573b", "#e9b31f", "#3f86c9", "#4f9a5e"],
  balanced: ["#d9573b", "#d9d4c8", "#3f86c9", "#5d6166"],
  neutrals: ["#d9d4c8", "#8b8a86", "#3f86c9", "#2d2f2c"],
});

/** deg: ruler angle per unit. every: tick spacing in units. major: labeled ticks. */
const TABS = Object.freeze([
  { key: "look", titleKey: "config.production.neutralBalance.title", deg: 16, every: 1, major: 1 },
  { key: "analyze", inputId: "configAnalyzeRange", unit: 1, deg: 1.2, every: 1, major: 10 },
  { key: "density", inputId: "configDensityRange", unit: 1000, deg: 1.2, every: 1, major: 10 },
  { key: "tone", inputId: "configToneRange", unit: 1, deg: 0.7, every: 2, major: 10 },
]);

/** A range input seen in whole ruler units (density counts thousands of pixels). */
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

/** The neutral-balance radios seen as a three-stop ruler. */
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

/**
 * @param {HTMLElement} root The config panel, holding #configTuneArc and the inputs.
 * @param {{ formatValue: (key: string, value: number) => string }} options
 * @returns {() => void} cleanup
 */
export function mountTuneArc(root, { formatValue }) {
  const host = root.querySelector("#configTuneArc");
  const radios = /** @type {HTMLInputElement[]} */ ([
    ...root.querySelectorAll(".config-drawer-neutral-input"),
  ]);
  const inputs = TABS.filter((tab) => tab.inputId).map((tab) =>
    root.querySelector(`#${tab.inputId}`),
  );
  if (!host || radios.length === 0 || inputs.some((input) => !input)) {
    return () => {};
  }

  const models = Object.fromEntries(
    TABS.map((tab) => [
      tab.key,
      tab.inputId
        ? rangeModel(root.querySelector(`#${tab.inputId}`), tab, formatValue)
        : lookModel(radios),
    ]),
  );

  host.innerHTML = `<div class="tune-arc-tabs" role="tablist"></div><p class="tune-arc-read"><span class="tune-arc-name"></span><span class="tune-arc-value"></span></p><div class="tune-arc-dial"><canvas></canvas></div>`;
  const tabList = /** @type {HTMLElement} */ (host.querySelector(".tune-arc-tabs"));
  const nameLabel = /** @type {HTMLElement} */ (host.querySelector(".tune-arc-name"));
  const valueLabel = /** @type {HTMLElement} */ (host.querySelector(".tune-arc-value"));
  const dial = /** @type {HTMLElement} */ (host.querySelector(".tune-arc-dial"));
  const canvas = /** @type {HTMLCanvasElement} */ (dial.querySelector("canvas"));
  const context = canvas.getContext("2d");

  const tabButtons = TABS.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tune-arc-tab";
    button.setAttribute("role", "tab");
    button.dataset.key = tab.key;
    tabList.append(button);
    return button;
  });

  const styles = getComputedStyle(root);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const colors = {
    tick: token("--color-text-primary", "#f0f0f0"),
    needle: token("--color-accent-soft", "#ffe06d"),
    glow: token("--color-accent-border", "rgb(255 200 0 / 65%)"),
    faceTop: token("--color-surface-raised", "#1b1b1b"),
    faceBottom: token("--color-surface-shell", "#0c0c0c"),
    faceEdge: token("--color-border-subtle", "rgb(255 255 255 / 12%)"),
    font: token("--font-family-mono", "monospace"),
  };

  let width = 0;
  let pixelRatio = 1;
  let activeKey = "look";
  let position = models[activeKey].get();
  let gesture = null;
  let frameId = 0;
  let lastTapAt = 0;

  const tabOf = (key) => TABS.find((tab) => tab.key === key);
  const radius = () => Math.max(220, width * 0.8);
  const pixelsPerUnit = () => (radius() * tabOf(activeKey).deg * Math.PI) / 180;

  function renderLabels() {
    const tab = tabOf(activeKey);
    const model = models[activeKey];
    nameLabel.textContent = t(tab.titleKey ?? `config.production.${activeKey}.title`);
    valueLabel.textContent = model.format(model.get());
    valueLabel.classList.toggle("is-text", activeKey === "look");
    valueLabel.classList.toggle("is-edited", activeKey !== "look" && model.get() !== model.def);
    tabButtons.forEach((button, index) => {
      const tabTitle = TABS[index].titleKey ?? `config.production.${TABS[index].key}.title`;
      const isActive = TABS[index].key === activeKey;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("aria-label", t(tabTitle));
    });
  }

  function draw() {
    if (!context || width <= 0) {
      return;
    }

    const tab = tabOf(activeKey);
    const model = models[activeKey];
    const r = radius();
    const cx = width / 2;
    const cy = DIAL_APEX + r;
    const span = Math.asin(Math.min(1, width / 2 / r));

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, DIAL_HEIGHT);

    // The dial's face, seen from its edge: a disc rising into the tray.
    const face = context.createLinearGradient(0, DIAL_APEX, 0, DIAL_HEIGHT);
    face.addColorStop(0, colors.faceTop);
    face.addColorStop(1, colors.faceBottom);
    context.beginPath();
    context.arc(cx, cy, r + 6, -Math.PI / 2 - span - 0.2, -Math.PI / 2 + span + 0.2);
    context.lineTo(width, DIAL_HEIGHT);
    context.lineTo(0, DIAL_HEIGHT);
    context.closePath();
    context.fillStyle = face;
    context.fill();
    context.beginPath();
    context.arc(cx, cy, r + 6, -Math.PI / 2 - span - 0.2, -Math.PI / 2 + span + 0.2);
    context.strokeStyle = colors.faceEdge;
    context.lineWidth = 1;
    context.stroke();

    context.lineCap = "round";
    context.strokeStyle = colors.tick;
    context.fillStyle = colors.tick;
    context.font = `500 10px ${colors.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (
      let unit = Math.ceil(model.lo / tab.every) * tab.every;
      unit <= model.hi;
      unit += tab.every
    ) {
      const angle = ((unit - position) * tab.deg * Math.PI) / 180;
      if (Math.abs(angle) > span) {
        continue;
      }

      const fade = 1 - (angle / span) ** 2;
      const isMajor = unit % tab.major === 0;
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
    for (const [from, to] of [
      [0, EDGE_FADE_PX],
      [width, width - EDGE_FADE_PX],
    ]) {
      const fadeOut = context.createLinearGradient(from, 0, to, 0);
      fadeOut.addColorStop(0, "#000");
      fadeOut.addColorStop(1, "transparent");
      context.fillStyle = fadeOut;
      context.fillRect(Math.min(from, to), 0, EDGE_FADE_PX, DIAL_HEIGHT);
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

  function tweenTo(target, durationMs = 220) {
    cancelAnimationFrame(frameId);
    const from = position;
    const start = performance.now();
    const frame = (now) => {
      const k = Math.min(1, (now - start) / durationMs);
      position = from + (target - from) * (1 - (1 - k) ** 3);
      draw();
      if (k < 1) {
        frameId = requestAnimationFrame(frame);
      }
    };
    frameId = requestAnimationFrame(frame);
  }

  function commitUnits(raw) {
    const model = models[activeKey];
    const { every } = tabOf(activeKey);
    const next = Math.min(Math.max(Math.round(raw), model.lo), model.hi);
    const previous = model.get();
    if (next === previous) {
      return;
    }
    if (Math.floor(next / every) !== Math.floor(previous / every)) {
      detentFeedback();
    }
    model.set(next);
    renderLabels();
  }

  function handlePointerDown(event) {
    if (gesture || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    unlockUiFeedback();
    cancelAnimationFrame(frameId);
    gesture = { id: event.pointerId, x: event.clientX, start: position, moved: false };
    dial.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const dx = event.clientX - gesture.x;
    if (!gesture.moved) {
      if (Math.abs(dx) <= TAP_SLOP_PX) {
        return;
      }
      gesture.moved = true;
      models[activeKey].begin();
    }

    const model = models[activeKey];
    let raw = gesture.start - dx / pixelsPerUnit();
    if (raw < model.lo) raw = model.lo - (model.lo - raw) * RUBBER_BAND;
    if (raw > model.hi) raw = model.hi + (raw - model.hi) * RUBBER_BAND;
    position = raw;
    commitUnits(raw);
    draw();
  }

  function handlePointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const { moved } = gesture;
    gesture = null;
    const model = models[activeKey];

    if (moved) {
      model.commit();
      tweenTo(Math.min(Math.max(Math.round(position), model.lo), model.hi));
      return;
    }

    if (event.type !== "pointerup" || activeKey === "look") {
      return;
    }
    const now = performance.now();
    if (now - lastTapAt < DOUBLE_TAP_MS) {
      lastTapAt = 0;
      model.begin();
      model.set(model.def);
      model.commit();
      detentFeedback();
    } else {
      lastTapAt = now;
    }
  }

  function handleTabClick(event) {
    const key =
      event.target instanceof Element ? event.target.closest(".tune-arc-tab")?.dataset.key : null;
    if (!key || key === activeKey) {
      return;
    }
    activeKey = key;
    const value = models[key].get();
    // The ruler spins in from a few ticks away, like a dial being handed over.
    position = value + (key === "look" ? 0.6 : 8);
    renderLabels();
    tweenTo(value, 380);
  }

  /** Settings changed elsewhere (undo, redo, reset, another tab of this ruler). */
  function sync() {
    if (gesture) {
      return;
    }
    renderLabels();
    const value = models[activeKey].get();
    if (Math.abs(value - position) > 0.01) {
      tweenTo(value, 320);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = dial.clientWidth;
    const nextRatio = Math.min(3, window.devicePixelRatio || 1);
    if (!nextWidth || (nextWidth === width && nextRatio === pixelRatio)) {
      return;
    }
    width = nextWidth;
    pixelRatio = nextRatio;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(DIAL_HEIGHT * pixelRatio);
    draw();
  });
  resizeObserver.observe(dial);

  dial.addEventListener("pointerdown", handlePointerDown);
  dial.addEventListener("pointermove", handlePointerMove);
  dial.addEventListener("pointerup", handlePointerEnd);
  dial.addEventListener("pointercancel", handlePointerEnd);
  tabList.addEventListener("click", handleTabClick);
  const unsubscribeSettings = subscribeAppSettings(sync);
  const unsubscribeLocale = subscribeLocaleChange(() => {
    renderLabels();
    draw();
  });

  tabButtons.forEach((button, index) => {
    render(TUNE_ICONS[TABS[index].key], button);
  });

  renderLabels();

  return () => {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    dial.removeEventListener("pointerdown", handlePointerDown);
    dial.removeEventListener("pointermove", handlePointerMove);
    dial.removeEventListener("pointerup", handlePointerEnd);
    dial.removeEventListener("pointercancel", handlePointerEnd);
    tabList.removeEventListener("click", handleTabClick);
    unsubscribeSettings();
    unsubscribeLocale();
  };
}
