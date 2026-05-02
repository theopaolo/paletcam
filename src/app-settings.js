import {
  DEFAULT_MAX_QUANTIZER_PIXELS,
  DEFAULT_QUANTIZED_POOL_SIZE,
} from "./modules/palette-extract-median-cut.js";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";
const MEDIAN_CUT_POOL_SIZE_RANGE = { min: 4, max: 64 };
const MEDIAN_CUT_MAX_PIXELS_RANGE = { min: 1000, max: 60000 };
const SCORING_WEIGHT_RANGE = { min: 0, max: 100 };
const VALID_CAPTURE_MODES = new Set(["palette", "ral"]);
const VALID_COLLECTION_VIEW_MODES = new Set(["list", "grid", "swatch"]);
const VALID_LOCALES = new Set(["fr", "en"]);
const VALID_PHOTO_QUALITY_MODES = new Set(["sd", "hd", "fhd"]);
const DEFAULT_POLAROID_FOOTER_LABEL = "colorcatchers.co";

const DEFAULT_PALETTE_SCORING_SETTINGS = Object.freeze({
  chromaWeight: 25,
  lumaSpreadWeight: 15,
  rarityWeight: 20,
  diversityWeight: 40,
});

const DEFAULT_MEDIAN_CUT_SETTINGS = Object.freeze({
  quantizedPoolSize: DEFAULT_QUANTIZED_POOL_SIZE,
  maxQuantizerPixels: DEFAULT_MAX_QUANTIZER_PIXELS,
  colorSpace: "rgb",
});

function normalizeQuantizationColorSpace(_value) {
  return "rgb";
}

function normalizeCaptureMode(value) {
  return VALID_CAPTURE_MODES.has(value) ? value : "palette";
}

function normalizeCollectionViewMode(value) {
  return VALID_COLLECTION_VIEW_MODES.has(value) ? value : "list";
}

function normalizeLocale(value) {
  return VALID_LOCALES.has(value) ? value : "fr";
}

function normalizePhotoQualityMode(value) {
  return VALID_PHOTO_QUALITY_MODES.has(value) ? value : "hd";
}

function normalizePolaroidFooterLabel(value) {
  if (typeof value !== "string") {
    return DEFAULT_POLAROID_FOOTER_LABEL;
  }

  const normalizedValue = value.trim();
  return normalizedValue || DEFAULT_POLAROID_FOOTER_LABEL;
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

const DEFAULT_SETTINGS = Object.freeze({
  captureMode: "palette",
  collectionViewMode: "list",
  locale: "fr",
  performanceHudEnabled: false,
  oneMoreColor: false,
  photoQualityMode: "hd",
  polaroidFooterLabel: DEFAULT_POLAROID_FOOTER_LABEL,
  medianCut: DEFAULT_MEDIAN_CUT_SETTINGS,
  paletteScoring: DEFAULT_PALETTE_SCORING_SETTINGS,
});

function getGlobalSettingsStore() {
  const host = globalThis;

  if (!host[GLOBAL_SETTINGS_STORE_KEY]) {
    host[GLOBAL_SETTINGS_STORE_KEY] = {
      currentSettings: loadSettings(),
      listeners: new Set(),
    };
  }

  return host[GLOBAL_SETTINGS_STORE_KEY];
}

const settingsStore = getGlobalSettingsStore();

/**
 * Test-only helper to reload settings from storage and clear listeners.
 * @returns {AppSettings}
 */
export function resetAppSettingsForTests() {
  settingsStore.listeners.clear();
  settingsStore.currentSettings = loadSettings();
  return getAppSettings();
}

function clampIntegerInRange(value, fallbackValue, { min, max }) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.min(max, Math.max(min, Math.round(numericValue)));
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
    locale: normalizeLocale(candidate?.locale),
    performanceHudEnabled: Boolean(candidate?.performanceHudEnabled),
    oneMoreColor: Boolean(candidate?.oneMoreColor),
    photoQualityMode: normalizePhotoQualityMode(candidate?.photoQualityMode),
    polaroidFooterLabel: normalizePolaroidFooterLabel(candidate?.polaroidFooterLabel),
    medianCut: normalizeMedianCutSettings(candidate?.medianCut),
    paletteScoring: normalizePaletteScoringSettings(candidate?.paletteScoring),
  };
}

function normalizeSettings(candidate) {
  return buildNormalizedSettings(candidate);
}

function areSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.captureMode === secondSettings.captureMode &&
    firstSettings.collectionViewMode === secondSettings.collectionViewMode &&
    firstSettings.locale === secondSettings.locale &&
    firstSettings.performanceHudEnabled === secondSettings.performanceHudEnabled &&
    firstSettings.oneMoreColor === secondSettings.oneMoreColor &&
    firstSettings.photoQualityMode === secondSettings.photoQualityMode &&
    firstSettings.polaroidFooterLabel === secondSettings.polaroidFooterLabel &&
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
    const rawValue = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
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
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.warn("Unable to persist app settings:", error);
  }
}

function loadSettings() {
  const storedSettings = readStoredSettings();

  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...storedSettings,
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
      console.error("App settings listener failed:", error);
    }
  });
}

/** @returns {AppSettings} */
export function getDefaultAppSettings() {
  return {
    ...DEFAULT_SETTINGS,
    medianCut: cloneMedianCutSettings(DEFAULT_SETTINGS.medianCut),
    paletteScoring: clonePaletteScoringSettings(DEFAULT_SETTINGS.paletteScoring),
  };
}

/** @returns {AppSettingsPatch} */
export function getDefaultAppSettingsResetPatch() {
  const defaults = getDefaultAppSettings();

  return {
    captureMode: defaults.captureMode,
    collectionViewMode: defaults.collectionViewMode,
    locale: defaults.locale,
    performanceHudEnabled: defaults.performanceHudEnabled,
    oneMoreColor: defaults.oneMoreColor,
    photoQualityMode: defaults.photoQualityMode,
    polaroidFooterLabel: defaults.polaroidFooterLabel,
    medianCut: defaults.medianCut,
    paletteScoring: defaults.paletteScoring,
  };
}

/** @returns {AppSettings} */
export function getAppSettings() {
  return {
    ...settingsStore.currentSettings,
    medianCut: cloneMedianCutSettings(settingsStore.currentSettings.medianCut),
    paletteScoring: clonePaletteScoringSettings(settingsStore.currentSettings.paletteScoring),
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
  if (typeof listener !== "function") {
    return () => {};
  }

  settingsStore.listeners.add(listener);
  return () => {
    settingsStore.listeners.delete(listener);
  };
}

export const APP_SETTINGS_LIMITS = Object.freeze({
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
