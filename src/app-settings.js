import {
  SAMPLE_COL_COUNT,
  SAMPLE_RADIUS,
  SAMPLE_ROW_COUNT,
} from "./modules/palette-extract-grid.js";
import {
  DEFAULT_MAX_QUANTIZER_PIXELS,
  DEFAULT_QUANTIZED_POOL_SIZE,
} from "./modules/palette-extract-median-cut.js";
import { PALETTE_EXTRACTION_ALGORITHMS } from "./modules/palette-extraction.js";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";
const GRID_ROW_COUNT_RANGE = { min: 2, max: 12 };
const GRID_COL_COUNT_RANGE = { min: 2, max: 20 };
const GRID_SAMPLE_RADIUS_RANGE = { min: 1, max: 12 };
const MEDIAN_CUT_POOL_SIZE_RANGE = { min: 4, max: 64 };
const MEDIAN_CUT_MAX_PIXELS_RANGE = { min: 1000, max: 60000 };
const SCORING_WEIGHT_RANGE = { min: 0, max: 100 };
const VALID_CAPTURE_MODES = new Set(["palette", "ral"]);
const VALID_COLLECTION_VIEW_MODES = new Set(["list", "grid"]);
export const PALETTE_ANALYSIS_PROFILES = Object.freeze({
  EXPRESSIVE: "expressive",
  PERCEPTUAL: "perceptual",
  CUSTOM: "custom",
});

const EXPRESSIVE_PALETTE_SCORING_SETTINGS = Object.freeze({
  chromaWeight: 25,
  lumaSpreadWeight: 15,
  rarityWeight: 20,
  diversityWeight: 40,
});
const PERCEPTUAL_PALETTE_SCORING_SETTINGS = Object.freeze({
  chromaWeight: 24,
  lumaSpreadWeight: 14,
  rarityWeight: 14,
  diversityWeight: 48,
});
const EXPRESSIVE_MEDIAN_CUT_SETTINGS = Object.freeze({
  quantizedPoolSize: DEFAULT_QUANTIZED_POOL_SIZE,
  maxQuantizerPixels: DEFAULT_MAX_QUANTIZER_PIXELS,
  colorSpace: "rgb",
});
const PERCEPTUAL_MEDIAN_CUT_SETTINGS = Object.freeze({
  quantizedPoolSize: DEFAULT_QUANTIZED_POOL_SIZE,
  maxQuantizerPixels: DEFAULT_MAX_QUANTIZER_PIXELS,
  colorSpace: "oklch",
});
const PALETTE_ANALYSIS_PROFILE_PRESETS = Object.freeze({
  [PALETTE_ANALYSIS_PROFILES.EXPRESSIVE]: Object.freeze({
    paletteExtractionAlgorithm: PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT,
    medianCut: EXPRESSIVE_MEDIAN_CUT_SETTINGS,
    paletteScoring: EXPRESSIVE_PALETTE_SCORING_SETTINGS,
  }),
  [PALETTE_ANALYSIS_PROFILES.PERCEPTUAL]: Object.freeze({
    paletteExtractionAlgorithm: PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT,
    medianCut: PERCEPTUAL_MEDIAN_CUT_SETTINGS,
    paletteScoring: PERCEPTUAL_PALETTE_SCORING_SETTINGS,
  }),
});

function normalizeQuantizationColorSpace(value) {
  return value === "oklch" ? "oklch" : "rgb";
}

function normalizeCaptureMode(value) {
  return VALID_CAPTURE_MODES.has(value) ? value : "palette";
}

function normalizeCollectionViewMode(value) {
  return VALID_COLLECTION_VIEW_MODES.has(value) ? value : "list";
}

function normalizePaletteAnalysisProfile(value) {
  return value === PALETTE_ANALYSIS_PROFILES.EXPRESSIVE ||
      value === PALETTE_ANALYSIS_PROFILES.PERCEPTUAL ||
      value === PALETTE_ANALYSIS_PROFILES.CUSTOM
    ? value
    : null;
}

function cloneMedianCutSettings(settings) {
  return {
    quantizedPoolSize: settings.quantizedPoolSize,
    maxQuantizerPixels: settings.maxQuantizerPixels,
    colorSpace: settings.colorSpace,
  };
}

function clonePaletteScoringSettings(settings) {
  return {
    chromaWeight: settings.chromaWeight,
    lumaSpreadWeight: settings.lumaSpreadWeight,
    rarityWeight: settings.rarityWeight,
    diversityWeight: settings.diversityWeight,
  };
}

function getPaletteAnalysisProfilePreset(profile) {
  const preset = PALETTE_ANALYSIS_PROFILE_PRESETS[profile];
  if (!preset) {
    return null;
  }

  return {
    paletteExtractionAlgorithm: preset.paletteExtractionAlgorithm,
    medianCut: cloneMedianCutSettings(preset.medianCut),
    paletteScoring: clonePaletteScoringSettings(preset.paletteScoring),
  };
}

