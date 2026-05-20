import { html, LitElement } from "lit";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { shouldShowPanelFormVersion } from "../../config.js";
import { mountSettingsPanel } from "./settings-panel-controller.js";
import { initLoginUi } from "../../login-ui.js";
import { initDeleteAccountUi } from "../../delete-account-ui.js";

class SettingsPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.cleanupSettingsPanel = mountSettingsPanel({
      root: this,
      toggleButton: document.querySelector(".btn-open-settings"),
    });
    initLoginUi();
    initDeleteAccountUi();
    this.unsubscribeLocaleChange = subscribeLocaleChange(() => {
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.cleanupSettingsPanel?.();
    this.unsubscribeLocaleChange?.();
    super.disconnectedCallback();
  }

  render() {
    return html`
      <section
        class="settings-drawer"
        id="settingsDrawer"
        aria-label=${t("settings.drawerAria")}
        aria-hidden="true"
        hidden
      >
        <div class="settings-drawer-tabs" role="tablist" aria-label=${t("settings.tabsAria")}>
          <button
            class="settings-drawer-tab"
            id="settingsTabLogin"
            type="button"
            role="tab"
            aria-controls="settingsPanelLogin"
            aria-selected="true"
            data-settings-tab="login"
            tabindex="0"
          >
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M172,120a44,44,0,1,1-44-44A44,44,0,0,1,172,120Zm60-64V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H54.68a80,80,0,0,1,29.41-34.84,4,4,0,0,1,4.83.31,59.82,59.82,0,0,0,78.16,0,4,4,0,0,1,4.83-.31A80,80,0,0,1,201.32,200H216Z"/></svg>
            <span class="settings-drawer-tab-label">${t("settings.tab.login")}</span>
          </button>
          <button
            class="settings-drawer-tab"
            id="settingsTabLanguage"
            type="button"
            role="tab"
            aria-controls="settingsPanelLanguage"
            aria-selected="false"
            data-settings-tab="language"
            tabindex="-1"
          >
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M247.15,212.42l-56-112a8,8,0,0,0-14.31,0l-21.71,43.43A88,88,0,0,1,108,126.93,103.65,103.65,0,0,0,135.69,64H160a8,8,0,0,0,0-16H104V32a8,8,0,0,0-16,0V48H32a8,8,0,0,0,0,16h87.63A87.76,87.76,0,0,1,96,116.35a87.74,87.74,0,0,1-19-31,8,8,0,1,0-15.08,5.34A103.63,103.63,0,0,0,84,127a87.55,87.55,0,0,1-52,17,8,8,0,0,0,0,16,103.46,103.46,0,0,0,64-22.08,104.18,104.18,0,0,0,51.44,21.31l-26.6,53.19a8,8,0,0,0,14.31,7.16L148.94,192h70.11l13.79,27.58A8,8,0,0,0,240,224a8,8,0,0,0,7.15-11.58ZM156.94,176,184,121.89,211.05,176Z"/></svg>
            <span class="settings-drawer-tab-label">${t("settings.tab.language")}</span>
          </button>
          <button
            class="settings-drawer-tab"
            id="settingsTabWatermark"
            type="button"
            role="tab"
            aria-controls="settingsPanelWatermark"
            aria-selected="false"
            data-settings-tab="watermark"
            tabindex="-1"
          >
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,168H63.86c2.66-5.24,5.33-10.63,8-16.11,15,1.65,32.58-8.78,52.66-31.14,5,13.46,14.45,30.93,30.58,31.25,9.06.18,18.11-5.2,27.42-16.37C189.31,143.75,203.3,152,232,152a8,8,0,0,0,0-16c-30.43,0-39.43-10.45-40-16.11a7.67,7.67,0,0,0-5.46-7.75,8.14,8.14,0,0,0-9.25,3.49c-12.07,18.54-19.38,20.43-21.92,20.37-8.26-.16-16.66-19.52-19.54-33.42a8,8,0,0,0-14.09-3.37C101.54,124.55,88,133.08,79.57,135.29,88.06,116.42,94.4,99.85,98.46,85.9c6.82-23.44,7.32-39.83,1.51-50.1-3-5.38-9.34-11.8-22.06-11.8C61.85,24,49.18,39.18,43.14,65.65c-3.59,15.71-4.18,33.21-1.62,48s7.87,25.55,15.59,31.94c-3.73,7.72-7.53,15.26-11.23,22.41H24a8,8,0,0,0,0,16H37.41c-11.32,21-20.12,35.64-20.26,35.88a8,8,0,1,0,13.71,8.24c.15-.26,11.27-18.79,24.7-44.12H232a8,8,0,0,0,0-16ZM58.74,69.21C62.72,51.74,70.43,40,77.91,40c5.33,0,7.1,1.86,8.13,3.67,3,5.33,6.52,24.19-21.66,86.39C56.12,118.78,53.31,93,58.74,69.21Z"/></svg>
            <span class="settings-drawer-tab-label">${t("settings.tab.watermark")}</span>
          </button>
          <button
            class="settings-drawer-tab"
            id="settingsTabData"
            type="button"
            role="tab"
            aria-controls="settingsPanelData"
            aria-selected="false"
            data-settings-tab="data"
            tabindex="-1"
          >
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24C74.17,24,32,48.6,32,80v96c0,31.4,42.17,56,96,56s96-24.6,96-56V80C224,48.6,181.83,24,128,24Zm80,104c0,9.62-7.88,19.43-21.61,26.92C170.93,163.35,150.19,168,128,168s-42.93-4.65-58.39-13.08C55.88,147.43,48,137.62,48,128V111.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64Zm-21.61,74.92C170.93,211.35,150.19,216,128,216s-42.93-4.65-58.39-13.08C55.88,195.43,48,185.62,48,176V159.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64V176C208,185.62,200.12,195.43,186.39,202.92Z"/></svg>
            <span class="settings-drawer-tab-label">${t("settings.tab.data")}</span>
          </button>
        </div>

        <div class="settings-drawer-panels">

          <!-- Login Tab Panel -->
          <div
            class="settings-drawer-panel"
            id="settingsPanelLogin"
            role="tabpanel"
            aria-labelledby="settingsTabLogin"
            data-settings-tabpanel="login"
          >
            <div class="panel-form-field" id="communityEmailField">
              <div class="panel-form-field-header">
                <label class="panel-form-label" for="communityEmailInput">
                  ${t("login.emailLabel")}
                </label>
              </div>
              <input
                class="panel-form-text-input"
                id="communityEmailInput"
                type="email"
                autocomplete="email"
                placeholder=${t("login.emailPlaceholder")}
              />
              <button
                class="settings-action-button"
                id="communityRequestCodeButton"
                type="button"
              >
                <span>${t("login.requestCode")}</span>
              </button>
              <p class="panel-form-hint" id="communityAuthHint" hidden></p>
            </div>

            <div class="panel-form-field" id="communityCodeField" hidden>
              <div class="panel-form-field-header">
                <label class="panel-form-label" for="communityCodeInput">
                  ${t("login.codeLabel")}
                </label>
              </div>
              <input
                class="panel-form-text-input"
                id="communityCodeInput"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder=${t("login.codePlaceholder")}
              />
              <button
                class="settings-action-button"
                id="communityVerifyCodeButton"
                type="button"
              >
                <span>${t("login.verifyCode")}</span>
              </button>
            </div>

            <div class="settings-login-actions">
              <button
                class="settings-action-button"
                id="communityLogoutButton"
                type="button"
                hidden
              >
                ${t("login.logout")}
              </button>

              <a
                class="settings-action-button"
                id="communityMyCatchesLink"
                href="#"
                hidden
              >
                ${t("login.myCatches")}
              </a>
            </div>

            <p id="communityAccountState" class="settings-login-status"></p>
          </div>

          <!-- Language Tab Panel -->
          <div
            class="settings-drawer-panel"
            id="settingsPanelLanguage"
            role="tabpanel"
            aria-labelledby="settingsTabLanguage"
            data-settings-tabpanel="language"
            hidden
          >
            <div
              class="panel-form-locale-toggle"
              id="settingsLocaleToggle"
              role="group"
              aria-label=${t("settings.language.label")}
            >
              <button
                class="panel-form-locale-option"
                type="button"
                data-locale="fr"
                aria-pressed="false"
              >
                ${t("settings.language.option.fr")}
              </button>
              <button
                class="panel-form-locale-option"
                type="button"
                data-locale="en"
                aria-pressed="false"
              >
                ${t("settings.language.option.en")}
              </button>
            </div>
          </div>

          <!-- Watermark Tab Panel -->
          <div
            class="settings-drawer-panel"
            id="settingsPanelWatermark"
            role="tabpanel"
            aria-labelledby="settingsTabWatermark"
            data-settings-tabpanel="watermark"
            hidden
          >
            <div class="panel-form-field">
              <label class="panel-form-label" for="settingsPolaroidFooterLabelInput">
                ${t("settings.polaroid.label")}
              </label>
              <input
                class="panel-form-text-input"
                id="settingsPolaroidFooterLabelInput"
                type="text"
                placeholder=${t("settings.polaroid.placeholder")}
              />
              <p class="panel-form-hint">${t("settings.polaroid.defaultHint")}</p>
            </div>
          </div>

          <!-- Data Tab Panel -->
          <div
            class="settings-drawer-panel"
            id="settingsPanelData"
            role="tabpanel"
            aria-labelledby="settingsTabData"
            data-settings-tabpanel="data"
            hidden
          >
            <div class="settings-data-actions">
              <button
                class="settings-action-button"
                id="settingsExportButton"
                type="button"
              >
                ${t("settings.data.export")}
              </button>

              <label
                class="panel-form-file-label settings-action-button"
                id="settingsImportLabel"
              >
                <input
                  class="panel-form-file-input"
                  id="settingsImportInput"
                  type="file"
                  accept=".json"
                />
                <span class="panel-form-file-label-text">
                  ${t("settings.data.importLabel")}
                </span>
              </label>
            </div>

            <p
              class="settings-login-status settings-data-status"
              id="settingsDataStatus"
              aria-live="polite"
              hidden
            ></p>

            <div class="panel-form-danger-zone">
              <button
                class="settings-action-button panel-form-danger-button"
                id="settingsFlushDataButton"
                type="button"
              >
                ${t("settings.data.flush")}
              </button>
            </div>

            ${shouldShowPanelFormVersion()
              ? html`
                  <button
                    class="panel-form-version"
                    type="button"
                    aria-label=${t("settings.versionAria")}
                  >
                    v__APP_VERSION__ · __COMMIT_HASH__
                  </button>
                `
              : ""}

            <button
              class="settings-delete-link"
              id="communityDeleteAccountButton"
              type="button"
              hidden
            >
              ${t("login.deleteAccount")}
            </button>
          </div>

        </div>
      </section>
    `;
  }
}

if (!customElements.get("settings-panel")) {
  customElements.define("settings-panel", SettingsPanel);
}
