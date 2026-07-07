import { getAppSettings } from "../../app-settings.js";
import {
  getPreviewVariantFieldKeys,
  normalizePolaroidRenderSettings,
  normalizePreviewFooterLabel,
  normalizePreviewVariant,
} from "../../palette-storage/records.js";
import {
  ensurePaletteMasterPhotoBlob,
  readPalettePreviewBlobById,
  updatePalettePreviewBlob,
} from "../../palette-storage.js";
import { reportAppError } from "../error-reporting.js";
import {
  getPalettePreviewImageMimeType,
  renderPalettePolaroidBlob,
} from "./palette-polaroid-renderer.js";

const PALETTE_PREVIEW_RENDER_VARIANTS = Object.freeze({
  gallery: Object.freeze({
    maxWidth: 480,
    minWidth: 240,
    quality: 0.82,
    scale: 0.4,
  }),
  viewer: Object.freeze({
    maxWidth: 1080,
    minWidth: 320,
    quality: 0.9,
    scale: 0.78,
  }),
});
const PALETTE_PREVIEW_RENDER_VERSION = "preview-v9";
const PALETTE_PREVIEW_WARMUP_BATCH_LIMIT = 20;
const queuedPreviewWarmups = new Set();
let previewWarmupQueue = Promise.resolve();
const scheduleIdleTask = globalThis.window?.requestIdleCallback
  ? globalThis.window.requestIdleCallback.bind(globalThis.window)
  : (callback) => globalThis.setTimeout(callback, 0);

function getPreviewRenderOptions(variant = "viewer") {
  return PALETTE_PREVIEW_RENDER_VARIANTS[normalizePreviewVariant(variant)];
}

function buildPreviewFingerprint(label, variant = "viewer") {
  return `${PALETTE_PREVIEW_RENDER_VERSION}:${normalizePreviewVariant(variant)}:${getPalettePreviewImageMimeType()}:${normalizePreviewFooterLabel(label) ?? ""}`;
}

function getPaletteRenderSettings(palette) {
  const storedSettings = normalizePolaroidRenderSettings(palette?.polaroidRenderSettings);
  if (storedSettings) {
    return storedSettings;
  }

  return { footerLabel: getAppSettings().polaroidFooterLabel };
}

export function getCurrentPalettePreviewFooterLabel(variant = "viewer") {
  return buildPreviewFingerprint(getAppSettings().polaroidFooterLabel, variant);
}

export function getPalettePreviewFingerprint(palette, variant = "viewer") {
  return buildPreviewFingerprint(getPaletteRenderSettings(palette).footerLabel, variant);
}

export function getStoredPalettePreviewBlob(palette, variant = "viewer") {
  const currentPreviewFooterLabel = getPalettePreviewFingerprint(palette, variant);
  const { blobKey, footerKey } = getPreviewVariantFieldKeys(variant);

  return palette?.[blobKey] instanceof Blob && palette?.[footerKey] === currentPreviewFooterLabel
    ? palette[blobKey]
    : null;
}

/**
 * Hydrates a preview blob onto the palette object from IDB when it's missing
 * in memory (typical for viewer previews after the lean collection listing).
 * Returns null when no stored blob exists or its fingerprint is stale.
 * @param {Palette} palette
 * @param {"gallery" | "viewer"} variant
 * @returns {Promise<Blob | null>}
 */
export async function hydratePalettePreviewBlobFromIdb(palette, variant = "viewer") {
  if (!palette || typeof palette !== "object") {
    return null;
  }

  const normalizedVariant = normalizePreviewVariant(variant);
  const { blobKey, footerKey } = getPreviewVariantFieldKeys(normalizedVariant);

  const inMemory = getStoredPalettePreviewBlob(palette, normalizedVariant);
  if (inMemory instanceof Blob) {
    return inMemory;
  }

  const paletteId = Number(palette.id);
  if (!Number.isFinite(paletteId)) {
    return null;
  }

  const stored = await readPalettePreviewBlobById(paletteId, normalizedVariant);
  if (!stored || !(stored.blob instanceof Blob)) {
    return null;
  }

  palette[blobKey] = stored.blob;
  palette[footerKey] = stored.footerLabel;

  return getStoredPalettePreviewBlob(palette, normalizedVariant);
}

export async function renderPalettePreviewBlobFromMasterPhoto(
  palette,
  photoBlob,
  variant = "viewer",
) {
  if (!(photoBlob instanceof Blob)) {
    return null;
  }

  return renderPalettePolaroidBlob({ ...palette, photoBlob }, getPreviewRenderOptions(variant));
}

