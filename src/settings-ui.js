import {
  getAppSettings,
  getDefaultAppSettings,
  getDefaultAppSettingsResetPatch,
  PALETTE_ANALYSIS_PROFILES,
  subscribeAppSettings,
  updateAppSettings,
} from "./app-settings.js";
import { PALETTE_EXTRACTION_ALGORITHMS } from "./modules/palette-extraction.js";
import { openSharedPanel } from "./modules/panels/panel-manager.js";
import { showToast } from "./modules/toast-ui.js";
import { exportAllPalettes, importAllPalettes } from "./palette-storage.js";

const SETTINGS_VERSION_TAP_TARGET = 4;
const SETTINGS_VERSION_TAP_RESET_MS = 1200;
const openSettingsButton = document.querySelector(".btn-open-settings");
const integerFormatter = new Intl.NumberFormat("en-US");
const defaultAppSettings = getDefaultAppSettings();
const analysisProfileButtons = Array.from(
  document.querySelectorAll("[data-settings-analysis-profile]"),
);
const analysisProfileStatus = document.getElementById("settingsAnalysisProfileStatus");
const algorithmButtons = Array.from(document.querySelectorAll("[data-settings-algorithm]"));
const colorSpaceButtons = Array.from(document.querySelectorAll("[data-settings-color-space]"));
const captureModeButtons = Array.from(document.querySelectorAll("[data-settings-capture-mode]"));
const performanceHudButtons = Array.from(
  document.querySelectorAll("[data-settings-performance-hud]"),
);
const paletteModeGroup = document.getElementById("settingsPaletteModeGroup");
const settingsVersionTrigger = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("settingsVersionTrigger")
);
const advancedSettingsElements = /** @type {HTMLElement[]} */ (
  Array.from(document.querySelectorAll("[data-settings-advanced]"))
);
const algorithmPanels = /** @type {HTMLElement[]} */ (
  Array.from(document.querySelectorAll("[data-settings-algorithm-panel]"))
);
let isAdvancedSettingsUnlocked = false;
let settingsVersionTapCount = 0;
let lastSettingsVersionTapAt = 0;

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
  const tickCount = Math.max(1, Math.floor((maxValue - minValue) / stepValue + Number.EPSILON) + 1);
  const tickIndex = Math.max(0, Math.floor((currentValue - minValue) / stepValue + Number.EPSILON));

  shell.style.setProperty("--tick-count", String(tickCount));
  shell.style.setProperty("--tick-index", String(tickIndex));
  shell.style.setProperty("--tick-intervals", String(Math.max(1, tickCount - 1)));
}

