import {
  getAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from './app-settings.js';
import { PALETTE_EXTRACTION_ALGORITHMS } from './modules/palette-extraction.js';

const settingsPanel = document.querySelector('.settings-panel');
const openSettingsButton = document.querySelector('.btn-open-settings');
const closeSettingsButton = document.querySelector('.btn-close-settings');
const SETTINGS_PANEL_HIDE_DELAY_MS = 380;
const integerFormatter = new Intl.NumberFormat('en-US');
let settingsPanelHideTimeoutId = 0;
let settingsPanelOpenFrameId = 0;
let hasBoundSettingsPanelEvents = false;
const algorithmButtons = Array.from(
  document.querySelectorAll('[data-settings-algorithm]')
);
const algorithmPanels = Array.from(
  document.querySelectorAll('[data-settings-algorithm-panel]')
);

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
  const tickCount = Math.max(
    1,
    Math.floor(((maxValue - minValue) / stepValue) + Number.EPSILON) + 1
  );
  const tickIndex = Math.max(
    0,
    Math.floor(((currentValue - minValue) / stepValue) + Number.EPSILON)
  );

  shell.style.setProperty('--tick-count', String(tickCount));
  shell.style.setProperty('--tick-index', String(tickIndex));
  shell.style.setProperty('--tick-intervals', String(Math.max(1, tickCount - 1)));
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
  const input = document.getElementById(inputId);
  const inlineValue = document.getElementById(inlineValueId);
  const displayValue = document.querySelector(displaySelector);

  if (!input || !inlineValue || !displayValue) {
    return null;
  }

  function renderFromSettings(settings) {
    const value = getValueFromSettings(settings);
    input.value = String(value);
    input.setAttribute('aria-label', getAriaLabel(value));
    inlineValue.textContent = formatInlineValue(value);
    displayValue.textContent = formatDisplayValue(value);
    updateSliderShellTicks(shell, input);
  }

  function bindEvents() {
    input.addEventListener('input', () => {
      const numericValue = Number(input.value);
      updateAppSettings(buildSettingsPatch(numericValue));
    });

    if (!shell) {
      return;
    }

    const activate = () => {
      shell.classList.add('is-active');
    };
    const deactivate = () => {
      shell.classList.remove('is-active');
    };

    input.addEventListener('pointerdown', activate);
    input.addEventListener('pointerup', deactivate);
    input.addEventListener('pointercancel', deactivate);
    input.addEventListener('blur', deactivate);
    input.addEventListener('keyup', deactivate);
  }

  return {
    bindEvents,
    renderFromSettings,
  };
}

const rangeControls = [
  createRangeControl({
    shellId: 'settingsPhotoQualitySlider',
    inputId: 'settingsPhotoQualityRange',
    inlineValueId: 'settingsPhotoQualityValue',
    displaySelector: '[data-settings-quality-display]',
    getValueFromSettings: (settings) => Math.round((settings.photoExportQuality || 0) * 100),
    buildSettingsPatch: (percentValue) => ({
      photoExportQuality: percentValue / 100,
    }),
    getAriaLabel: (value) => `Qualité d'image : ${value}%`,
    formatInlineValue: (value) => `${value}%`,
    formatDisplayValue: (value) => `${value}%`,
  }),
  createRangeControl({
    shellId: 'settingsScoringVibrancySlider',
    inputId: 'settingsScoringVibrancyRange',
    inlineValueId: 'settingsScoringVibrancyValue',
    displaySelector: '[data-settings-scoring-vibrancy-display]',
    getValueFromSettings: (settings) => settings.paletteScoring.chromaWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: { chromaWeight: clampInteger(value, 25) },
    }),
    getAriaLabel: (value) => `Préférence pour les couleurs vives : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsScoringContrastSlider',
    inputId: 'settingsScoringContrastRange',
    inlineValueId: 'settingsScoringContrastValue',
    displaySelector: '[data-settings-scoring-contrast-display]',
    getValueFromSettings: (settings) => settings.paletteScoring.lumaSpreadWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: { lumaSpreadWeight: clampInteger(value, 15) },
    }),
    getAriaLabel: (value) => `Contraste clair/foncé : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsScoringRaritySlider',
    inputId: 'settingsScoringRarityRange',
    inlineValueId: 'settingsScoringRarityValue',
    displaySelector: '[data-settings-scoring-rarity-display]',
    getValueFromSettings: (settings) => settings.paletteScoring.rarityWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: { rarityWeight: clampInteger(value, 20) },
    }),
    getAriaLabel: (value) => `Bonus aux teintes rares : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsScoringDiversitySlider',
    inputId: 'settingsScoringDiversityRange',
    inlineValueId: 'settingsScoringDiversityValue',
    displaySelector: '[data-settings-scoring-diversity-display]',
    getValueFromSettings: (settings) => settings.paletteScoring.diversityWeight,
    buildSettingsPatch: (value) => ({
      paletteScoring: { diversityWeight: clampInteger(value, 40) },
    }),
    getAriaLabel: (value) => `Écart entre les couleurs : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsMedianCutPoolSlider',
    inputId: 'settingsMedianCutPoolRange',
    inlineValueId: 'settingsMedianCutPoolValue',
    displaySelector: '[data-settings-median-cut-pool-display]',
    getValueFromSettings: (settings) => settings.medianCut.quantizedPoolSize,
    buildSettingsPatch: (value) => ({
      medianCut: { quantizedPoolSize: clampInteger(value, 16) },
    }),
    getAriaLabel: (value) => `Nombre de couleurs analysées : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsMedianCutPixelsSlider',
    inputId: 'settingsMedianCutPixelsRange',
    inlineValueId: 'settingsMedianCutPixelsValue',
    displaySelector: '[data-settings-median-cut-pixels-display]',
    getValueFromSettings: (settings) => settings.medianCut.maxQuantizerPixels,
    buildSettingsPatch: (value) => ({
      medianCut: { maxQuantizerPixels: clampInteger(value, 12000) },
    }),
    getAriaLabel: (value) => `Pixels analysés max : ${value}`,
    formatInlineValue: (value) => formatThousands(value),
    formatDisplayValue: (value) => formatCompactThousands(value),
  }),
  createRangeControl({
    shellId: 'settingsGridColsSlider',
    inputId: 'settingsGridColsRange',
    inlineValueId: 'settingsGridColsValue',
    displaySelector: '[data-settings-grid-cols-display]',
    getValueFromSettings: (settings) => settings.grid.sampleColCount,
    buildSettingsPatch: (value) => ({
      grid: { sampleColCount: clampInteger(value, 8) },
    }),
    getAriaLabel: (value) => `Colonnes de la grille : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsGridRowsSlider',
    inputId: 'settingsGridRowsRange',
    inlineValueId: 'settingsGridRowsValue',
    displaySelector: '[data-settings-grid-rows-display]',
    getValueFromSettings: (settings) => settings.grid.sampleRowCount,
    buildSettingsPatch: (value) => ({
      grid: { sampleRowCount: clampInteger(value, 5) },
    }),
    getAriaLabel: (value) => `Lignes de la grille : ${value}`,
  }),
  createRangeControl({
    shellId: 'settingsGridRadiusSlider',
    inputId: 'settingsGridRadiusRange',
    inlineValueId: 'settingsGridRadiusValue',
    displaySelector: '[data-settings-grid-radius-display]',
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
    const buttonAlgorithm = button.getAttribute('data-settings-algorithm');
    button.setAttribute('aria-pressed', String(buttonAlgorithm === activeAlgorithm));
  });
}

