import {
  getAppSettings,
  getDefaultAppSettings,
  getDefaultAppSettingsResetPatch,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { exportAllPalettes, importAllPalettes } from "../../palette-storage.js";
import { showToast } from "../toast-ui.js";
import { openSharedPanel } from "./panel-manager.js";

const integerFormatter = new Intl.NumberFormat("en-US");
const defaultAppSettings = getDefaultAppSettings();

function queryById(root, id) {
  if (!id) {
    return null;
  }

  return root.querySelector(`#${id}`);
}

function clampInteger(value, fallbackValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.round(numericValue);
}

function formatThousands(value) {
  return integerFormatter.format(clampInteger(value, 0));
}

function formatCompactThousands(value) {
  const safeValue = clampInteger(value, 0);
  if (safeValue >= 1000) {
    return `${Math.round(safeValue / 1000)}k`;
  }

  return String(safeValue);
}

function updateSliderShellTicks(shell, rangeInput) {
  if (!shell || !rangeInput) {
    return;
  }

  const minValue = Number(rangeInput.min) || 0;
  const maxValue = Number(rangeInput.max) || minValue;
  const stepValue = Number(rangeInput.step) || 1;
  const currentValue = Number(rangeInput.value) || minValue;
  const tickCount =
    Math.max(1, Math.floor((maxValue - minValue) / stepValue + Number.EPSILON) + 1);
  const tickIndex =
    Math.max(0, Math.floor((currentValue - minValue) / stepValue + Number.EPSILON));

  shell.style.setProperty("--tick-count", String(tickCount));
  shell.style.setProperty("--tick-index", String(tickIndex));
  shell.style.setProperty("--tick-intervals", String(Math.max(1, tickCount - 1)));
}

function getSettingsDom(root) {
  return {
    captureModeButtons: Array.from(root.querySelectorAll("[data-settings-capture-mode]")),
    oneMoreColorButtons: Array.from(root.querySelectorAll("[data-settings-one-more-color]")),
    paletteModeGroup: queryById(root, "settingsPaletteModeGroup"),
    resetButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "settingsResetButton")),
    exportButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsExportButton")
    ),
    importInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsImportInput")
    ),
  };
}

function createRangeControl({
  root,
  shellId,
  inputId,
  inlineValueId,
  displaySelector,
  getValueFromSettings,
  buildSettingsPatch,
  getAriaLabel,
  formatInlineValue = (value) => String(value),
  formatDisplayValue = formatInlineValue,
}) {
  const shell = queryById(root, shellId);
  const input = /** @type {HTMLInputElement | null} */ (queryById(root, inputId));
  const inlineValue = queryById(root, inlineValueId);
  const displayValue = displaySelector ? root.querySelector(displaySelector) : null;

  if (!input) {
    return null;
  }

  function renderFromSettings(settings) {
    const value = getValueFromSettings(settings);
    input.value = String(value);
    input.setAttribute("aria-label", getAriaLabel(value));
    if (inlineValue) {
      inlineValue.textContent = formatInlineValue(value);
    }
    if (displayValue) {
      displayValue.textContent = formatDisplayValue(value);
    }
    updateSliderShellTicks(shell, input);
  }

  function bindEvents(on) {
    on(input, "input", () => {
      const numericValue = Number(input.value);
      updateAppSettings(buildSettingsPatch(numericValue));
    });

    if (!shell) {
      return;
    }

    const activate = () => {
      shell.classList.add("is-active");
    };
    const deactivate = () => {
      shell.classList.remove("is-active");
    };

    on(input, "pointerdown", activate);
    on(input, "pointerup", deactivate);
    on(input, "pointercancel", deactivate);
    on(input, "blur", deactivate);
    on(input, "keyup", deactivate);
  }

  return {
    bindEvents,
    renderFromSettings,
  };
}

function syncCaptureModeButtons(dom, activeMode) {
  dom.captureModeButtons.forEach((button) => {
    const buttonMode = button.getAttribute("data-settings-capture-mode");
    button.setAttribute("aria-pressed", String(buttonMode === activeMode));
  });
}