function createRangeControl({
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
  const shell = document.getElementById(shellId);
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById(inputId));
  const inlineValue = document.getElementById(inlineValueId);
  const displayValue = document.querySelector(displaySelector);

  if (!input || !inlineValue || !displayValue) {
    return null;
  }

  function renderFromSettings(settings) {
    const value = getValueFromSettings(settings);
    input.value = String(value);
    input.setAttribute("aria-label", getAriaLabel(value));
    inlineValue.textContent = formatInlineValue(value);
    displayValue.textContent = formatDisplayValue(value);
    updateSliderShellTicks(shell, input);
  }

  function bindEvents() {
    input.addEventListener("input", () => {
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

    input.addEventListener("pointerdown", activate);
    input.addEventListener("pointerup", deactivate);
    input.addEventListener("pointercancel", deactivate);
    input.addEventListener("blur", deactivate);
    input.addEventListener("keyup", deactivate);
  }

  return {
    bindEvents,
    renderFromSettings,
  };
}

const rangeControls = [
  createRangeControl({
    shellId: "settingsPhotoQualitySlider",
    inputId: "settingsPhotoQualityRange",
    inlineValueId: "settingsPhotoQualityValue",
    displaySelector: "[data-settings-quality-display]",
    getValueFromSettings: (settings) => Math.round((settings.photoExportQuality || 0) * 100),
    buildSettingsPatch: (percentValue) => ({
      photoExportQuality: percentValue / 100,
    }),
    getAriaLabel: (value) => `Qualité d'image : ${value}%`,
    formatInlineValue: (value) => `${value}%`,
    formatDisplayValue: (value) => `${value}%`,
  }),
  createRangeControl({
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
    shellId: "settingsScoringContrastSlider",
    inputId: "settingsScoringContrastRange",
    inlineValueId: "settingsScoringContrastValue",
    displaySelector: "[data-settings-scoring-contrast-display]",
    getValueFromSettings: (settings) => settings.paletteScoring.lumaSpreadWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: {
        lumaSpreadWeight: clampInteger(value, defaultAppSettings.paletteScoring.lumaSpreadWeight),
      },
    }),
    getAriaLabel: (value) => `Contraste clair/foncé : ${value}`,
  }),
  createRangeControl({
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
    shellId: "settingsScoringDiversitySlider",
    inputId: "settingsScoringDiversityRange",
    inlineValueId: "settingsScoringDiversityValue",
    displaySelector: "[data-settings-scoring-diversity-display]",
    getValueFromSettings: (settings) => settings.paletteScoring.diversityWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: {
        diversityWeight: clampInteger(value, defaultAppSettings.paletteScoring.diversityWeight),
      },
    }),
    getAriaLabel: (value) => `Écart entre les couleurs : ${value}`,
  }),
  createRangeControl({
    shellId: "settingsMedianCutPoolSlider",
    inputId: "settingsMedianCutPoolRange",
    inlineValueId: "settingsMedianCutPoolValue",
    displaySelector: "[data-settings-median-cut-pool-display]",
    getValueFromSettings: (settings) => settings.medianCut.quantizedPoolSize,
    buildSettingsPatch: (value) => ({
      medianCut: {
        quantizedPoolSize: clampInteger(value, defaultAppSettings.medianCut.quantizedPoolSize),
      },
    }),
    getAriaLabel: (value) => `Nombre de couleurs analysées : ${value}`,
  }),
  createRangeControl({
    shellId: "settingsMedianCutPixelsSlider",
    inputId: "settingsMedianCutPixelsRange",
    inlineValueId: "settingsMedianCutPixelsValue",
    displaySelector: "[data-settings-median-cut-pixels-display]",
    getValueFromSettings: (settings) => settings.medianCut.maxQuantizerPixels,
    buildSettingsPatch: (value) => ({
      medianCut: {
        maxQuantizerPixels: clampInteger(value, defaultAppSettings.medianCut.maxQuantizerPixels),
      },
    }),
    getAriaLabel: (value) => `Pixels analysés max : ${value}`,
    formatInlineValue: (value) => formatThousands(value),
    formatDisplayValue: (value) => formatCompactThousands(value),
  }),
  createRangeControl({
    shellId: "settingsGridColsSlider",
    inputId: "settingsGridColsRange",
    inlineValueId: "settingsGridColsValue",
    displaySelector: "[data-settings-grid-cols-display]",
    getValueFromSettings: (settings) => settings.grid.sampleColCount,
    buildSettingsPatch: (value) => ({
      grid: { sampleColCount: clampInteger(value, 8) },
    }),
    getAriaLabel: (value) => `Colonnes de la grille : ${value}`,
  }),
  createRangeControl({
    shellId: "settingsGridRowsSlider",
    inputId: "settingsGridRowsRange",
    inlineValueId: "settingsGridRowsValue",
    displaySelector: "[data-settings-grid-rows-display]",
    getValueFromSettings: (settings) => settings.grid.sampleRowCount,
    buildSettingsPatch: (value) => ({
      grid: { sampleRowCount: clampInteger(value, 5) },
    }),
    getAriaLabel: (value) => `Lignes de la grille : ${value}`,
  }),
  createRangeControl({
    shellId: "settingsGridRadiusSlider",
    inputId: "settingsGridRadiusRange",
    inlineValueId: "settingsGridRadiusValue",
    displaySelector: "[data-settings-grid-radius-display]",
    getValueFromSettings: (settings) => settings.grid.sampleRadius,
    buildSettingsPatch: (value) => ({
      grid: { sampleRadius: clampInteger(value, 4) },
    }),
    getAriaLabel: (value) => `Taille du point de mesure : ${value} pixels`,
    formatInlineValue: (value) => `${value} px`,
  }),
].filter(Boolean);

function syncAlgorithmButtons(activeAlgorithm) {
  algorithmButtons.forEach((button) => {
    const buttonAlgorithm = button.getAttribute("data-settings-algorithm");
    button.setAttribute("aria-pressed", String(buttonAlgorithm === activeAlgorithm));
  });
}