function doMedianCutSettingsMatch(firstSettings, secondSettings) {
  return (
    firstSettings.quantizedPoolSize === secondSettings.quantizedPoolSize &&
    firstSettings.maxQuantizerPixels === secondSettings.maxQuantizerPixels &&
    firstSettings.colorSpace === secondSettings.colorSpace
  );
}

function doPaletteScoringSettingsMatch(firstSettings, secondSettings) {
  return (
    firstSettings.chromaWeight === secondSettings.chromaWeight &&
    firstSettings.lumaSpreadWeight === secondSettings.lumaSpreadWeight &&
    firstSettings.rarityWeight === secondSettings.rarityWeight &&
    firstSettings.diversityWeight === secondSettings.diversityWeight
  );
}

function inferPaletteAnalysisProfile(settings) {
  const expressivePreset = getPaletteAnalysisProfilePreset(PALETTE_ANALYSIS_PROFILES.EXPRESSIVE);
  if (
    expressivePreset &&
    doMedianCutSettingsMatch(settings.medianCut, expressivePreset.medianCut) &&
    doPaletteScoringSettingsMatch(settings.paletteScoring, expressivePreset.paletteScoring)
  ) {
    return PALETTE_ANALYSIS_PROFILES.EXPRESSIVE;
  }

  const perceptualPreset = getPaletteAnalysisProfilePreset(PALETTE_ANALYSIS_PROFILES.PERCEPTUAL);
  if (
    perceptualPreset &&
    doMedianCutSettingsMatch(settings.medianCut, perceptualPreset.medianCut) &&
    doPaletteScoringSettingsMatch(settings.paletteScoring, perceptualPreset.paletteScoring)
  ) {
    return PALETTE_ANALYSIS_PROFILES.PERCEPTUAL;
  }

  return PALETTE_ANALYSIS_PROFILES.CUSTOM;
}

function applyPaletteAnalysisProfilePreset(settings, profile) {
  const preset = getPaletteAnalysisProfilePreset(profile);
  if (!preset) {
    return {
      ...settings,
      paletteAnalysisProfile: inferPaletteAnalysisProfile(settings),
    };
  }

  return {
    ...settings,
    paletteAnalysisProfile: profile,
    paletteExtractionAlgorithm: preset.paletteExtractionAlgorithm,
    medianCut: preset.medianCut,
    paletteScoring: preset.paletteScoring,
  };
}

const DEFAULT_SETTINGS = Object.freeze({
  captureMode: "palette",
  collectionViewMode: "list",
  performanceHudEnabled: false,
  oneMoreColor: false,
  photoExportQuality: 0.95,
  paletteAnalysisProfile: PALETTE_ANALYSIS_PROFILES.EXPRESSIVE,
  paletteExtractionAlgorithm: PALETTE_EXTRACTION_ALGORITHMS.MEDIAN_CUT,
  grid: Object.freeze({
    sampleRowCount: SAMPLE_ROW_COUNT,
    sampleColCount: SAMPLE_COL_COUNT,
    sampleRadius: SAMPLE_RADIUS,
  }),
  medianCut: EXPRESSIVE_MEDIAN_CUT_SETTINGS,
  paletteScoring: EXPRESSIVE_PALETTE_SCORING_SETTINGS,
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
      GRID_ROW_COUNT_RANGE,
    ),
    sampleColCount: clampIntegerInRange(
      candidate?.sampleColCount,
      fallback.sampleColCount,
      GRID_COL_COUNT_RANGE,
    ),
    sampleRadius: clampIntegerInRange(
      candidate?.sampleRadius,
      fallback.sampleRadius,
      GRID_SAMPLE_RADIUS_RANGE,
    ),
  };
}

function normalizeMedianCutSettings(candidate) {
  const fallback = DEFAULT_SETTINGS.medianCut;

  return {
    quantizedPoolSize: clampIntegerInRange(
      candidate?.quantizedPoolSize,
      fallback.quantizedPoolSize,
      MEDIAN_CUT_POOL_SIZE_RANGE,
    ),
    maxQuantizerPixels: clampIntegerInRange(
      candidate?.maxQuantizerPixels,
      fallback.maxQuantizerPixels,
      MEDIAN_CUT_MAX_PIXELS_RANGE,
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
      SCORING_WEIGHT_RANGE,
    ),
    lumaSpreadWeight: clampIntegerInRange(
      candidate?.lumaSpreadWeight,
      fallback.lumaSpreadWeight,
      SCORING_WEIGHT_RANGE,
    ),
    rarityWeight: clampIntegerInRange(
      candidate?.rarityWeight,
      fallback.rarityWeight,
      SCORING_WEIGHT_RANGE,
    ),
    diversityWeight: clampIntegerInRange(
      candidate?.diversityWeight,
      fallback.diversityWeight,
      SCORING_WEIGHT_RANGE,
    ),
  };
}