export async function renderSavedPalettePreviewBlob(palette, variant = "viewer") {
  const photoBlob = await ensurePaletteMasterPhotoBlob(palette);
  return renderPalettePreviewBlobFromMasterPhoto(palette, photoBlob, variant);
}

export async function persistSavedPalettePreviewBlob(
  palette,
  previewBlob,
  previewFooterLabel = null,
  variant = "viewer",
) {
  const normalizedVariant = normalizePreviewVariant(variant);
  const normalizedPreviewFooterLabel = normalizePreviewFooterLabel(
    previewFooterLabel ?? getPalettePreviewFingerprint(palette, normalizedVariant),
  );
  const { blobKey, footerKey } = getPreviewVariantFieldKeys(normalizedVariant);

  if (Number.isFinite(Number(palette?.id))) {
    await updatePalettePreviewBlob(palette.id, previewBlob, normalizedPreviewFooterLabel, {
      variant: normalizedVariant,
    });
  }

  if (palette && typeof palette === "object") {
    palette[blobKey] = previewBlob;
    palette[footerKey] = normalizedPreviewFooterLabel;
  }

  return previewBlob;
}

export async function ensureSavedPalettePreviewBlob(palette, variant = "viewer") {
  const normalizedVariant = normalizePreviewVariant(variant);
  const storedPreviewBlob = getStoredPalettePreviewBlob(palette, normalizedVariant);
  if (storedPreviewBlob instanceof Blob) {
    return storedPreviewBlob;
  }

  const previewBlob = await renderSavedPalettePreviewBlob(palette, normalizedVariant);
  if (!(previewBlob instanceof Blob)) {
    return null;
  }

  if (normalizedVariant !== "gallery") {
    return previewBlob;
  }

  try {
    return await persistSavedPalettePreviewBlob(
      palette,
      previewBlob,
      getPalettePreviewFingerprint(palette, normalizedVariant),
      normalizedVariant,
    );
  } catch (error) {
    reportAppError(error, {
      includeConsole: false,
      logMessage: "Failed to persist saved palette preview.",
      context: {
        paletteId: palette?.id ?? null,
        variant: normalizedVariant,
      },
    });
    return previewBlob;
  }
}

/**
 * @param {Palette} palette
 * @returns {Promise<Blob | null>}
 */
export async function warmSavedPalettePreview(palette, variant = "gallery") {
  try {
    return await ensureSavedPalettePreviewBlob(palette, variant);
  } catch (error) {
    reportAppError(error, {
      includeConsole: false,
      logMessage: "Failed to warm saved palette preview.",
      context: {
        paletteId: palette?.id ?? null,
        variant: normalizePreviewVariant(variant),
      },
    });
    return null;
  }
}

function canWarmPalettePreview(palette, variant = "gallery") {
  return Boolean(
    palette &&
      typeof palette === "object" &&
      !(getStoredPalettePreviewBlob(palette, variant) instanceof Blob) &&
      (palette.photoBlob instanceof Blob || palette.hasPhotoAsset),
  );
}

function enqueueSavedPalettePreviewWarmup(palette, variant = "gallery") {
  const paletteId = Number(palette?.id);
  const normalizedVariant = normalizePreviewVariant(variant);
  const warmupKey = `${String(paletteId)}:${normalizedVariant}`;
  if (!Number.isFinite(paletteId) || queuedPreviewWarmups.has(warmupKey)) {
    return;
  }

  queuedPreviewWarmups.add(warmupKey);
  const task = async () => {
    try {
      if (!(getStoredPalettePreviewBlob(palette, normalizedVariant) instanceof Blob)) {
        await warmSavedPalettePreview(palette, normalizedVariant);
      }
    } finally {
      queuedPreviewWarmups.delete(warmupKey);
    }
  };

  previewWarmupQueue = previewWarmupQueue.catch(() => undefined).then(task);
}

export function scheduleSavedPalettePreviewWarmup(palette, variant = "gallery") {
  const normalizedVariant = normalizePreviewVariant(variant);
  if (!canWarmPalettePreview(palette, normalizedVariant)) {
    return;
  }

  scheduleIdleTask(
    () => {
      enqueueSavedPalettePreviewWarmup(palette, normalizedVariant);
    },
    { timeout: 1200 },
  );
}

export function scheduleSavedPalettePreviewWarmupBatch(palettes, variant = "gallery") {
  const normalizedVariant = normalizePreviewVariant(variant);
  if (!Array.isArray(palettes) || palettes.length === 0) {
    return;
  }

  palettes
    .filter((palette) => canWarmPalettePreview(palette, normalizedVariant))
    .slice(0, PALETTE_PREVIEW_WARMUP_BATCH_LIMIT)
    .forEach((palette) => {
      scheduleSavedPalettePreviewWarmup(palette, normalizedVariant);
    });
}
