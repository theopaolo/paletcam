import { PALETTE_EXTRACTION_ALGORITHMS } from './modules/palette-extraction.js';
import {
  SAMPLE_COL_COUNT,
  SAMPLE_RADIUS,
  SAMPLE_ROW_COUNT,
} from './modules/palette-extract-grid.js';
import {
  DEFAULT_MAX_QUANTIZER_PIXELS,
  DEFAULT_QUANTIZED_POOL_SIZE,
} from './modules/palette-extract-median-cut.js';
import { DEFAULT_PALETTE_SCORING_SETTINGS } from './modules/palette-scoring.js';

const SETTINGS_STORAGE_KEY = 'paletcam:settings:v1';
const GLOBAL_SETTINGS_STORE_KEY = '__paletcamAppSettingsStore__';
const GRID_ROW_COUNT_RANGE = { min: 2, max: 12 };
const GRID_COL_COUNT_RANGE = { min: 2, max: 20 };
const GRID_SAMPLE_RADIUS_RANGE = { min: 1, max: 12 };
const MEDIAN_CUT_POOL_SIZE_RANGE = { min: 4, max: 64 };
const MEDIAN_CUT_MAX_PIXELS_RANGE = { min: 1000, max: 60000 };
const SCORING_WEIGHT_RANGE = { min: 0, max: 100 };
const VALID_CAPTURE_MODES = new Set(['palette', 'ral']);

function normalizeQuantizationColorSpace(value) {
  return value === 'oklch' ? 'oklch' : 'rgb';
}

function normalizeCaptureMode(value) {
  return VALID_CAPTURE_MODES.has(value) ? value : 'palette';
}

const DEFAULT_SETTINGS = Object.freeze({
  captureMode: 'palette',
  photoExportQuality: 0.95,
  paletteExtractionAlgorithm: PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT,
  grid: Object.freeze({
    sampleRowCount: SAMPLE_ROW_COUNT,
    sampleColCount: SAMPLE_COL_COUNT,
    sampleRadius: SAMPLE_RADIUS,
  }),
  medianCut: Object.freeze({
    quantizedPoolSize: DEFAULT_QUANTIZED_POOL_SIZE,
    maxQuantizerPixels: DEFAULT_MAX_QUANTIZER_PIXELS,
    colorSpace: 'rgb',
  }),
  paletteScoring: Object.freeze({
    chromaWeight: DEFAULT_PALETTE_SCORING_SETTINGS.chromaWeight,
    lumaSpreadWeight: DEFAULT_PALETTE_SCORING_SETTINGS.lumaSpreadWeight,
    rarityWeight: DEFAULT_PALETTE_SCORING_SETTINGS.rarityWeight,
    diversityWeight: DEFAULT_PALETTE_SCORING_SETTINGS.diversityWeight,
  }),
});

function getGlobalSettingsStore() {
  const host = /** @type {any} */ (globalThis);

  if (!host[GLOBAL_SETTINGS_STORE_KEY]) {
    host[GLOBAL_SETTINGS_STORE_KEY] = {
      currentSettings: null,
      listeners: new Set(),
    };
  }

  return host[GLOBAL_SETTINGS_STORE_KEY];
}

const settingsStore = getGlobalSettingsStore();
if (!settingsStore.currentSettings) {
  settingsStore.currentSettings = loadSettings();
}

/**
 * Test-only helper to reload settings from storage and clear listeners.
 * @returns {AppSettings}
 */
export function resetAppSettingsForTests() {
  settingsStore.listeners.clear();
  settingsStore.currentSettings = loadSettings();
  return getAppSettings();
}

function clampPhotoExportQuality(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SETTINGS.photoExportQuality;
  }

  return Math.max(0.6, Math.min(1.0, Number(numericValue.toFixed(2))));
}

function clampIntegerInRange(value, fallbackValue, { min, max }) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function normalizeAlgorithm(value) {
  return value === PALETTE_EXTRACTION_ALGORITHMS.GRID
    ? PALETTE_EXTRACTION_ALGORITHMS.GRID
    : PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT;
}