function syncAnalysisProfileButtons(activeProfile) {
  analysisProfileButtons.forEach((button) => {
    const buttonProfile = button.getAttribute("data-settings-analysis-profile");
    button.setAttribute("aria-pressed", String(buttonProfile === activeProfile));
  });
}

function syncAnalysisProfileStatus(activeProfile) {
  if (!analysisProfileStatus) {
    return;
  }

  if (activeProfile === PALETTE_ANALYSIS_PROFILES.PERCEPTUAL) {
    analysisProfileStatus.textContent =
      "Perceptif actif. Regroupe les couleurs visuellement tout en séparant mieux les teintes proches.";
    return;
  }

  if (activeProfile === PALETTE_ANALYSIS_PROFILES.CUSTOM) {
    analysisProfileStatus.textContent =
      "Réglage personnalisé. Les curseurs ci-dessous remplacent les profils prédéfinis.";
    return;
  }

  analysisProfileStatus.textContent =
    "Expressif actif. Favorise les aplats francs, les accents et les couleurs rares.";
}

function syncAlgorithmPanels(activeAlgorithm) {
  algorithmPanels.forEach((panel) => {
    const panelAlgorithm = panel.getAttribute("data-settings-algorithm-panel");
    const isAdvancedPanel = panel.hasAttribute("data-settings-advanced-panel");
    panel.hidden = panelAlgorithm !== activeAlgorithm || (isAdvancedPanel && !isAdvancedSettingsUnlocked);
  });
}

function syncColorSpaceButtons(activeColorSpace) {
  colorSpaceButtons.forEach((button) => {
    const buttonColorSpace = button.getAttribute("data-settings-color-space");
    button.setAttribute("aria-pressed", String(buttonColorSpace === activeColorSpace));
  });
}

function syncCaptureModeButtons(activeMode) {
  captureModeButtons.forEach((button) => {
    const buttonMode = button.getAttribute("data-settings-capture-mode");
    button.setAttribute("aria-pressed", String(buttonMode === activeMode));
  });
}

function syncPerformanceHudButtons(isEnabled) {
  performanceHudButtons.forEach((button) => {
    const nextValue = button.getAttribute("data-settings-performance-hud");
    const shouldBeActive = (nextValue === "on") === Boolean(isEnabled);
    button.setAttribute("aria-pressed", String(shouldBeActive));
  });
}

function syncPaletteModeGroupVisibility(captureMode) {
  if (paletteModeGroup) {
    paletteModeGroup.hidden = captureMode === "ral";
  }
}

function syncAdvancedSettingsVisibility() {
  advancedSettingsElements.forEach((element) => {
    element.hidden = !isAdvancedSettingsUnlocked;
  });
}

function renderSettingsUi(settings) {
  rangeControls.forEach((control) => {
    control.renderFromSettings(settings);
  });

  const activeAlgorithm = settings?.paletteExtractionAlgorithm;
  syncAnalysisProfileButtons(settings?.paletteAnalysisProfile);
  syncAnalysisProfileStatus(settings?.paletteAnalysisProfile);
  syncAlgorithmButtons(activeAlgorithm);
  syncAlgorithmPanels(activeAlgorithm);
  syncColorSpaceButtons(settings?.medianCut?.colorSpace ?? defaultAppSettings.medianCut.colorSpace);
  syncCaptureModeButtons(settings.captureMode);
  syncPerformanceHudButtons(settings.performanceHudEnabled);
  syncPaletteModeGroupVisibility(settings.captureMode);
  syncAdvancedSettingsVisibility();
}

function openSettingsPanel() {
  openSharedPanel("settings");
}

function bindSettingsPanelEvents() {
  openSettingsButton?.addEventListener("click", openSettingsPanel);
}

function bindAdvancedSettingsUnlock() {
  if (!settingsVersionTrigger || isAdvancedSettingsUnlocked) {
    return;
  }

  settingsVersionTrigger.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastSettingsVersionTapAt > SETTINGS_VERSION_TAP_RESET_MS) {
      settingsVersionTapCount = 0;
    }

    lastSettingsVersionTapAt = now;
    settingsVersionTapCount += 1;

    if (settingsVersionTapCount < SETTINGS_VERSION_TAP_TARGET) {
      return;
    }

    settingsVersionTapCount = 0;
    isAdvancedSettingsUnlocked = true;
    renderSettingsUi(getAppSettings());
    showToast("Réglages avancés affichés.", { duration: 1600 });
  });
}

