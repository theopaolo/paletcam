import {
  getAppSettings,
  getDefaultAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { t } from "../../i18n.js";
import { areAlgorithmSettingsEqual, cloneAlgorithmSettings } from "../algorithm-settings.js";
import { createAlgorithmSettingsHistory } from "./algorithm-settings-history.js";
import { createRangeControl } from "./settings-range-control.js";

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
    neutralBalanceInputs: /** @type {HTMLInputElement[]} */ ([
      ...root.querySelectorAll(".config-drawer-neutral-input"),
    ]),
    originBadgesToggle: /** @type {HTMLInputElement | null} */ (
      queryById(root, "configOriginBadgesToggle")
    ),
    redoButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configRedoButton")),
    resetButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configResetButton")),
    undoButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "configUndoButton")),
  };
}

function isEventInsideElement(event, element) {
  if (!element) {
    return false;
  }

  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (eventPath.includes(element)) {
    return true;
  }

  return Boolean(
    event.target && typeof element.contains === "function" && element.contains(event.target),
  );
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

  function syncOriginBadgesToggle(settings) {
    if (!dom.originBadgesToggle) {
      return;
    }

    dom.originBadgesToggle.checked = Boolean(settings.originBadgesEnabled);
  }

  function syncNeutralBalance(settings) {
    dom.neutralBalanceInputs.forEach((input) => {
      input.checked = input.value === settings.hybrid.neutralBalance;
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

  function beginAlgorithmInteraction() {
    history.beginInteraction(cloneAlgorithmSettings(getAppSettings()));
  }

  function commitAlgorithmInteraction() {
    history.commitInteraction(cloneAlgorithmSettings(getAppSettings()));
    syncHistoryButtons();
  }

  function createTuningControl({
    controlKey,
    shellId,
    inputId,
    inlineValueId,
    getValueFromSettings,
    applyValue,
    formatValue,
  }) {
    return createRangeControl({
      root,
      shellId,
      inputId,
      inlineValueId,
      getValueFromSettings,
      onValueInput: (value) => {
        applyAlgorithmSettings((snapshot) => {
          applyValue(snapshot, value);
        });
      },
      onInteractionStart: beginAlgorithmInteraction,
      onInteractionCommit: commitAlgorithmInteraction,
      getAriaLabel: (value) =>
        t(`config.production.${controlKey}.aria`, { value: formatValue(value) }),
      formatInlineValue: formatValue,
    });
  }

  const rangeControls = [
    createTuningControl({
      controlKey: "analyze",
      shellId: "configAnalyzeSlider",
      inputId: "configAnalyzeRange",
      inlineValueId: "configAnalyzeValue",
      getValueFromSettings: (settings) => settings.medianCut.quantizedPoolSize,
      applyValue: (snapshot, value) => {
        snapshot.medianCut.quantizedPoolSize = Math.round(value);
      },
      formatValue: (value) => String(Math.round(value)),
    }),
    createTuningControl({
      controlKey: "density",
      shellId: "configDensitySlider",
      inputId: "configDensityRange",
      inlineValueId: "configDensityValue",
      getValueFromSettings: (settings) => settings.medianCut.maxQuantizerPixels,
      applyValue: (snapshot, value) => {
        snapshot.medianCut.maxQuantizerPixels = Math.round(value);
      },
      formatValue: (value) => `${Math.round(value / 1000)}k`,
    }),
    createTuningControl({
      controlKey: "tone",
      shellId: "configToneSlider",
      inputId: "configToneRange",
      inlineValueId: "configToneValue",
      getValueFromSettings: (settings) => Math.round(settings.hybrid.tone * 100),
      applyValue: (snapshot, value) => {
        snapshot.hybrid.tone = Math.round(value) / 100;
      },
      formatValue: (value) => `${Math.round(value)}%`,
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
    syncNeutralBalance(settings);
    syncOriginBadgesToggle(settings);
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

  on(dom.originBadgesToggle, "change", () => {
    if (!dom.originBadgesToggle) {
      return;
    }

    updateAppSettings({
      originBadgesEnabled: dom.originBadgesToggle.checked,
    });
  });
  rangeControls.forEach(bindSliderControl);
  dom.neutralBalanceInputs.forEach((input) => {
    on(input, "change", () => {
      if (!input.checked || input.value === getAppSettings().hybrid.neutralBalance) {
        return;
      }

      beginAlgorithmInteraction();
      applyAlgorithmSettings((snapshot) => {
        snapshot.hybrid.neutralBalance = input.value;
      });
      commitAlgorithmInteraction();
    });
  });

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