function normalizeGridSettings(candidate) {
  const fallback = DEFAULT_SETTINGS.grid;

  return {
    sampleRowCount: clampIntegerInRange(
      candidate?.sampleRowCount,
      fallback.sampleRowCount,
      GRID_ROW_COUNT_RANGE
    ),
    sampleColCount: clampIntegerInRange(
      candidate?.sampleColCount,
      fallback.sampleColCount,
      GRID_COL_COUNT_RANGE
    ),
    sampleRadius: clampIntegerInRange(
      candidate?.sampleRadius,
      fallback.sampleRadius,
      GRID_SAMPLE_RADIUS_RANGE
    ),
  };
}

function normalizeMedianCutSettings(candidate) {
  const fallback = DEFAULT_SETTINGS.medianCut;

  return {
    quantizedPoolSize: clampIntegerInRange(
      candidate?.quantizedPoolSize,
      fallback.quantizedPoolSize,
      MEDIAN_CUT_POOL_SIZE_RANGE
    ),
    maxQuantizerPixels: clampIntegerInRange(
      candidate?.maxQuantizerPixels,
      fallback.maxQuantizerPixels,
      MEDIAN_CUT_MAX_PIXELS_RANGE
    ),
    colorSpace: normalizeQuantizationColorSpace(candidate?.colorSpace),
  };
}

function normalizePaletteScoringSettings(candidate) {
  const fallback = DEFAULT_SETTINGS.paletteScoring;

  return {
    chromaWeight: clampIntegerInRange(
      candidate?.chromaWeight,
      fallback.chromaWeight,
      SCORING_WEIGHT_RANGE
    ),
    lumaSpreadWeight: clampIntegerInRange(
      candidate?.lumaSpreadWeight,
      fallback.lumaSpreadWeight,
      SCORING_WEIGHT_RANGE
    ),
    rarityWeight: clampIntegerInRange(
      candidate?.rarityWeight,
      fallback.rarityWeight,
      SCORING_WEIGHT_RANGE
    ),
    diversityWeight: clampIntegerInRange(
      candidate?.diversityWeight,
      fallback.diversityWeight,
      SCORING_WEIGHT_RANGE
    ),
  };
}

function normalizeSettings(candidate) {
  return {
    captureMode: normalizeCaptureMode(candidate?.captureMode),
    photoExportQuality: clampPhotoExportQuality(candidate?.photoExportQuality),
    paletteExtractionAlgorithm: normalizeAlgorithm(candidate?.paletteExtractionAlgorithm),
    grid: normalizeGridSettings(candidate?.grid),
    medianCut: normalizeMedianCutSettings(candidate?.medianCut),
    paletteScoring: normalizePaletteScoringSettings(candidate?.paletteScoring),
  };
}

function areSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.captureMode === secondSettings.captureMode &&
    firstSettings.photoExportQuality === secondSettings.photoExportQuality &&
    firstSettings.paletteExtractionAlgorithm === secondSettings.paletteExtractionAlgorithm &&
    firstSettings.grid.sampleRowCount === secondSettings.grid.sampleRowCount &&
    firstSettings.grid.sampleColCount === secondSettings.grid.sampleColCount &&
    firstSettings.grid.sampleRadius === secondSettings.grid.sampleRadius &&
    firstSettings.medianCut.quantizedPoolSize === secondSettings.medianCut.quantizedPoolSize &&
    firstSettings.medianCut.maxQuantizerPixels === secondSettings.medianCut.maxQuantizerPixels &&
    firstSettings.medianCut.colorSpace === secondSettings.medianCut.colorSpace &&
    firstSettings.paletteScoring.chromaWeight === secondSettings.paletteScoring.chromaWeight &&
    firstSettings.paletteScoring.lumaSpreadWeight === secondSettings.paletteScoring.lumaSpreadWeight &&
    firstSettings.paletteScoring.rarityWeight === secondSettings.paletteScoring.rarityWeight &&
    firstSettings.paletteScoring.diversityWeight === secondSettings.paletteScoring.diversityWeight
  );
}

function readStoredSettings() {
  try {
    const rawValue = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue);
  } catch (error) {
    console.warn('Unable to read app settings:', error);
    return null;
  }
}

