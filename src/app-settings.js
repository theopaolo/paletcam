import {
  DEFAULT_MAX_QUANTIZER_PIXELS,
  DEFAULT_QUANTIZED_POOL_SIZE,
} from "./modules/palette-extraction.js";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";
const MEDIAN_CUT_POOL_SIZE_RANGE = { min: 4, max: 64 };
const MEDIAN_CUT_MAX_PIXELS_RANGE = { min: 1000, max: 60000 };
const HYBRID_REPULSION_RADIUS_RANGE = { min: 0, max: 0.2 };
const HYBRID_STRENGTH_RANGE = { min: 0, max: 1 };
const HYBRID_TONE_RANGE = { min: 0, max: 1 };
const VALID_CAPTURE_MODES = new Set(["palette", "ral"]);
const VALID_COLLECTION_VIEW_MODES = new Set(["list", "grid", "swatch"]);
const VALID_LOCALES = new Set(["fr", "en"]);
const DEFAULT_POLAROID_FOOTER_LABEL = "colorcatchers.co";

const DEFAULT_MEDIAN_CUT_SETTINGS = Object.freeze({
  quantizedPoolSize: DEFAULT_QUANTIZED_POOL_SIZE,
  maxQuantizerPixels: DEFAULT_MAX_QUANTIZER_PIXELS,
});

const DEFAULT_HYBRID_SETTINGS = Object.freeze({
  repulsionRadius: 0.08,
  spreadStrength: 0.6,
  rarityStrength: 0.2,
  tone: 0.85,
  loyaltyStrength: 0.3,
});

function normalizeCaptureMode(value) {
  return VALID_CAPTURE_MODES.has(value) ? value : "palette";
}

function normalizeCollectionViewMode(value) {
  return VALID_COLLECTION_VIEW_MODES.has(value) ? value : "list";
}

function normalizeLocale(value) {
  return VALID_LOCALES.has(value) ? value : "fr";
}

function normalizePolaroidFooterLabel(value) {
  if (typeof value !== "string") {
    return DEFAULT_POLAROID_FOOTER_LABEL;
  }

  const normalizedValue = value.trim();
  return normalizedValue || DEFAULT_POLAROID_FOOTER_LABEL;
}

const DEFAULT_SETTINGS = Object.freeze({
  captureMode: "palette",
  collectionViewMode: "list",
  locale: "fr",
  performanceHudEnabled: false,
  oneMoreColor: true,
  originBadgesEnabled: true,
  polaroidFooterLabel: DEFAULT_POLAROID_FOOTER_LABEL,
  medianCut: DEFAULT_MEDIAN_CUT_SETTINGS,
  hybrid: DEFAULT_HYBRID_SETTINGS,
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
  };
}

function clampFloatInRange(rawValue, fallbackValue, range) {
  const numericValue = typeof rawValue === "number" ? rawValue : Number.parseFloat(rawValue);
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.min(range.max, Math.max(range.min, numericValue));
}

function normalizeHybridSettings(candidate) {
  const fallback = DEFAULT_SETTINGS.hybrid;

  return {
    repulsionRadius: clampFloatInRange(
      candidate?.repulsionRadius,
      fallback.repulsionRadius,
      HYBRID_REPULSION_RADIUS_RANGE,
    ),
    spreadStrength: clampFloatInRange(
      candidate?.spreadStrength,
      fallback.spreadStrength,
      HYBRID_STRENGTH_RANGE,
    ),
    rarityStrength: clampFloatInRange(
      candidate?.rarityStrength,
      fallback.rarityStrength,
      HYBRID_STRENGTH_RANGE,
    ),
    tone: clampFloatInRange(candidate?.tone, fallback.tone, HYBRID_TONE_RANGE),
    loyaltyStrength: clampFloatInRange(
      candidate?.loyaltyStrength,
      fallback.loyaltyStrength,
      HYBRID_STRENGTH_RANGE,
    ),
  };
}

function normalizeSettings(candidate) {
  return {
    captureMode: normalizeCaptureMode(candidate?.captureMode),
    collectionViewMode: normalizeCollectionViewMode(candidate?.collectionViewMode),
    locale: normalizeLocale(candidate?.locale),
    performanceHudEnabled: Boolean(candidate?.performanceHudEnabled),
    oneMoreColor: Boolean(candidate?.oneMoreColor),
    originBadgesEnabled: Boolean(candidate?.originBadgesEnabled),
    polaroidFooterLabel: normalizePolaroidFooterLabel(candidate?.polaroidFooterLabel),
    medianCut: normalizeMedianCutSettings(candidate?.medianCut),
    hybrid: normalizeHybridSettings(candidate?.hybrid),
  };
}

function areSettingsEqual(firstSettings, secondSettings) {
  return JSON.stringify(firstSettings) === JSON.stringify(secondSettings);
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
    // No UI exposes medianCut or oneMoreColor anymore: ignore overrides
    // persisted by older builds so everyone runs on the calibrated defaults.
    medianCut: { ...DEFAULT_SETTINGS.medianCut },
    oneMoreColor: DEFAULT_SETTINGS.oneMoreColor,
    hybrid: {
      ...DEFAULT_SETTINGS.hybrid,
      ...(storedSettings?.hybrid ?? {}),
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
    medianCut: { ...DEFAULT_SETTINGS.medianCut },
    hybrid: { ...DEFAULT_SETTINGS.hybrid },
  };
}

/** @returns {AppSettingsPatch} */
export function getDefaultAppSettingsResetPatch() {
  return getDefaultAppSettings();
}

/** @returns {AppSettings} */
export function getAppSettings() {
  return {
    ...settingsStore.currentSettings,
    medianCut: { ...settingsStore.currentSettings.medianCut },
    hybrid: { ...settingsStore.currentSettings.hybrid },
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
    hybrid: {
      ...settingsStore.currentSettings.hybrid,
      ...(partialSettings?.hybrid ?? {}),
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
  hybrid: Object.freeze({
    repulsionRadius: Object.freeze({ ...HYBRID_REPULSION_RADIUS_RANGE }),
    spreadStrength: Object.freeze({ ...HYBRID_STRENGTH_RANGE }),
    rarityStrength: Object.freeze({ ...HYBRID_STRENGTH_RANGE }),
    tone: Object.freeze({ ...HYBRID_TONE_RANGE }),
    loyaltyStrength: Object.freeze({ ...HYBRID_STRENGTH_RANGE }),
  }),
});
