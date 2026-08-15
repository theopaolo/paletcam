import { html, LitElement } from "lit";
import { APP_SETTINGS_LIMITS, getDefaultAppSettings } from "../../app-settings.js";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { mountConfigPanel } from "./config-panel-controller.js";

const DEFAULT_ALGORITHM_SETTINGS = getDefaultAppSettings();

const TUNING_FIELDS = Object.freeze([
  Object.freeze({
    controlKey: "analyze",
    shellId: "configAnalyzeSlider",
    inputId: "configAnalyzeRange",
    valueId: "configAnalyzeValue",
    min: APP_SETTINGS_LIMITS.medianCut.quantizedPoolSize.min,
    max: APP_SETTINGS_LIMITS.medianCut.quantizedPoolSize.max,
    step: 1,
    value: DEFAULT_ALGORITHM_SETTINGS.medianCut.quantizedPoolSize,
  }),
  Object.freeze({
    controlKey: "density",
    shellId: "configDensitySlider",
    inputId: "configDensityRange",
    valueId: "configDensityValue",
    min: APP_SETTINGS_LIMITS.medianCut.maxQuantizerPixels.min,
    max: APP_SETTINGS_LIMITS.medianCut.maxQuantizerPixels.max,
    step: 1000,
    value: DEFAULT_ALGORITHM_SETTINGS.medianCut.maxQuantizerPixels,
  }),
  Object.freeze({
    controlKey: "tone",
    shellId: "configToneSlider",
    inputId: "configToneRange",
    valueId: "configToneValue",
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(DEFAULT_ALGORITHM_SETTINGS.hybrid.tone * 100),
  }),
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

function renderTuningField({ controlKey, shellId, inputId, valueId, min, max, step, value }) {
  const formattedValue = formatTuningValue(controlKey, value);

  return html`
    <div class="panel-form-field">
      <details class="panel-form-field-header">
        <summary class="panel-form-label" for=${inputId}>
          ${t(`config.production.${controlKey}.title`)}
        </summary>
        <p class="panel-form-hint">
          ${t(`config.production.${controlKey}.hint`)}
        </p>
      </details>

      <output class="config-drawer-value" id=${valueId} for=${inputId}>
        ${formattedValue}
      </output>

      <div class="swatch-slider panel-form-quality-slider config-drawer-slider" id=${shellId}>
        <input
          id=${inputId}
          type="range"
          min=${min}
          max=${max}
          value=${value}
          step=${step}
          aria-label=${t(`config.production.${controlKey}.aria`, { value: formattedValue })}
        />
      </div>
    </div>
  `;
}

class ConfigPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.cleanupConfigPanel = mountConfigPanel({
      root: this,
      toggleButton: document.querySelector(".btn-config"),
      toggleSection: document.querySelector(".config-section"),
    });
    this.unsubscribeLocaleChange = subscribeLocaleChange(() => {
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.cleanupConfigPanel?.();
    this.unsubscribeLocaleChange?.();
    super.disconnectedCallback();
  }

  render() {
    return html`
      <section
        class="config-drawer"
        id="configDrawer"
        aria-label=${t("config.drawerAria")}
        aria-hidden="true"
        hidden
      >
        <div class="config-drawer-panels">
          <section class="config-drawer-panel" aria-label=${t("config.production.panelAria")}>
            ${TUNING_FIELDS.map(renderTuningField)}
          </section>
        </div>

        <div class="config-drawer-footer dock">
          <div class="config-drawer-history toolbar" role="group" aria-label=${t("config.history.aria")}>
            <button
              class="config-drawer-history-button panel-inline-action"
              id="configUndoButton"
              type="button"
              disabled
            >
              <span
                class="config-drawer-icon config-drawer-action-icon config-drawer-icon-undo"
                aria-hidden="true"
              ></span>
              <span class="config-drawer-action-label">${t("config.history.undo")}</span>
            </button>
            <button
              class="config-drawer-history-button panel-inline-action"
              id="configRedoButton"
              type="button"
              disabled
            >
              <span
                class="config-drawer-icon config-drawer-action-icon config-drawer-icon-redo"
                aria-hidden="true"
              ></span>
              <span class="config-drawer-action-label">${t("config.history.redo")}</span>
            </button>
          </div>

          <button
            class="config-drawer-reset-button panel-inline-action"
            id="configResetButton"
            type="button"
          >
            <span
              class="config-drawer-icon config-drawer-action-icon config-drawer-icon-reset"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-action-label">${t("config.history.reset")}</span>
          </button>
        </div>
        <label
          class="panel-form-checkbox config-drawer-darkest-toggle"
          for="configOriginBadgesToggle"
        >
          <input
            class="panel-form-checkbox-input"
            id="configOriginBadgesToggle"
            type="checkbox"
          />
          <span class="panel-form-checkbox-box" aria-hidden="true"></span>
          <span class="panel-form-checkbox-label">${t("config.pins.checkbox")}</span>
          <svg
            class="config-drawer-pins-icon"
            viewBox="0 0 20 16"
            aria-hidden="true"
          >
            <circle cx="13" cy="7" r="5.5" fill="var(--color-success)" stroke="black" stroke-width="1.5" />
            <circle cx="7" cy="9" r="5.5" fill="var(--color-accent)" stroke="black" stroke-width="1.5" />
            <text x="7" y="9.5" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="7" font-weight="bold" fill="black">1</text>
          </svg>
        </label>
      </section>
    `;
  }
}

if (!customElements.get("config-panel")) {
  customElements.define("config-panel", ConfigPanel);
}
