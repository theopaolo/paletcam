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

          <section class="settings-section" aria-labelledby="settingsPolaroidTitle">
            <div class="settings-section-header">
              <h3 id="settingsPolaroidTitle">Polaroid</h3>
            </div>

            <div class="settings-field">
              <div class="settings-field-header">
                <label class="settings-label" for="settingsPolaroidFooterLabelInput">
                  Texte affiché en bas des exports polaroid.
                </label>
              </div>
              <input
                class="settings-text-input"
                id="settingsPolaroidFooterLabelInput"
                type="text"
                placeholder="colorcatchers.co"
              />
              <p class="settings-hint">Par défaut : colorcatchers.co</p>
            </div>
          </section>

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