function bindAlgorithmControls() {
  if (algorithmButtons.length === 0) {
    return;
  }

  algorithmButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextAlgorithm = button.getAttribute("data-settings-algorithm");
      if (
        nextAlgorithm !== PALETTE_EXTRACTION_ALGORITHMS.GRID &&
        nextAlgorithm !== PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT
      ) {
        return;
      }

      updateAppSettings({
        paletteExtractionAlgorithm: nextAlgorithm,
      });
    });
  });
}

function bindAnalysisProfileControls() {
  if (analysisProfileButtons.length === 0) {
    return;
  }

  analysisProfileButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextProfile = button.getAttribute("data-settings-analysis-profile");
      if (
        nextProfile !== PALETTE_ANALYSIS_PROFILES.EXPRESSIVE &&
        nextProfile !== PALETTE_ANALYSIS_PROFILES.PERCEPTUAL
      ) {
        return;
      }

      updateAppSettings({
        paletteAnalysisProfile: nextProfile,
      });
    });
  });
}

function bindCaptureModeControls() {
  captureModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.getAttribute("data-settings-capture-mode");
      if (nextMode === "palette" || nextMode === "ral") {
        updateAppSettings({ captureMode: nextMode });
      }
    });
  });
}

function bindColorSpaceControls() {
  if (colorSpaceButtons.length === 0) {
    return;
  }

  colorSpaceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextColorSpace = button.getAttribute("data-settings-color-space");
      if (nextColorSpace !== "rgb" && nextColorSpace !== "oklch") {
        return;
      }

      updateAppSettings({
        medianCut: { colorSpace: nextColorSpace },
      });
    });
  });
}

function bindPerformanceHudControls() {
  if (performanceHudButtons.length === 0) {
    return;
  }

  performanceHudButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextValue = button.getAttribute("data-settings-performance-hud");
      if (nextValue !== "on" && nextValue !== "off") {
        return;
      }

      updateAppSettings({
        performanceHudEnabled: nextValue === "on",
      });
    });
  });
}

function bindRangeControls() {
  rangeControls.forEach((control) => {
    control.bindEvents();
  });
}

function bindResetButton() {
  const resetButton = document.getElementById("settingsResetButton");
  if (!resetButton) {
    return;
  }

  resetButton.addEventListener("click", () => {
    updateAppSettings(getDefaultAppSettingsResetPatch());
    showToast("Réglages réinitialisés.", { duration: 1400 });
  });
}

function bindExportButton() {
  const exportButton = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("settingsExportButton")
  );
  if (!exportButton) {
    return;
  }

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    try {
      const json = await exportAllPalettes();
      const blob = new Blob([json], { type: "application/json" });
      const filename = `paletcam-export-${new Date().toISOString().slice(0, 10)}.json`;

      // iOS Safari ignores the `download` attribute on <a> — use Web Share API with File instead
      if (typeof navigator.canShare === "function") {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          showToast("Export terminé.", { duration: 1400 });
          return;
        }
      }

      // Fallback: standard anchor download (desktop)
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
      exportButton.disabled = false;
    }
  });
}

function bindImportInput() {
  const importInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("settingsImportInput")
  );
  if (!importInput) {
    return;
  }

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) {
      return;
    }

    importInput.disabled = true;
    try {
      const text = await file.text();
      const count = await importAllPalettes(text);
      showToast(`${count} palette${count > 1 ? "s" : ""} importée${count > 1 ? "s" : ""}.`, {
        duration: 2000,
      });
    } catch (error) {
      console.error("Import failed:", error);
      showToast("Erreur lors de l'import. Vérifiez le fichier.", { duration: 2500 });
    } finally {
      importInput.value = "";
      importInput.disabled = false;
    }
  });
}

bindSettingsPanelEvents();
bindAdvancedSettingsUnlock();
bindCaptureModeControls();
bindAnalysisProfileControls();
bindAlgorithmControls();
bindColorSpaceControls();
bindPerformanceHudControls();
bindRangeControls();
bindResetButton();
bindExportButton();
bindImportInput();
renderSettingsUi(getAppSettings());
subscribeAppSettings(renderSettingsUi);