function buildNormalizedSettings(candidate) {
  return {
    captureMode: normalizeCaptureMode(candidate?.captureMode),
    collectionViewMode: normalizeCollectionViewMode(candidate?.collectionViewMode),
    performanceHudEnabled: Boolean(candidate?.performanceHudEnabled),
    oneMoreColor: Boolean(candidate?.oneMoreColor),
    photoExportQuality: clampPhotoExportQuality(candidate?.photoExportQuality),
    paletteExtractionAlgorithm: normalizeAlgorithm(candidate?.paletteExtractionAlgorithm),
    grid: normalizeGridSettings(candidate?.grid),
    medianCut: normalizeMedianCutSettings(candidate?.medianCut),
    paletteScoring: normalizePaletteScoringSettings(candidate?.paletteScoring),
  };
}

function normalizeSettings(candidate, explicitPaletteAnalysisProfile = undefined) {
  const normalizedSettings = buildNormalizedSettings(candidate);
  const requestedProfile = normalizePaletteAnalysisProfile(explicitPaletteAnalysisProfile);

  if (
    requestedProfile === PALETTE_ANALYSIS_PROFILES.EXPRESSIVE ||
    requestedProfile === PALETTE_ANALYSIS_PROFILES.PERCEPTUAL
  ) {
    return applyPaletteAnalysisProfilePreset(normalizedSettings, requestedProfile);
  }

  return {
    ...normalizedSettings,
    paletteAnalysisProfile: inferPaletteAnalysisProfile(normalizedSettings),
  };
}

function areSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.captureMode === secondSettings.captureMode &&
    firstSettings.collectionViewMode === secondSettings.collectionViewMode &&
    firstSettings.performanceHudEnabled === secondSettings.performanceHudEnabled &&
    firstSettings.oneMoreColor === secondSettings.oneMoreColor &&
    firstSettings.photoExportQuality === secondSettings.photoExportQuality &&
    firstSettings.paletteAnalysisProfile === secondSettings.paletteAnalysisProfile &&
    firstSettings.paletteExtractionAlgorithm === secondSettings.paletteExtractionAlgorithm &&
    firstSettings.grid.sampleRowCount === secondSettings.grid.sampleRowCount &&
    firstSettings.grid.sampleColCount === secondSettings.grid.sampleColCount &&
    firstSettings.grid.sampleRadius === secondSettings.grid.sampleRadius &&
    firstSettings.medianCut.quantizedPoolSize === secondSettings.medianCut.quantizedPoolSize &&
    firstSettings.medianCut.maxQuantizerPixels === secondSettings.medianCut.maxQuantizerPixels &&
    firstSettings.medianCut.colorSpace === secondSettings.medianCut.colorSpace &&
    firstSettings.paletteScoring.chromaWeight === secondSettings.paletteScoring.chromaWeight &&
    firstSettings.paletteScoring.lumaSpreadWeight ===
      secondSettings.paletteScoring.lumaSpreadWeight &&
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
    console.warn("Unable to read app settings:", error);
    return null;
  }
}

function persistSettings(nextSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.warn("Unable to persist app settings:", error);
  }
}

function loadSettings() {
  const storedSettings = readStoredSettings();
  const hasStoredPaletteAnalysisProfile = Object.prototype.hasOwnProperty.call(
    storedSettings ?? {},
    "paletteAnalysisProfile",
  );

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
  }, hasStoredPaletteAnalysisProfile ? storedSettings?.paletteAnalysisProfile : undefined);
}

function notifySettingsListeners() {
  const snapshot = getAppSettings();
  settingsStore.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("App settings listener failed:", error);
    }
  });
}

/** @returns {AppSettings} */
export function getDefaultAppSettings() {
  return {
    ...DEFAULT_SETTINGS,
    paletteAnalysisProfile: DEFAULT_SETTINGS.paletteAnalysisProfile,
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
    collectionViewMode: defaults.collectionViewMode,
    performanceHudEnabled: defaults.performanceHudEnabled,
    oneMoreColor: defaults.oneMoreColor,
    paletteAnalysisProfile: defaults.paletteAnalysisProfile,
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
    paletteAnalysisProfile: settingsStore.currentSettings.paletteAnalysisProfile,
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
  const hasExplicitPaletteAnalysisProfile = Object.prototype.hasOwnProperty.call(
    partialSettings ?? {},
    "paletteAnalysisProfile",
  );
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
  }, hasExplicitPaletteAnalysisProfile ? partialSettings?.paletteAnalysisProfile : undefined);

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
  if (typeof listener !== "function") {
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