function syncAlgorithmPanels(activeAlgorithm) {
  algorithmPanels.forEach((panel) => {
    const panelAlgorithm = panel.getAttribute('data-settings-algorithm-panel');
    panel.hidden = panelAlgorithm !== activeAlgorithm;
  });
}

function renderSettingsUi(settings) {
  rangeControls.forEach((control) => {
    control.renderFromSettings(settings);
  });

  const activeAlgorithm = settings?.paletteExtractionAlgorithm;
  syncAlgorithmButtons(activeAlgorithm);
  syncAlgorithmPanels(activeAlgorithm);
}

function clearSettingsPanelHideTimeout() {
  if (!settingsPanelHideTimeoutId) {
    return;
  }

  window.clearTimeout(settingsPanelHideTimeoutId);
  settingsPanelHideTimeoutId = 0;
}

function cancelPendingSettingsPanelOpen() {
  if (!settingsPanelOpenFrameId) {
    return;
  }

  window.cancelAnimationFrame(settingsPanelOpenFrameId);
  settingsPanelOpenFrameId = 0;
}

function finalizeSettingsPanelHidden() {
  if (!settingsPanel || settingsPanel.classList.contains('visible')) {
    return;
  }

  settingsPanel.hidden = true;
}

function scheduleSettingsPanelHide() {
  clearSettingsPanelHideTimeout();
  settingsPanelHideTimeoutId = window.setTimeout(() => {
    settingsPanelHideTimeoutId = 0;
    finalizeSettingsPanelHidden();
  }, SETTINGS_PANEL_HIDE_DELAY_MS);
}

function openSettingsPanel() {
  if (!settingsPanel) {
    return;
  }

  clearSettingsPanelHideTimeout();
  cancelPendingSettingsPanelOpen();
  document.querySelector('.collection-panel')?.classList.remove('visible');
  settingsPanel.hidden = false;
  settingsPanel.setAttribute('aria-hidden', 'false');
  // Force layout before toggling the visible class so the slide transition
  // starts reliably on mobile/PWA shells without depending on rAF timing.
  void settingsPanel.offsetWidth;
  settingsPanel.classList.add('visible');
}

function closeSettingsPanel() {
  if (!settingsPanel) {
    return;
  }

  cancelPendingSettingsPanelOpen();
  settingsPanel.classList.remove('visible');
  settingsPanel.setAttribute('aria-hidden', 'true');
  scheduleSettingsPanelHide();
}

function bindSettingsPanelEvents() {
  if (!settingsPanel || hasBoundSettingsPanelEvents) {
    return;
  }
  hasBoundSettingsPanelEvents = true;

  settingsPanel.hidden = true;
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsPanel.classList.remove('visible');

  openSettingsButton?.addEventListener('click', openSettingsPanel);
  closeSettingsButton?.addEventListener('click', closeSettingsPanel);

  // Delegated fallback keeps the panel working if buttons are re-rendered
  // or if one of the direct selectors is temporarily unavailable at init.
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest('.btn-open-settings')) {
      openSettingsPanel();
      return;
    }

    if (event.target.closest('.btn-close-settings')) {
      closeSettingsPanel();
    }
  });

  settingsPanel.addEventListener('transitionend', (event) => {
    if (event.target !== settingsPanel || event.propertyName !== 'right') {
      return;
    }

    finalizeSettingsPanelHidden();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !settingsPanel.classList.contains('visible')) {
      return;
    }

    closeSettingsPanel();
  });
}

function bindAlgorithmControls() {
  if (algorithmButtons.length === 0) {
    return;
  }

  algorithmButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextAlgorithm = button.getAttribute('data-settings-algorithm');
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

function bindRangeControls() {
  rangeControls.forEach((control) => {
    control.bindEvents();
  });
}

bindSettingsPanelEvents();
bindAlgorithmControls();
bindRangeControls();
renderSettingsUi(getAppSettings());
subscribeAppSettings(renderSettingsUi);
