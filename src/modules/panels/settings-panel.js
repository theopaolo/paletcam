import { html, LitElement } from "lit";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { shouldShowPanelFormVersion } from "../../config.js";
import { mountSettingsPanel } from "./settings-panel-controller.js";
import { createSettingsBackupOperationCoordinator } from "./settings-backup-operation.js";
import { initLoginUi } from "../../login-ui.js";
import { initDeleteAccountUi } from "../../delete-account-ui.js";

class SettingsPanel extends LitElement {
  constructor() {
    super();
    this.backupOperations = createSettingsBackupOperationCoordinator();
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.mountControllers();
    this.unsubscribeLocaleChange = subscribeLocaleChange(() => {
      void this.remountForLocaleChange();
    });
  }

  mountControllers() {
    this.cleanupSettingsPanel = mountSettingsPanel({
      root: this,
      toggleButton: document.querySelector(".btn-open-settings"),
      backupOperations: this.backupOperations,
    });
    this.cleanupLoginUi = initLoginUi(this);
    this.cleanupDeleteAccountUi = initDeleteAccountUi();
  }

  cleanupControllers() {
    this.cleanupSettingsPanel?.();
    this.cleanupSettingsPanel = null;
    this.cleanupLoginUi?.();
    this.cleanupLoginUi = null;
    this.cleanupDeleteAccountUi?.();
    this.cleanupDeleteAccountUi = null;
  }

  async remountForLocaleChange() {
    const generation = (this.localeRenderGeneration ?? 0) + 1;
    this.localeRenderGeneration = generation;
    this.cleanupControllers();
    this.requestUpdate();
    await this.updateComplete;
    if (this.isConnected && this.localeRenderGeneration === generation) {
      this.mountControllers();
    }
  }

  disconnectedCallback() {
    this.localeRenderGeneration = (this.localeRenderGeneration ?? 0) + 1;
    this.cleanupControllers();
    this.unsubscribeLocaleChange?.();
    this.backupOperations.destroy();
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
                maxlength="320"
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
                maxlength="32"
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

            ${
              shouldShowPanelFormVersion()
                ? html`
                  <button
                    class="panel-form-version"
                    type="button"
                    aria-label=${t("settings.versionAria")}
                  >
                    v__APP_VERSION__ · __COMMIT_HASH__
                  </button>
                `
                : ""
            }

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
