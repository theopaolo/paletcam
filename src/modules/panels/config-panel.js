import { html, LitElement } from "lit";
import { subscribeLocaleChange, t } from "../../i18n.js";
import { mountConfigPanel } from "./config-panel-controller.js";
import { HYBRID_STEPPED_CONTROLS } from "./perceptual-tuning.js";

function renderHybridSteppedField({ controlKey, shellId, inputId }) {
  const control = HYBRID_STEPPED_CONTROLS[controlKey];
  const defaultLabel = t(
    `config.hybrid.${controlKey}.step.${control.labelKeys[control.defaultIndex]}`,
  );

  return html`
    <div class="panel-form-field">
      <details class="panel-form-field-header">
        <summary class="panel-form-label" for=${inputId}>
          ${t(`config.hybrid.${controlKey}.title`)}
        </summary>
        <p class="panel-form-hint">
          ${t(`config.hybrid.${controlKey}.hint`)}
        </p>
      </details>

      <div
        class="swatch-slider panel-form-quality-slider config-drawer-slider is-stepped"
        id=${shellId}
      >
        <input
          id=${inputId}
          type="range"
          min="0"
          max=${control.steps.length - 1}
          value=${control.defaultIndex}
          step="1"
          aria-label=${t(`config.hybrid.${controlKey}.aria`, { value: defaultLabel })}
        />
        <div
          class="config-step-labels"
          data-config-step-labels=${controlKey}
          data-active-index=${control.defaultIndex}
          aria-hidden="true"
        >
          ${control.labelKeys.map(
            (labelKey) => html`<span>${t(`config.hybrid.${controlKey}.step.${labelKey}`)}</span>`,
          )}
        </div>
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
        <div class="config-drawer-tabs" role="tablist" aria-label=${t("config.tabsAria")}>
          <button
            class="config-drawer-tab"
            id="configTabColors"
            type="button"
            role="tab"
            aria-controls="configPanelColors"
            aria-selected="true"
            data-config-tab="colors"
            tabindex="0"
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
        </div>

        <div class="config-drawer-panels">
          <section
            class="config-drawer-panel"
            id="configPanelColors"
            role="tabpanel"
            aria-labelledby="configTabColors"
            data-config-tabpanel="colors"
          >
            ${renderHybridSteppedField({
              controlKey: "tone",
              shellId: "configHybridToneSlider",
              inputId: "configHybridToneRange",
            })}
            ${renderHybridSteppedField({
              controlKey: "rarity",
              shellId: "configHybridRaritySlider",
              inputId: "configHybridRarityRange",
            })}
          </section>

          <section
            class="config-drawer-panel"
            id="configPanelBalance"
            role="tabpanel"
            aria-labelledby="configTabBalance"
            data-config-tabpanel="balance"
            hidden
          >
            ${renderHybridSteppedField({
              controlKey: "spread",
              shellId: "configHybridSpreadSlider",
              inputId: "configHybridSpreadRange",
            })}
            ${renderHybridSteppedField({
              controlKey: "loyalty",
              shellId: "configHybridLoyaltySlider",
              inputId: "configHybridLoyaltyRange",
            })}
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
