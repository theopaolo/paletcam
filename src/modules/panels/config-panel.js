import { html, LitElement } from "lit";
import { APP_SETTINGS_LIMITS, getDefaultAppSettings } from "../../app-settings.js";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { getFooterLab, setFooterLab, subscribeFooterLab } from "../footer-lab.js";
import { mountConfigPanel } from "./config-panel-controller.js";
import { mountTuneArc, TUNE_ICONS } from "./tune-arc.js";

const DEFAULT_ALGORITHM_SETTINGS = getDefaultAppSettings();

const TUNING_FIELDS = Object.freeze([
  Object.freeze({
    controlKey: "analyze",
    inputId: "configAnalyzeRange",
    min: APP_SETTINGS_LIMITS.medianCut.quantizedPoolSize.min,
    max: APP_SETTINGS_LIMITS.medianCut.quantizedPoolSize.max,
    step: 1,
    value: DEFAULT_ALGORITHM_SETTINGS.medianCut.quantizedPoolSize,
  }),
  Object.freeze({
    controlKey: "density",
    inputId: "configDensityRange",
    min: APP_SETTINGS_LIMITS.medianCut.maxQuantizerPixels.min,
    max: APP_SETTINGS_LIMITS.medianCut.maxQuantizerPixels.max,
    step: 1000,
    value: DEFAULT_ALGORITHM_SETTINGS.medianCut.maxQuantizerPixels,
  }),
  Object.freeze({
    controlKey: "tone",
    inputId: "configToneRange",
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(DEFAULT_ALGORITHM_SETTINGS.hybrid.tone * 100),
  }),
]);

const NEUTRAL_BALANCE_OPTIONS = Object.freeze([
  Object.freeze({ value: "color", id: "configNeutralColor" }),
  Object.freeze({ value: "balanced", id: "configNeutralBalanced" }),
  Object.freeze({ value: "neutrals", id: "configNeutralNeutrals" }),
]);

function formatTuningValue(controlKey, value) {
  if (controlKey === "density") {
    return `${Math.round(value / 1000)}k`;
  }
  if (controlKey === "tone") {
    return `${Math.round(value)}%`;
  }
  return String(Math.round(value));
}

/* The native inputs stay the drawer's model: config-panel-controller.js reads
   and writes them for settings and history, and the tuning arc drives them. */
function renderTuningInput({ controlKey, inputId, min, max, step, value }) {
  return html`
    <input
      id=${inputId}
      type="range"
      min=${min}
      max=${max}
      value=${value}
      step=${step}
      aria-label=${t(`config.production.${controlKey}.aria`, {
        value: formatTuningValue(controlKey, value),
      })}
    />
  `;
}

function renderNeutralBalanceInputs() {
  return html`
    <div role="radiogroup" aria-label=${t("config.production.neutralBalance.title")}>
      ${NEUTRAL_BALANCE_OPTIONS.map(
        ({ value, id }) => html`
          <input
            class="config-drawer-neutral-input"
            id=${id}
            type="radio"
            name="configNeutralBalance"
            value=${value}
            aria-label=${t(`config.production.neutralBalance.${value}`)}
            ?checked=${value === DEFAULT_ALGORITHM_SETTINGS.hybrid.neutralBalance}
          />
        `,
      )}
    </div>
  `;
}

const GUIDE_ENTRIES = Object.freeze([
  ["look", "config.production.neutralBalance.title", "config.production.neutralBalance.hint"],
  ["analyze", "config.production.analyze.title", "config.production.analyze.hint"],
  ["density", "config.production.density.title", "config.production.density.hint"],
  ["tone", "config.production.tone.title", "config.production.tone.hint"],
  ["pins", "config.pins.checkbox", "config.guide.pins"],
  ["grid", "capture.grid", "config.guide.grid"],
  ["ral", "capture.mode.ral", "config.guide.ral"],
]);

/* Preprod-only switches for the footer variants under test. English only: a
   debug tool, like the performance HUD. */
const FOOTER_LAB_ROWS = Object.freeze([
  Object.freeze({
    key: "shutter",
    label: "Shutter",
    options: [
      ["titanium", "Titanium"],
      ["flat", "Flat"],
      ["logo", "Logo"],
    ],
  }),
  Object.freeze({
    key: "count",
    label: "Count",
    options: [
      ["dial", "Ticks"],
      ["numbered", "Numbers"],
      ["adj", "ADJ"],
      ["drum", "Drum"],
    ],
  }),
]);

