import { html, LitElement } from "lit";
import { mountSettingsPanel } from "./settings-panel-controller.js";
import "./shared-panel.js";

class SettingsPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.cleanupSettingsPanel = mountSettingsPanel({
      root: this,
      openButton: document.querySelector(".btn-open-settings"),
    });
  }

  disconnectedCallback() {
    this.cleanupSettingsPanel?.();
    super.disconnectedCallback();
  }

  render() {
    return html`
      <shared-panel
        class="settings-panel"
        data-panel-name="settings"
        panel-title="Réglages"
        close-label="Fermer les réglages"
        hidden
      >
        <div class="settings-content">
          <section class="settings-section" aria-labelledby="settingsCaptureTitle">
            <div class="settings-section-header">
              <h3 id="settingsCaptureTitle">Qualité des photos</h3>
            </div>

            <div class="settings-field">
              <div
                class="swatch-slider settings-quality-slider"
                id="settingsPhotoQualitySlider"
              >
                <input
                  id="settingsPhotoQualityRange"
                  type="range"
                  min="60"
                  max="98"
                  value="88"
                  step="1"
                  aria-label="Qualité d'image : 88%"
                />
                <div class="swatch-meta">
                  <span class="swatch-scale-label swatch-scale-label-min">60%</span>
                  <span class="swatch-count-indicator" data-settings-quality-display
                    >88%</span
                  >
                  <span class="swatch-scale-label swatch-scale-label-max">98%</span>
                </div>
              </div>
            </div>
          </section>

          <div class="settings-subsection" id="settingsCaptureModeSection">
            <label class="settings-subsection-label">Mode</label>
            <div
              class="settings-segment"
              role="group"
              aria-label="Mode de capture"
            >
              <button
                class="settings-segment-button"
                type="button"
                data-settings-capture-mode="palette"
              >
                Palette
              </button>
              <button
                class="settings-segment-button"
                type="button"
                data-settings-capture-mode="ral"
              >
                RAL
              </button>
            </div>
          </div>

          <div id="settingsPaletteModeGroup">
            <section class="settings-section" aria-labelledby="settingsPaletteTitle">

              <div class="settings-field">
                <div class="settings-field-header">

                  <details>
                    <summary class="settings-label" for="settingsMedianCutPoolRange"
                    >Nombre de couleurs analysées</summary
                  >
                    <p class="settings-hint">
                      Plus la valeur est élevée, plus la palette sera variée, mais
                      l'analyse sera plus lente.
                      </p>
                  </details>
                </div>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsMedianCutPoolSlider"
                >
                  <input
                    id="settingsMedianCutPoolRange"
                    type="range"
                    min="4"
                    max="64"
                    value="16"
                    step="1"
                    aria-label="Nombre de couleurs analysées : 16"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">4</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-median-cut-pool-display
                      >16</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">64</span>
                  </div>
                </div>
              </div>

              <div class="settings-field">
                <details class="settings-field-header">
                  <summary class="settings-label" for="settingsMedianCutPixelsRange"
                    >Pixels analysés </summary
                  >
             <p class="settings-hint">
                  Améliore la précision pour les scènes complexes, mais ralentit
                  le traitement.
                </p>
                </details>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsMedianCutPixelsSlider"
                >
                  <input
                    id="settingsMedianCutPixelsRange"
                    type="range"
                    min="1000"
                    max="60000"
                    value="12000"
                    step="1000"
                    aria-label="Pixels analysés max : 12000"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">1k</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-median-cut-pixels-display
                      >12k</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">60k</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="settings-section" aria-labelledby="settingsScoringTitle">
              <div class="settings-field">
                <details class="settings-field-header">
                  <summary class="settings-label" for="settingsScoringVibrancyRange"
                    >Préférence pour les couleurs vives</summary
                  >
                      <p class="settings-hint">
                  Plus la valeur est élevée, plus les couleurs éclatantes et
                  saturées seront privilégiées.
                </p>
                </details>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsScoringVibrancySlider"
                >
                  <input
                    id="settingsScoringVibrancyRange"
                    type="range"
                    min="0"
                    max="100"
                    value="25"
                    step="1"
                    aria-label="Préférence pour les couleurs vives : 25"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">0</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-scoring-vibrancy-display
                      >25</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">100</span>
                  </div>
                </div>
              </div>

              <div class="settings-field">
                <details class="settings-field-header">
                  <summary class="settings-label" for="settingsScoringContrastRange"
                    >Contraste clair/foncé</summary
                  >
                       <p class="settings-hint">
                  0 favorise les couleurs très claires - 100 les couleurs très foncées.
                </p>
                </details>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsScoringContrastSlider"
                >
                  <input
                    id="settingsScoringContrastRange"
                    type="range"
                    min="0"
                    max="100"
                    value="15"
                    step="1"
                    aria-label="Contraste clair/foncé : 15"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">0</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-scoring-contrast-display
                      >15</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">100</span>
                  </div>
                </div>
              </div>

              <div class="settings-field">
                <details class="settings-field-header">
                  <summary class="settings-label" for="settingsScoringRarityRange" >Bonus aux teintes rares</summary>
                    <p class="settings-hint">
                      Met en avant les teintes peu présentes dans l'image pour une
                      palette plus originale.
                    </p>
                </details>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsScoringRaritySlider"
                >
                  <input
                    id="settingsScoringRarityRange"
                    type="range"
                    min="0"
                    max="100"
                    value="20"
                    step="1"
                    aria-label="Bonus aux teintes rares : 20"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">0</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-scoring-rarity-display
                      >20</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">100</span>
                  </div>
                </div>
              </div>

              <div class="settings-field">
                <details class="settings-field-header">
                  <summary class="settings-label" for="settingsScoringDiversityRange"
                    >Écart entre les couleurs</summary
                  >
                  <p class="settings-hint">
                      Plus la valeur est élevée, plus les couleurs choisies seront
                      différentes les unes des autres.
                  </p>
                </details>

                <div
                  class="swatch-slider settings-quality-slider"
                  id="settingsScoringDiversitySlider"
                >
                  <input
                    id="settingsScoringDiversityRange"
                    type="range"
                    min="0"
                    max="100"
                    value="40"
                    step="1"
                    aria-label="Écart entre les couleurs : 40"
                  />
                  <div class="swatch-meta">
                    <span class="swatch-scale-label swatch-scale-label-min">0</span>
                    <span
                      class="swatch-count-indicator"
                      data-settings-scoring-diversity-display
                      >40</span
                    >
                    <span class="swatch-scale-label swatch-scale-label-max">100</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="settings-section" aria-labelledby="settingsOneMoreColorTitle">
              <div class="settings-section-header">
                <h3 id="settingsOneMoreColorTitle">Moins de couleurs sombre</h3>
              </div>

              <div class="settings-field">
                <div
                  class="settings-segment"
                  role="group"
                  aria-label="Moins de couleurs sombre"
                >
                  <button
                    class="settings-segment-button"
                    type="button"
                    data-settings-one-more-color="off"
                    aria-pressed="true"
                  >
                    Off
                  </button>
                  <button
                    class="settings-segment-button"
                    type="button"
                    data-settings-one-more-color="on"
                    aria-pressed="false"
                  >
                    On
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section class="settings-section" aria-labelledby="settingsDataTitle">
            <div class="settings-section-header">
              <h3 id="settingsDataTitle">Données</h3>
              <p>
                Exportez vos palettes pour les sauvegarder ou les transférer sur
                un autre appareil.
              </p>
            </div>

            <div class="settings-field">
              <button
                class="settings-action-button"
                id="settingsExportButton"
                type="button"
              >
                Exporter mes palettes
              </button>
            </div>

            <div class="settings-field">
              <label class="settings-label settings-label-static"
                >Importer des palettes</label
              >
              <label class="settings-file-label" id="settingsImportLabel">
                <input
                  class="settings-file-input"
                  id="settingsImportInput"
                  type="file"
                  accept=".json"
                />
                <span class="settings-file-label-text"
                  >Choisir un fichier .json</span
                >
              </label>
              <p class="settings-hint">
                Les palettes importées s'ajoutent à votre collection existante.
              </p>
            </div>
          </section>

          <button
            class="settings-secondary-button"
            id="settingsResetButton"
            type="button"
          >
            Reset réglages
          </button>
        </div>
        <button
          class="settings-version"
          type="button"
          aria-label="Version de l'application"
        >
          v__APP_VERSION__ · __COMMIT_HASH__
        </button>
      </shared-panel>
    `;
  }
}

if (!customElements.get("settings-panel")) {
  customElements.define("settings-panel", SettingsPanel);
}