function persistSettings(nextSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.warn('Unable to persist app settings:', error);
  }
}

function loadSettings() {
  const storedSettings = readStoredSettings();

  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    grid: {
      ...DEFAULT_SETTINGS.grid,
      ...(storedSettings?.grid ?? {}),
    },
    medianCut: {
      ...DEFAULT_SETTINGS.medianCut,
      ...(storedSettings?.medianCut ?? {}),
    },
    paletteScoring: {
      ...DEFAULT_SETTINGS.paletteScoring,
      ...(storedSettings?.paletteScoring ?? {}),
    },
  });
}

function notifySettingsListeners() {
  const snapshot = getAppSettings();
  settingsStore.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('App settings listener failed:', error);
    }
  });
}

/** @returns {AppSettings} */
export function getDefaultAppSettings() {
  return {
    ...DEFAULT_SETTINGS,
    grid: { ...DEFAULT_SETTINGS.grid },
    medianCut: { ...DEFAULT_SETTINGS.medianCut },
    paletteScoring: { ...DEFAULT_SETTINGS.paletteScoring },
  };
}

/** @returns {AppSettingsPatch} */
export function getDefaultAppSettingsResetPatch() {
  const defaults = getDefaultAppSettings();

  return {
    captureMode: defaults.captureMode,
    grid: defaults.grid,
    medianCut: defaults.medianCut,
    paletteExtractionAlgorithm: defaults.paletteExtractionAlgorithm,
    paletteScoring: defaults.paletteScoring,
  };
}

/** @returns {AppSettings} */
export function getAppSettings() {
  return {
    ...settingsStore.currentSettings,
    grid: { ...settingsStore.currentSettings.grid },
    medianCut: { ...settingsStore.currentSettings.medianCut },
    paletteScoring: { ...settingsStore.currentSettings.paletteScoring },
  };
}

/**
 * @param {AppSettingsPatch} partialSettings
 * @returns {AppSettings}
 */
export function updateAppSettings(partialSettings) {
  const nextSettings = normalizeSettings({
    ...settingsStore.currentSettings,
    ...partialSettings,
    grid: {
      ...settingsStore.currentSettings.grid,
      ...(partialSettings?.grid ?? {}),
    },
    medianCut: {
      ...settingsStore.currentSettings.medianCut,
      ...(partialSettings?.medianCut ?? {}),
    },
    paletteScoring: {
      ...settingsStore.currentSettings.paletteScoring,
      ...(partialSettings?.paletteScoring ?? {}),
    },
  });

  if (areSettingsEqual(nextSettings, settingsStore.currentSettings)) {
    return getAppSettings();
  }

  settingsStore.currentSettings = nextSettings;
  persistSettings(settingsStore.currentSettings);
  notifySettingsListeners();

  return getAppSettings();
}

/**
 * @param {(settings: AppSettings) => void} listener
 * @returns {() => void}
 */
export function subscribeAppSettings(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  settingsStore.listeners.add(listener);
  return () => {
    settingsStore.listeners.delete(listener);
  };
}

export const APP_SETTINGS_LIMITS = Object.freeze({
  grid: Object.freeze({
    sampleRowCount: Object.freeze({ ...GRID_ROW_COUNT_RANGE }),
    sampleColCount: Object.freeze({ ...GRID_COL_COUNT_RANGE }),
    sampleRadius: Object.freeze({ ...GRID_SAMPLE_RADIUS_RANGE }),
  }),
  medianCut: Object.freeze({
    quantizedPoolSize: Object.freeze({ ...MEDIAN_CUT_POOL_SIZE_RANGE }),
    maxQuantizerPixels: Object.freeze({ ...MEDIAN_CUT_MAX_PIXELS_RANGE }),
  }),
  paletteScoring: Object.freeze({
    chromaWeight: Object.freeze({ ...SCORING_WEIGHT_RANGE }),
    lumaSpreadWeight: Object.freeze({ ...SCORING_WEIGHT_RANGE }),
    rarityWeight: Object.freeze({ ...SCORING_WEIGHT_RANGE }),
    diversityWeight: Object.freeze({ ...SCORING_WEIGHT_RANGE }),
  }),
});
