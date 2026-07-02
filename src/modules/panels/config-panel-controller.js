import {
  getAppSettings,
  getDefaultAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { t } from "../../i18n.js";
import {
  areAlgorithmSettingsEqual,
  cloneAlgorithmSettings,
} from "../algorithm-settings.js";
import { createAlgorithmSettingsHistory } from "./algorithm-settings-history.js";
import {
  clampInteger,
  createRangeControl,
  formatCompactThousands,
  formatThousands,
} from "./settings-range-control.js";

const TAB_IDS = ["analysis", "colors", "balance"];
const CONFIG_TOGGLE_CLOSE_ICON_CLASS = "is-close";

function queryById(root, id) {
  if (!id) {
    return null;
  }

  return root.querySelector(`#${id}`);
}

function getConfigDom(root) {
  return {
    drawer: queryById(root, "configDrawer"),
    oneMoreColorToggle: /** @type {HTMLInputElement | null} */ (
      queryById(root, "configOneMoreColorToggle")
    ),
    paletteSelectorSelect: /** @type {HTMLSelectElement | null} */ (
      queryById(root, "configPaletteSelectorSelect")
    ),
    redoButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configRedoButton")),
    resetButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configResetButton")),
    tabButtons: Array.from(root.querySelectorAll("[data-config-tab]")),
    tabPanels: Array.from(root.querySelectorAll("[data-config-tabpanel]")),
    undoButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configUndoButton")),
  };
}

function getNextTabId(currentTabId, direction) {
  const currentIndex = TAB_IDS.indexOf(currentTabId);
  if (currentIndex < 0) {
    return TAB_IDS[0];
  }

  const nextIndex = (currentIndex + direction + TAB_IDS.length) % TAB_IDS.length;
  return TAB_IDS[nextIndex];
}

function isEventInsideElement(event, element) {
  if (!element) {
    return false;
  }

  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (eventPath.includes(element)) {
    return true;
  }

  return Boolean(event.target && typeof element.contains === "function" && element.contains(event.target));
}

export function mountConfigPanel({ root, toggleButton, toggleSection }) {
  const dom = getConfigDom(root);
  const toggleButtonIcon = /** @type {HTMLElement | null} */ (
    toggleButton?.querySelector(".btn-config-icon") ?? null
  );
  const toggleButtonLabel = /** @type {HTMLElement | null} */ (
    toggleButton?.querySelector(".btn-config-label") ?? null
  );
  const toggleButtonOpenAriaLabelKey =
    toggleButton?.getAttribute("data-i18n-aria-label") || "capture.configOpen";
  const toggleButtonOpenLabelKey =
    toggleButtonLabel?.getAttribute("data-i18n") || "capture.configLabel";
  const cleanups = [];
  const defaultAlgorithmSettings = cloneAlgorithmSettings(getDefaultAppSettings());
  const history = createAlgorithmSettingsHistory({
    initialSnapshot: cloneAlgorithmSettings(getAppSettings()),
  });
  let activeTabId = "analysis";
  let isDrawerOpen = false;

  const on = (element, eventName, handler, options) => {
    if (!element) {
      return;
    }

    element.addEventListener(eventName, handler, options);
    cleanups.push(() => {
      element.removeEventListener(eventName, handler, options);
    });
  };

  function syncConfigToggleButton() {
    if (!toggleButton) {
      return;
    }

    toggleButton.classList.toggle("is-active", isDrawerOpen);
    toggleButton.setAttribute("aria-expanded", String(isDrawerOpen));
    toggleButton.setAttribute(
      "aria-label",
      t(isDrawerOpen ? "capture.configClose" : toggleButtonOpenAriaLabelKey),
    );

    toggleButtonIcon?.classList.toggle(CONFIG_TOGGLE_CLOSE_ICON_CLASS, isDrawerOpen);

    if (toggleButtonLabel) {
      toggleButtonLabel.textContent = t(
        isDrawerOpen ? "capture.configCloseLabel" : toggleButtonOpenLabelKey,
      );
    }
  }

  function syncDrawerState() {
    if (dom.drawer) {
      dom.drawer.hidden = !isDrawerOpen;
      dom.drawer.setAttribute("aria-hidden", String(!isDrawerOpen));
    }

    syncConfigToggleButton();

    root.classList.toggle("is-open", isDrawerOpen);
    root.dispatchEvent?.(
      new CustomEvent("config-drawer-change", { bubbles: true, detail: { isOpen: isDrawerOpen } }),
    );
  }

  function setDrawerOpen(nextOpen, { restoreFocus = false } = {}) {
    if (toggleButton?.hidden || toggleSection?.hidden) {
      nextOpen = false;
    }

    if (isDrawerOpen === nextOpen) {
      syncDrawerState();
      return;
    }

    isDrawerOpen = nextOpen;
    syncDrawerState();

    if (!isDrawerOpen && restoreFocus && typeof toggleButton?.focus === "function") {
      toggleButton.focus();
    }
  }

  function syncHistoryButtons() {
    const { canRedo, canUndo } = history.getState();

    if (dom.undoButton) {
      dom.undoButton.disabled = !canUndo;
    }

    if (dom.redoButton) {
      dom.redoButton.disabled = !canRedo;
    }
  }

  function syncOneMoreColorToggle(settings) {
    if (!dom.oneMoreColorToggle) {
      return;
    }

    dom.oneMoreColorToggle.checked = Boolean(settings.oneMoreColor);
  }

  function syncPaletteSelector(settings) {
    const isHybrid = settings.paletteSelector === "perceptual";

    if (dom.paletteSelectorSelect) {
      dom.paletteSelectorSelect.value = isHybrid ? "perceptual" : "current";
    }

    root.classList.toggle("config-selector-perceptual", isHybrid);

    root.querySelectorAll("[data-mode]").forEach((field) => {
      const mode = field.getAttribute("data-mode");
      field.hidden = isHybrid ? mode !== "perceptual" : mode !== "current";
    });
  }

  function setActiveTab(nextTabId, { focusButton = false } = {}) {
    activeTabId = TAB_IDS.includes(nextTabId) ? nextTabId : TAB_IDS[0];

    dom.tabButtons.forEach((button) => {
      const tabId = button.getAttribute("data-config-tab");
      const isActive = tabId === activeTabId;
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
      button.classList.toggle("is-active", isActive);

      if (isActive && focusButton && typeof button.focus === "function") {
        button.focus();
      }
    });

    dom.tabPanels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-config-tabpanel") !== activeTabId;
    });
  }

  function syncDrawerAvailability(settings) {
    const isRalMode = settings.captureMode === "ral";
    if (toggleSection) {
      toggleSection.hidden = isRalMode;
    }

    if (toggleButton) {
      toggleButton.hidden = isRalMode;
    }

    if (isRalMode) {
      setDrawerOpen(false);
    }
  }

  function applyAlgorithmSettings(mutator) {
    const nextSnapshot = cloneAlgorithmSettings(getAppSettings());
    mutator(nextSnapshot);
    history.setCurrentSnapshot(nextSnapshot);
    updateAppSettings(cloneAlgorithmSettings(nextSnapshot));
  }

  function bindSliderControl(control) {
    control?.bindEvents(on);
  }

  function bindTabButton(button) {
    on(button, "click", () => {
      const tabId = button.getAttribute("data-config-tab");
      if (tabId) {
        setActiveTab(tabId);
      }
    });

    on(button, "keydown", (event) => {
      const currentTabId = button.getAttribute("data-config-tab") || activeTabId;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveTab(getNextTabId(currentTabId, -1), { focusButton: true });
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveTab(getNextTabId(currentTabId, 1), { focusButton: true });
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveTab(TAB_IDS[0], { focusButton: true });
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveTab(TAB_IDS[TAB_IDS.length - 1], { focusButton: true });
      }
    });
  }

  function beginAlgorithmInteraction() {
    history.beginInteraction(cloneAlgorithmSettings(getAppSettings()));
  }

  function commitAlgorithmInteraction() {
    history.commitInteraction(cloneAlgorithmSettings(getAppSettings()));
    syncHistoryButtons();
  }

  const rangeControls = [
    createRangeControl({
      root,
      shellId: "configScoringDiversitySlider",
      inputId: "configScoringDiversityRange",
      displaySelector: "[data-config-scoring-diversity-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.diversityWeight,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.paletteScoring.diversityWeight = clampInteger(
            value,
            defaultAlgorithmSettings.paletteScoring.diversityWeight,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.balance.diversity.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configScoringContrastSlider",
      inputId: "configScoringContrastRange",
      displaySelector: "[data-config-scoring-contrast-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.lumaSpreadWeight,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.paletteScoring.lumaSpreadWeight = clampInteger(
            value,
            defaultAlgorithmSettings.paletteScoring.lumaSpreadWeight,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.balance.contrast.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configScoringVibrancySlider",
      inputId: "configScoringVibrancyRange",
      displaySelector: "[data-config-scoring-vibrancy-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.chromaWeight,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.paletteScoring.chromaWeight = clampInteger(
            value,
            defaultAlgorithmSettings.paletteScoring.chromaWeight,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.colors.vibrancy.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configScoringRaritySlider",
      inputId: "configScoringRarityRange",
      displaySelector: "[data-config-scoring-rarity-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.rarityWeight,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.paletteScoring.rarityWeight = clampInteger(
            value,
            defaultAlgorithmSettings.paletteScoring.rarityWeight,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.colors.rarity.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configMedianCutPoolSlider",
      inputId: "configMedianCutPoolRange",
      displaySelector: "[data-config-median-cut-pool-display]",
      getValueFromSettings: (settings) => settings.medianCut.quantizedPoolSize,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.medianCut.quantizedPoolSize = clampInteger(
            value,
            defaultAlgorithmSettings.medianCut.quantizedPoolSize,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.analysis.pool.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configMedianCutPixelsSlider",
      inputId: "configMedianCutPixelsRange",
      displaySelector: "[data-config-median-cut-pixels-display]",
      getValueFromSettings: (settings) => settings.medianCut.maxQuantizerPixels,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.medianCut.maxQuantizerPixels = clampInteger(
            value,
            defaultAlgorithmSettings.medianCut.maxQuantizerPixels,
          );
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.analysis.pixels.aria", { value }),
      formatInlineValue: (value) => formatThousands(value),
      formatDisplayValue: (value) => formatCompactThousands(value),
    }),
    createRangeControl({
      root,
      shellId: "configHybridToneSlider",
      inputId: "configHybridToneRange",
      displaySelector: "[data-config-hybrid-tone-display]",
      getValueFromSettings: (settings) =>
        Math.round((settings.hybrid?.tone ?? defaultAlgorithmSettings.hybrid.tone) * 100),
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.hybrid.tone =
            Math.round(value) / 100;
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.hybrid.tone.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configHybridRaritySlider",
      inputId: "configHybridRarityRange",
      displaySelector: "[data-config-hybrid-rarity-display]",
      getValueFromSettings: (settings) =>
        Math.round(
          (settings.hybrid?.rarityStrength ?? defaultAlgorithmSettings.hybrid.rarityStrength) *
            100,
        ),
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.hybrid.rarityStrength = Math.round(value) / 100;
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.hybrid.rarity.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configHybridSpreadSlider",
      inputId: "configHybridSpreadRange",
      displaySelector: "[data-config-hybrid-spread-display]",
      getValueFromSettings: (settings) =>
        Math.round(
          (settings.hybrid?.spreadStrength ?? defaultAlgorithmSettings.hybrid.spreadStrength) *
            100,
        ),
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.hybrid.spreadStrength = Math.round(value) / 100;
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.hybrid.spread.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configHybridRepulsionSlider",
      inputId: "configHybridRepulsionRange",
      displaySelector: "[data-config-hybrid-repulsion-display]",
      getValueFromSettings: (settings) =>
        Math.round(
          (settings.hybrid?.repulsionRadius ?? defaultAlgorithmSettings.hybrid.repulsionRadius) *
            100,
        ),
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.hybrid.repulsionRadius = Math.round(value) / 100;
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.hybrid.repulsion.aria", { value }),
    }),
    createRangeControl({
      root,
      shellId: "configHybridLoyaltySlider",
      inputId: "configHybridLoyaltyRange",
      displaySelector: "[data-config-hybrid-loyalty-display]",
      getValueFromSettings: (settings) =>
        Math.round(
          (settings.hybrid?.loyaltyStrength ?? defaultAlgorithmSettings.hybrid.loyaltyStrength) *
            100,
        ),
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          snapshot.hybrid.loyaltyStrength = Math.round(value) / 100;
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) => t("config.hybrid.loyalty.aria", { value }),
    }),
  ].filter(Boolean);

  function renderConfigUi(settings) {
    const algorithmSnapshot = cloneAlgorithmSettings(settings);
    const historyState = history.getState();

    if (
      !historyState.hasActiveInteraction &&
      !areAlgorithmSettingsEqual(historyState.currentSnapshot, algorithmSnapshot)
    ) {
      history.clearHistory(algorithmSnapshot);
    }

    rangeControls.forEach((control) => {
      control.renderFromSettings(settings);
    });
    syncOneMoreColorToggle(settings);
    syncPaletteSelector(settings);
    syncDrawerAvailability(settings);
    syncConfigToggleButton();
    syncHistoryButtons();
  }

  if (toggleButton) {
    toggleButton.setAttribute("aria-controls", "configDrawer");
    toggleButton.setAttribute("aria-expanded", "false");
  }

  on(toggleButton, "click", () => {
    setDrawerOpen(!isDrawerOpen);
  });

  on(document, "keydown", (event) => {
    if (event.key === "Escape" && isDrawerOpen) {
      event.preventDefault();
      setDrawerOpen(false, { restoreFocus: true });
    }
  });

  on(document, "pointerdown", (event) => {
    if (
      !isDrawerOpen ||
      isEventInsideElement(event, root) ||
      isEventInsideElement(event, toggleButton) ||
      isEventInsideElement(event, toggleSection)
    ) {
      return;
    }

    setDrawerOpen(false);
  });

  dom.tabButtons.forEach(bindTabButton);
  on(dom.oneMoreColorToggle, "change", () => {
    if (!dom.oneMoreColorToggle) {
      return;
    }

    updateAppSettings({
      oneMoreColor: dom.oneMoreColorToggle.checked,
    });
  });
  on(dom.paletteSelectorSelect, "change", () => {
    if (!dom.paletteSelectorSelect) {
      return;
    }

    const value = dom.paletteSelectorSelect.value;
    if (value !== "current" && value !== "perceptual") {
      return;
    }

    beginAlgorithmInteraction();
    applyAlgorithmSettings((snapshot) => {
      snapshot.paletteSelector = value;
    });
    commitAlgorithmInteraction();
  });
  rangeControls.forEach(bindSliderControl);

  on(dom.undoButton, "click", () => {
    const nextSnapshot = history.undo();
    if (!nextSnapshot) {
      return;
    }

    updateAppSettings(cloneAlgorithmSettings(nextSnapshot));
    syncHistoryButtons();
  });

  on(dom.redoButton, "click", () => {
    const nextSnapshot = history.redo();
    if (!nextSnapshot) {
      return;
    }

    updateAppSettings(cloneAlgorithmSettings(nextSnapshot));
    syncHistoryButtons();
  });

  on(dom.resetButton, "click", () => {
    if (!history.reset(defaultAlgorithmSettings)) {
      syncHistoryButtons();
      return;
    }

    updateAppSettings(cloneAlgorithmSettings(defaultAlgorithmSettings));
    syncHistoryButtons();
  });

  setActiveTab(activeTabId);
  syncDrawerState();
  renderConfigUi(getAppSettings());
  const unsubscribe = subscribeAppSettings(renderConfigUi);

  return () => {
    unsubscribe();
    cleanups.forEach((cleanup) => {
      cleanup();
    });
  };
}