function renderFooterLab() {
  const lab = getFooterLab();
  return html`
    <div class="footer-lab" role="group" aria-label="Footer lab">
      ${FOOTER_LAB_ROWS.map(
        ({ key, label, options }) => html`
          <div class="footer-lab-row">
            <span class="footer-lab-label">${label}</span>
            <div class="footer-lab-options">
              ${options.map(
                ([value, text]) => html`
                  <button
                    class="footer-lab-option"
                    type="button"
                    aria-pressed=${String(lab[key] === value)}
                    @click=${() => setFooterLab({ [key]: value })}
                  >
                    ${text}
                  </button>
                `,
              )}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

class ConfigPanel extends LitElement {
  static properties = {
    isGuideOpen: { state: true },
  };

  constructor() {
    super();
    this.isGuideOpen = false;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.cleanupConfigPanel = mountConfigPanel({
      root: this,
      toggleButton: document.querySelector(".btn-config"),
      toggleSection: document.getElementById("tuneTray"),
    });
    this.cleanupTuneArc = mountTuneArc(this, { formatValue: formatTuningValue });
    this.unsubscribeLocaleChange = subscribeLocaleChange(() => {
      this.requestUpdate();
    });
    this.unsubscribeFooterLab = subscribeFooterLab(() => {
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.cleanupConfigPanel?.();
    this.cleanupTuneArc?.();
    this.unsubscribeLocaleChange?.();
    this.unsubscribeFooterLab?.();
    super.disconnectedCallback();
  }

  setGuideOpen(isOpen) {
    this.isGuideOpen = isOpen;
  }

  renderGuide() {
    return html`
      <div
        class="tune-guide ${this.isGuideOpen ? "is-open" : ""}"
        aria-hidden=${String(!this.isGuideOpen)}
        @click=${(event) => {
          if (event.target === event.currentTarget) {
            this.setGuideOpen(false);
          }
        }}
      >
        <div class="tune-guide-sheet" role="dialog" aria-label=${t("config.guide.title")}>
          <div class="tune-guide-head">
            <h2 class="tune-guide-title">${t("config.guide.title")}</h2>
            <button
              class="tune-guide-done"
              type="button"
              @click=${() => this.setGuideOpen(false)}
            >
              ${t("config.guide.done")}
            </button>
          </div>
          <dl class="tune-guide-list">
            ${GUIDE_ENTRIES.map(
              ([icon, titleKey, hintKey]) => html`
                <div class="tune-guide-row">
                  <span class="tune-guide-icon" aria-hidden="true">${TUNE_ICONS[icon]}</span>
                  <div>
                    <dt>${t(titleKey)}</dt>
                    <dd>${t(hintKey)}</dd>
                  </div>
                </div>
              `,
            )}
          </dl>
          <p class="tune-guide-foot">${t("config.guide.reset")}</p>
          ${__PALETCAM_DEBUG_TOOLS__ ? renderFooterLab() : ""}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <section
        class="config-drawer"
        id="configDrawer"
        aria-label=${t("config.drawerAria")}
        aria-hidden="true"
        inert
      >
        <div class="tune-arc" id="configTuneArc"></div>

        <div class="config-drawer-model" hidden>
          ${TUNING_FIELDS.map(renderTuningInput)} ${renderNeutralBalanceInputs()}
        </div>

        <div class="config-drawer-footer" role="group" aria-label=${t("config.history.aria")}>
          <button class="config-drawer-action" id="configUndoButton" type="button" disabled>
            <span class="config-drawer-icon config-drawer-icon-undo" aria-hidden="true"></span>
            ${t("config.history.undo")}
          </button>
          <button class="config-drawer-action" id="configRedoButton" type="button" disabled>
            <span class="config-drawer-icon config-drawer-icon-redo" aria-hidden="true"></span>
            ${t("config.history.redo")}
          </button>
          <button
            class="config-drawer-action config-drawer-guide"
            type="button"
            @click=${() => this.setGuideOpen(true)}
          >
            <span class="config-drawer-icon config-drawer-icon-guide" aria-hidden="true"></span>
            ${t("config.guide.open")}
          </button>
          <button class="config-drawer-action" id="configResetButton" type="button">
            <span class="config-drawer-icon config-drawer-icon-reset" aria-hidden="true"></span>
            ${t("config.history.reset")}
          </button>
        </div>
      </section>
      ${this.renderGuide()}
    `;
  }
}

if (!customElements.get("config-panel")) {
  customElements.define("config-panel", ConfigPanel);
}