function syncOneMoreColorButtons(dom, isEnabled) {
  dom.oneMoreColorButtons.forEach((button) => {
    const nextValue = button.getAttribute("data-settings-one-more-color");
    const shouldBeActive = (nextValue === "on") === Boolean(isEnabled);
    button.setAttribute("aria-pressed", String(shouldBeActive));
  });
}

function syncPaletteModeGroupVisibility(dom, captureMode) {
  if (dom.paletteModeGroup) {
    dom.paletteModeGroup.hidden = captureMode === "ral";
  }
}

export function mountSettingsPanel({ root, openButton }) {
  const dom = getSettingsDom(root);
  const cleanups = [];

  const on = (element, eventName, handler, options) => {
    if (!element) {
      return;
    }

    element.addEventListener(eventName, handler, options);
    cleanups.push(() => {
      element.removeEventListener(eventName, handler, options);
    });
  };

  const rangeControls = [
    createRangeControl({
      root,
      shellId: "settingsPhotoQualitySlider",
      inputId: "settingsPhotoQualityRange",
      inlineValueId: "settingsPhotoQualityValue",
      displaySelector: "[data-settings-quality-display]",
      getValueFromSettings: (settings) =>
        Math.round((settings.photoExportQuality || 0) * 100),
      buildSettingsPatch: (percentValue) => ({
        photoExportQuality: percentValue / 100,
      }),
      getAriaLabel: (value) => `Qualité d'image : ${value}%`,
      formatInlineValue: (value) => `${value}%`,
      formatDisplayValue: (value) => `${value}%`,
    }),
    createRangeControl({
      root,
      shellId: "settingsMedianCutPoolSlider",
      inputId: "settingsMedianCutPoolRange",
      inlineValueId: "settingsMedianCutPoolValue",
      displaySelector: "[data-settings-median-cut-pool-display]",
      getValueFromSettings: (settings) => settings.medianCut.quantizedPoolSize,
      buildSettingsPatch: (value) => ({
        medianCut: {
          quantizedPoolSize: clampInteger(
            value,
            defaultAppSettings.medianCut.quantizedPoolSize,
          ),
        },
      }),
      getAriaLabel: (value) => `Nombre de couleurs analysées : ${value}`,
    }),
    createRangeControl({
      root,
      shellId: "settingsMedianCutPixelsSlider",
      inputId: "settingsMedianCutPixelsRange",
      inlineValueId: "settingsMedianCutPixelsValue",
      displaySelector: "[data-settings-median-cut-pixels-display]",
      getValueFromSettings: (settings) => settings.medianCut.maxQuantizerPixels,
      buildSettingsPatch: (value) => ({
        medianCut: {
          maxQuantizerPixels: clampInteger(
            value,
            defaultAppSettings.medianCut.maxQuantizerPixels,
          ),
        },
      }),
      getAriaLabel: (value) => `Pixels analysés max : ${value}`,
      formatInlineValue: (value) => formatThousands(value),
      formatDisplayValue: (value) => formatCompactThousands(value),
    }),
    createRangeControl({
      root,
      shellId: "settingsScoringVibrancySlider",
      inputId: "settingsScoringVibrancyRange",
      inlineValueId: "settingsScoringVibrancyValue",
      displaySelector: "[data-settings-scoring-vibrancy-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.chromaWeight,
      buildSettingsPatch: (value) => ({
        paletteScoring: {
          chromaWeight: clampInteger(value, defaultAppSettings.paletteScoring.chromaWeight),
        },
      }),
      getAriaLabel: (value) => `Préférence pour les couleurs vives : ${value}`,
    }),
    createRangeControl({
      root,
      shellId: "settingsScoringContrastSlider",
      inputId: "settingsScoringContrastRange",
      inlineValueId: "settingsScoringContrastValue",
      displaySelector: "[data-settings-scoring-contrast-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.lumaSpreadWeight,
      buildSettingsPatch: (value) => ({
        paletteScoring: {
          lumaSpreadWeight: clampInteger(
            value,
            defaultAppSettings.paletteScoring.lumaSpreadWeight,
          ),
        },
      }),
      getAriaLabel: (value) => `Contraste clair/foncé : ${value}`,
    }),
    createRangeControl({
      root,
      shellId: "settingsScoringRaritySlider",
      inputId: "settingsScoringRarityRange",
      inlineValueId: "settingsScoringRarityValue",
      displaySelector: "[data-settings-scoring-rarity-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.rarityWeight,
      buildSettingsPatch: (value) => ({
        paletteScoring: {
          rarityWeight: clampInteger(value, defaultAppSettings.paletteScoring.rarityWeight),
        },
      }),
      getAriaLabel: (value) => `Bonus aux teintes rares : ${value}`,
    }),
    createRangeControl({
      root,
      shellId: "settingsScoringDiversitySlider",
      inputId: "settingsScoringDiversityRange",
      inlineValueId: "settingsScoringDiversityValue",
      displaySelector: "[data-settings-scoring-diversity-display]",
      getValueFromSettings: (settings) => settings.paletteScoring.diversityWeight,
      buildSettingsPatch: (value) => ({
        paletteScoring: {
          diversityWeight: clampInteger(
            value,
            defaultAppSettings.paletteScoring.diversityWeight,
          ),
        },
      }),
      getAriaLabel: (value) => `Écart entre les couleurs : ${value}`,
    }),
  ].filter(Boolean);

  function renderSettingsUi(settings) {
    rangeControls.forEach((control) => {
      control.renderFromSettings(settings);
    });

    syncCaptureModeButtons(dom, settings.captureMode);
    syncOneMoreColorButtons(dom, settings.oneMoreColor);
    syncPaletteModeGroupVisibility(dom, settings.captureMode);
  }

  on(openButton, "click", () => {
    openSharedPanel("settings");
  });

  dom.captureModeButtons.forEach((button) => {
    on(button, "click", () => {
      const nextMode = button.getAttribute("data-settings-capture-mode");
      if (nextMode === "palette" || nextMode === "ral") {
        updateAppSettings({ captureMode: nextMode });
      }
    });
  });

  dom.oneMoreColorButtons.forEach((button) => {
    on(button, "click", () => {
      const nextValue = button.getAttribute("data-settings-one-more-color");
      if (nextValue !== "on" && nextValue !== "off") {
        return;
      }

      updateAppSettings({
        oneMoreColor: nextValue === "on",
      });
    });
  });

  rangeControls.forEach((control) => {
    control.bindEvents(on);
  });

  on(dom.resetButton, "click", () => {
    updateAppSettings(getDefaultAppSettingsResetPatch());
    showToast("Réglages réinitialisés.", { duration: 1400 });
  });

  on(dom.exportButton, "click", async () => {
    if (!dom.exportButton) {
      return;
    }

    dom.exportButton.disabled = true;
    try {
      const json = await exportAllPalettes();
      const blob = new Blob([json], { type: "application/json" });
      const filename = `paletcam-export-${new Date().toISOString().slice(0, 10)}.json`;

      if (typeof navigator.canShare === "function") {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            showToast("Export terminé.", { duration: 1400 });
            return;
          } catch (shareError) {
            if (shareError instanceof Error && shareError.name === "AbortError") {
              return;
            }
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("Export terminé.", { duration: 1400 });
    } catch (error) {
      console.error("Export failed:", error);
      showToast("Erreur lors de l'export.", { duration: 2000 });
    } finally {
      if (dom.exportButton) {
        dom.exportButton.disabled = false;
      }
    }
  });

  on(dom.importInput, "change", async () => {
    if (!dom.importInput) {
      return;
    }

    const file = dom.importInput.files?.[0];
    if (!file) {
      return;
    }

    dom.importInput.disabled = true;
    try {
      const text = await file.text();
      const count = await importAllPalettes(text);
      showToast(
        `${count} palette${count > 1 ? "s" : ""} importée${count > 1 ? "s" : ""}.`,
        { duration: 2000 },
      );
    } catch (error) {
      console.error("Import failed:", error);
      showToast("Erreur lors de l'import. Vérifiez le fichier.", { duration: 2500 });
    } finally {
      dom.importInput.value = "";
      dom.importInput.disabled = false;
    }
  });

  renderSettingsUi(getAppSettings());
  const unsubscribe = subscribeAppSettings(renderSettingsUi);

  return () => {
    unsubscribe();
    cleanups.forEach((cleanup) => cleanup());
  };
}
