import { html, LitElement } from "lit";
import { mountConfigPanel } from "./config-panel-controller.js";

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
  }

  disconnectedCallback() {
    this.cleanupConfigPanel?.();
    super.disconnectedCallback();
  }

  render() {
    return html`
      <section
        class="config-drawer"
        id="configDrawer"
        aria-label="Configuration de l'algorithme"
        aria-hidden="true"
        hidden
      >
        <div class="config-drawer-tabs" role="tablist" aria-label="Catégories d'analyse">
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
            <span class="config-drawer-tab-label">Analyse</span>
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
            <span class="config-drawer-tab-label">Couleur</span>
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
            <span class="config-drawer-tab-label">Balance</span>
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
            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configMedianCutPoolRange">
                  couleurs analysées
                </summary>
                <p class="settings-hint">
                  Plus la valeur est élevée, plus la palette sera variée, mais l'analyse
                  sera plus lente.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configMedianCutPoolSlider"
              >
                <input
                  id="configMedianCutPoolRange"
                  type="range"
                  min="4"
                  max="64"
                  value="16"
                  step="1"
                  aria-label="Nombre de couleurs analysées : 16"
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

            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configMedianCutPixelsRange">
                  Densité pixels
                </summary>
                <p class="settings-hint">
                  Améliore la précision pour les scènes complexes, mais ralentit le
                  traitement.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configMedianCutPixelsSlider"
              >
                <input
                  id="configMedianCutPixelsRange"
                  type="range"
                  min="1000"
                  max="60000"
                  value="12000"
                  step="1000"
                  aria-label="Pixels analysés max : 12000"
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
            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configScoringVibrancyRange">
                  couleurs vives
                </summary>
                <p class="settings-hint">
                  Plus la valeur est élevée, plus les couleurs éclatantes et saturées
                  seront privilégiées.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configScoringVibrancySlider"
              >
                <input
                  id="configScoringVibrancyRange"
                  type="range"
                  min="0"
                  max="100"
                  value="25"
                  step="1"
                  aria-label="Préférence pour les couleurs vives : 25"
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-vibrancy-display>
                    25
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">100</span>
                </div>
              </div>
            </div>

            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configScoringRarityRange">
                 teintes rares
                </summary>
                <p class="settings-hint">
                  Met en avant les teintes peu présentes dans l'image pour une palette
                  plus originale.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configScoringRaritySlider"
              >
                <input
                  id="configScoringRarityRange"
                  type="range"
                  min="0"
                  max="100"
                  value="20"
                  step="1"
                  aria-label="Bonus aux teintes rares : 20"
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-rarity-display>
                    20
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">100</span>
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
            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configScoringDiversityRange">
                  Écart couleurs
                </summary>
                <p class="settings-hint">
                  Plus la valeur est élevée, plus les couleurs choisies seront
                  différentes les unes des autres.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configScoringDiversitySlider"
              >
                <input
                  id="configScoringDiversityRange"
                  type="range"
                  min="0"
                  max="100"
                  value="40"
                  step="1"
                  aria-label="Écart couleurs : 40"
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-diversity-display>
                    40
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">100</span>
                </div>
              </div>
            </div>

            <div class="settings-field">
              <details class="settings-field-header">
                <summary class="settings-label" for="configScoringContrastRange">
                  Claire / Foncé
                </summary>
                <p class="settings-hint">
                  0 favorise les couleurs très claires, 100 les couleurs très foncées.
                </p>
              </details>

              <div
                class="swatch-slider settings-quality-slider config-drawer-slider"
                id="configScoringContrastSlider"
              >
                <input
                  id="configScoringContrastRange"
                  type="range"
                  min="0"
                  max="100"
                  value="15"
                  step="1"
                  aria-label="Claire / Foncé : 15"
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">0</span>
                  <span class="swatch-count-indicator" data-config-scoring-contrast-display>
                    15
                  </span>
                  <span class="swatch-scale-label swatch-scale-label-max">100</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="config-drawer-footer">
          <div class="config-drawer-history" role="group" aria-label="Historique">
            <button
              class="config-drawer-history-button"
              id="configUndoButton"
              type="button"
              disabled
            >
              <span
                class="config-drawer-icon config-drawer-action-icon config-drawer-icon-undo"
                aria-hidden="true"
              ></span>
              <span class="config-drawer-action-label">Undo</span>
            </button>
            <button
              class="config-drawer-history-button"
              id="configRedoButton"
              type="button"
              disabled
            >
              <span
                class="config-drawer-icon config-drawer-action-icon config-drawer-icon-redo"
                aria-hidden="true"
              ></span>
              <span class="config-drawer-action-label">Redo</span>
            </button>
          </div>

          <button
            class="config-drawer-reset-button"
            id="configResetButton"
            type="button"
          >
            <span
              class="config-drawer-icon config-drawer-action-icon config-drawer-icon-reset"
              aria-hidden="true"
            ></span>
            <span class="config-drawer-action-label">Reset</span>
          </button>
        </div>
      </section>
    `;
  }
}

if (!customElements.get("config-panel")) {
  customElements.define("config-panel", ConfigPanel);
}
