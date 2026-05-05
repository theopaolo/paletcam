import { html, LitElement } from "lit";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { mountConfigPanel } from "./config-panel-controller.js";
import { CONFIG_PANEL_PRESETS } from "./config-panel-presets.js";

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
        <div class="config-drawer-tabs" role="tablist" aria-label=${t("config.tabsAria")}>
          <button
            class="config-drawer-tab"
            id="configTabAnalysis"
            type="button"
            role="tab"
            aria-controls="configPanelAnalysis"
            aria-selected="true"
            data-config-tab="analysis"
            tabindex="0"
          >
            <span
              class="config-drawer-icon config-drawer-tab-icon config-drawer-icon-analysis"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-tab-label">${t("config.tab.analysis")}</span>
          </button>
          <button
            class="config-drawer-tab"
            id="configTabColors"
            type="button"
            role="tab"
            aria-controls="configPanelColors"
            aria-selected="false"
            data-config-tab="colors"
            tabindex="-1"
          >
            <span
              class="config-drawer-icon config-drawer-tab-icon config-drawer-icon-colors"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-tab-label">${t("config.tab.colors")}</span>
          </button>
          <button
            class="config-drawer-tab"
            id="configTabBalance"
            type="button"
            role="tab"
            aria-controls="configPanelBalance"
            aria-selected="false"
            data-config-tab="balance"
            tabindex="-1"
          >
            <span
              class="config-drawer-icon config-drawer-tab-icon config-drawer-icon-balance"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-tab-label">${t("config.tab.balance")}</span>
          </button>
          <button
            class="config-drawer-tab"
            id="configTabPresets"
            type="button"
            role="tab"
            aria-controls="configPanelPresets"
            aria-selected="false"
            data-config-tab="presets"
            tabindex="-1"
          >
            <span
              class="config-drawer-icon config-drawer-tab-icon config-drawer-icon-presets"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-tab-label">${t("config.presets.label")}</span>
          </button>
        </div>

        <div class="config-drawer-panels">
          <section
            class="config-drawer-panel"
            id="configPanelAnalysis"
            role="tabpanel"
            aria-labelledby="configTabAnalysis"
            data-config-tabpanel="analysis"
          >
            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configMedianCutPoolRange">
                  ${t("config.analysis.pool.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.analysis.pool.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configMedianCutPoolSlider"
              >
                <input
                  id="configMedianCutPoolRange"
                  type="range"
                  min="4"
                  max="64"
                  value="16"
                  step="1"
                  aria-label=${t("config.analysis.pool.aria", { value: 16 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">4</span>
                  <span class="swatch-count-indicator" data-config-median-cut-pool-display>
                    16
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">64</span>
                </div>
              </div>
            </div>

            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configMedianCutPixelsRange">
                  ${t("config.analysis.pixels.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.analysis.pixels.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configMedianCutPixelsSlider"
              >
                <input
                  id="configMedianCutPixelsRange"
                  type="range"
                  min="1000"
                  max="60000"
                  value="12000"
                  step="1000"
                  aria-label=${t("config.analysis.pixels.aria", { value: 12000 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">1k</span>
                  <span class="swatch-count-indicator" data-config-median-cut-pixels-display>
                    12k
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">60k</span>
                </div>
              </div>
            </div>
          </section>

          <section
            class="config-drawer-panel"
            id="configPanelColors"
            role="tabpanel"
            aria-labelledby="configTabColors"
            data-config-tabpanel="colors"
            hidden
          >
            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configScoringVibrancyRange">
                  ${t("config.colors.vibrancy.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.colors.vibrancy.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configScoringVibrancySlider"
              >
                <input
                  id="configScoringVibrancyRange"
                  type="range"
                  min="0"
                  max="10"
                  value="2.5"
                  step="0.5"
                  aria-label=${t("config.colors.vibrancy.aria", { value: 2.5 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-vibrancy-display>
                    2.5
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">10</span>
                </div>
              </div>
            </div>

            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configScoringRarityRange">
                  ${t("config.colors.rarity.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.colors.rarity.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configScoringRaritySlider"
              >
                <input
                  id="configScoringRarityRange"
                  type="range"
                  min="0"
                  max="10"
                  value="2"
                  step="0.5"
                  aria-label=${t("config.colors.rarity.aria", { value: 2 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-rarity-display>
                    2
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">10</span>
                </div>
              </div>
            </div>
          </section>

          <section
            class="config-drawer-panel"
            id="configPanelBalance"
            role="tabpanel"
            aria-labelledby="configTabBalance"
            data-config-tabpanel="balance"
            hidden
          >
            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configScoringDiversityRange">
                  ${t("config.balance.diversity.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.balance.diversity.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configScoringDiversitySlider"
              >
                <input
                  id="configScoringDiversityRange"
                  type="range"
                  min="0"
                  max="10"
                  value="4"
                  step="0.5"
                  aria-label=${t("config.balance.diversity.aria", { value: 4 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-diversity-display>
                    4
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">10</span>
                </div>
              </div>
            </div>

            <div class="panel-form-field">
              <details class="panel-form-field-header">
                <summary class="panel-form-label" for="configScoringContrastRange">
                  ${t("config.balance.contrast.title")}
                </summary>
                <p class="panel-form-hint">
                  ${t("config.balance.contrast.hint")}
                </p>
              </details>

              <div
                class="swatch-slider panel-form-quality-slider config-drawer-slider"
                id="configScoringContrastSlider"
              >
                <input
                  id="configScoringContrastRange"
                  type="range"
                  min="0"
                  max="10"
                  value="1.5"
                  step="0.5"
                  aria-label=${t("config.balance.contrast.aria", { value: 1.5 })}
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-contrast-display>
                    1.5
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">10</span>
                </div>
              </div>
            </div>
          </section>

          <section
            class="config-drawer-panel"
            id="configPanelPresets"
            role="tabpanel"
            aria-labelledby="configTabPresets"
            data-config-tabpanel="presets"
            hidden
          >
            <div class="config-drawer-presets" role="group" aria-label=${t("config.presets.aria")}>
              <div class="config-drawer-presets-grid">
                ${CONFIG_PANEL_PRESETS.map(
                  (preset) => html`
                    <button
                      class="config-drawer-preset panel-status-chip"
                      type="button"
                      data-config-preset=${preset.id}
                      aria-pressed="false"
                    >
                      ${t(preset.labelKey)}
                    </button>
                  `,
                )}
              </div>
            </div>
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
        <label class="panel-form-checkbox config-drawer-darkest-toggle" for="configOneMoreColorToggle">
          <input
            class="panel-form-checkbox-input"
            id="configOneMoreColorToggle"
            type="checkbox"
          />
          <span class="panel-form-checkbox-box" aria-hidden="true"></span>
          <span class="panel-form-checkbox-label">${t("config.colors.darkest.checkbox")}</span>
        </label>
      </section>
    `;
  }
}

if (!customElements.get("config-panel")) {
  customElements.define("config-panel", ConfigPanel);
}
