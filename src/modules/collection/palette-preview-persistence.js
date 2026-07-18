import { getAppSettings } from "../../app-settings.js";
import { isAppLifetimeTerminated, registerAppTermination } from "../app-terminal-lifecycle.js";
import {
  getPalettePreviewMutationVariantOrThrow,
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
const scheduledPreviewWarmupCancellations = new Set();
let previewWarmupQueue = Promise.resolve();
let previewWarmupGeneration = 0;
let arePreviewWarmupsTerminated = isAppLifetimeTerminated();

function scheduleIdleTask(callback) {
  if (typeof globalThis.window?.requestIdleCallback === "function") {
    const handle = globalThis.window.requestIdleCallback(callback, { timeout: 1200 });
    return () => globalThis.window?.cancelIdleCallback?.(handle);
  }

  const handle = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(handle);
}

function terminatePreviewWarmups() {
  if (arePreviewWarmupsTerminated) {
    return;
  }
  arePreviewWarmupsTerminated = true;
  previewWarmupGeneration += 1;
  scheduledPreviewWarmupCancellations.forEach((cancel) => {
    cancel();
  });
  scheduledPreviewWarmupCancellations.clear();
  queuedPreviewWarmups.clear();
}

registerAppTermination(terminatePreviewWarmups);

/** @returns {boolean} */
function alwaysContinue() {
  return true;
}

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
export async function hydratePalettePreviewBlobFromIdb(
  palette,
  variant = "viewer",
  { shouldContinue = alwaysContinue } = {},
) {
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

  if (!shouldContinue()) {
    return null;
  }
  const stored = await readPalettePreviewBlobById(paletteId, normalizedVariant);
  if (!shouldContinue() || !stored || !(stored.blob instanceof Blob)) {
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

export async function renderSavedPalettePreviewBlob(
  palette,
  variant = "viewer",
  { shouldContinue = alwaysContinue } = {},
) {
  if (!shouldContinue()) {
    return null;
  }
  const photoBlob = await ensurePaletteMasterPhotoBlob(palette);
  if (!shouldContinue()) {
    return null;
  }
  return renderPalettePreviewBlobFromMasterPhoto(palette, photoBlob, variant);
}

export async function persistSavedPalettePreviewBlob(
  palette,
  previewBlob,
  previewFooterLabel = null,
  variant = "viewer",
  { shouldContinue = alwaysContinue } = {},
) {
  const normalizedVariant = getPalettePreviewMutationVariantOrThrow(variant);
  const normalizedPreviewFooterLabel = normalizePreviewFooterLabel(
    previewFooterLabel ?? getPalettePreviewFingerprint(palette, normalizedVariant),
  );
  const { blobKey, footerKey } = getPreviewVariantFieldKeys(normalizedVariant);

  if (!shouldContinue()) {
    return null;
  }

  if (Number.isFinite(Number(palette?.id))) {
    await updatePalettePreviewBlob(palette.id, previewBlob, normalizedPreviewFooterLabel, {
      variant: normalizedVariant,
    });
  }

  if (shouldContinue() && palette && typeof palette === "object") {
    palette[blobKey] = previewBlob;
    palette[footerKey] = normalizedPreviewFooterLabel;
  }

  return previewBlob;
}

/**
 * Clears one persisted preview variant and its in-memory mirror. This is used
 * when an image decoder rejects a stored blob so the next render cannot reuse
 * the same corrupt data.
 * @param {Palette} palette
 * @param {"gallery" | "viewer"} variant
 * @returns {Promise<boolean>}
 */
export async function invalidateSavedPalettePreviewBlob(palette, variant = "viewer") {
  const normalizedVariant = getPalettePreviewMutationVariantOrThrow(variant);
  if (!palette || typeof palette !== "object") {
    return false;
  }

  const { blobKey, footerKey } = getPreviewVariantFieldKeys(normalizedVariant);
  const paletteId = Number(palette.id);

  if (Number.isFinite(paletteId)) {
    await updatePalettePreviewBlob(paletteId, null, null, { variant: normalizedVariant });
  }

  delete palette[blobKey];
  delete palette[footerKey];
  return Number.isFinite(paletteId);
}

export async function ensureSavedPalettePreviewBlob(
  palette,
  variant = "viewer",
  { shouldContinue = alwaysContinue } = {},
) {
  if (!shouldContinue()) {
    return null;
  }
  const normalizedVariant = normalizePreviewVariant(variant);
  const storedPreviewBlob = getStoredPalettePreviewBlob(palette, normalizedVariant);
  if (storedPreviewBlob instanceof Blob) {
    return storedPreviewBlob;
  }

  const hydratedPreviewBlob = await hydratePalettePreviewBlobFromIdb(palette, normalizedVariant, {
    shouldContinue,
  });
  if (hydratedPreviewBlob instanceof Blob) {
    return hydratedPreviewBlob;
  }

  const previewBlob = await renderSavedPalettePreviewBlob(palette, normalizedVariant, {
    shouldContinue,
  });
  if (!(previewBlob instanceof Blob)) {
    return null;
  }

  if (normalizedVariant !== "gallery") {
    return previewBlob;
  }

  if (!shouldContinue()) {
    return null;
  }

  try {
    return await persistSavedPalettePreviewBlob(
      palette,
      previewBlob,
      getPalettePreviewFingerprint(palette, normalizedVariant),
      normalizedVariant,
      { shouldContinue },
    );
  } catch (error) {
    reportAppError(error, {
      includeConsole: false,
      logMessage: "Failed to persist saved palette preview.",
      context: {
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
export async function warmSavedPalettePreview(
  palette,
  variant = "gallery",
  { shouldContinue = alwaysContinue } = {},
) {
  try {
    return await ensureSavedPalettePreviewBlob(palette, variant, { shouldContinue });
  } catch (error) {
    reportAppError(error, {
      includeConsole: false,
      logMessage: "Failed to warm saved palette preview.",
      context: {
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

function enqueueSavedPalettePreviewWarmup(palette, variant = "gallery", generation) {
  const paletteId = Number(palette?.id);
  const normalizedVariant = normalizePreviewVariant(variant);
  const warmupKey = `${String(paletteId)}:${normalizedVariant}`;
  if (
    arePreviewWarmupsTerminated ||
    generation !== previewWarmupGeneration ||
    !Number.isFinite(paletteId) ||
    queuedPreviewWarmups.has(warmupKey)
  ) {
    return;
  }

  queuedPreviewWarmups.add(warmupKey);
  const shouldContinue = () =>
    !arePreviewWarmupsTerminated && generation === previewWarmupGeneration;
  const task = async () => {
    try {
      if (
        shouldContinue() &&
        !(getStoredPalettePreviewBlob(palette, normalizedVariant) instanceof Blob)
      ) {
        await warmSavedPalettePreview(palette, normalizedVariant, { shouldContinue });
      }
    } finally {
      queuedPreviewWarmups.delete(warmupKey);
    }
  };

  previewWarmupQueue = previewWarmupQueue.catch(() => undefined).then(task);
}

export function scheduleSavedPalettePreviewWarmup(palette, variant = "gallery") {
  const normalizedVariant = normalizePreviewVariant(variant);
  if (arePreviewWarmupsTerminated || !canWarmPalettePreview(palette, normalizedVariant)) {
    return;
  }

  const generation = previewWarmupGeneration;
  let cancelScheduledTask = () => {};
  const runScheduledTask = () => {
    scheduledPreviewWarmupCancellations.delete(cancelScheduledTask);
    enqueueSavedPalettePreviewWarmup(palette, normalizedVariant, generation);
  };
  cancelScheduledTask = scheduleIdleTask(runScheduledTask);
  scheduledPreviewWarmupCancellations.add(cancelScheduledTask);
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
