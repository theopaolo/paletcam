import { getAppSettings } from "../../app-settings.js";
import { ensurePaletteMasterPhotoBlob, updatePalettePreviewBlob } from "../../palette-storage.js";
import { normalizePreviewFooterLabel } from "../../palette-storage/records.js";
import { reportAppError } from "../error-reporting.js";
import { renderPalettePolaroidBlob } from "./palette-polaroid-renderer.js";

const PALETTE_PREVIEW_RENDER_OPTIONS = Object.freeze({
  maxWidth: 1080,
  quality: 0.9,
  scale: 0.78,
});
const PALETTE_PREVIEW_RENDER_VERSION = "preview-v5";
const queuedPreviewWarmups = new Set();
let previewWarmupQueue = Promise.resolve();
const scheduleIdleTask = globalThis.window?.requestIdleCallback
  ? globalThis.window.requestIdleCallback.bind(globalThis.window)
  : (callback) => globalThis.setTimeout(callback, 0);

function buildPreviewFingerprint(label, showColorNames) {
  return `${PALETTE_PREVIEW_RENDER_VERSION}:${normalizePreviewFooterLabel(label) ?? ""}:${showColorNames ? "names-on" : "names-off"}`;
}

export function getCurrentPalettePreviewFooterLabel() {
  const settings = getAppSettings();
  return buildPreviewFingerprint(settings.polaroidFooterLabel, settings.polaroidShowColorNames);
}

export function getStoredPalettePreviewBlob(palette) {
  const currentPreviewFooterLabel = getCurrentPalettePreviewFooterLabel();

  return palette?.previewBlob instanceof Blob &&
    palette?.previewFooterLabel === currentPreviewFooterLabel
    ? palette.previewBlob
    : null;
}

export async function renderPalettePreviewBlobFromMasterPhoto(palette, photoBlob) {
  if (!(photoBlob instanceof Blob)) {
    return null;
  }

  return renderPalettePolaroidBlob({ ...palette, photoBlob }, PALETTE_PREVIEW_RENDER_OPTIONS);
}

export async function renderSavedPalettePreviewBlob(palette) {
  const photoBlob = await ensurePaletteMasterPhotoBlob(palette);
  return renderPalettePreviewBlobFromMasterPhoto(palette, photoBlob);
}

export async function persistSavedPalettePreviewBlob(
  palette,
  previewBlob,
  previewFooterLabel = getCurrentPalettePreviewFooterLabel(),
) {
  const normalizedPreviewFooterLabel = normalizePreviewFooterLabel(previewFooterLabel);

  if (Number.isFinite(Number(palette?.id))) {
    await updatePalettePreviewBlob(palette.id, previewBlob, normalizedPreviewFooterLabel);
  }

  if (palette && typeof palette === "object") {
    palette.previewBlob = previewBlob;
    palette.previewFooterLabel = normalizedPreviewFooterLabel;
  }

  return previewBlob;
}

export async function ensureSavedPalettePreviewBlob(palette) {
  const storedPreviewBlob = getStoredPalettePreviewBlob(palette);
  if (storedPreviewBlob instanceof Blob) {
    return storedPreviewBlob;
  }

  const previewBlob = await renderSavedPalettePreviewBlob(palette);
  if (!(previewBlob instanceof Blob)) {
    return null;
  }

  return persistSavedPalettePreviewBlob(palette, previewBlob);
}

/**
 * @param {Palette} palette
 * @returns {Promise<Blob | null>}
 */
export async function warmSavedPalettePreview(palette) {
  try {
    return await ensureSavedPalettePreviewBlob(palette);
  } catch (error) {
    reportAppError(error, {
      includeConsole: false,
      logMessage: "Failed to warm saved palette preview.",
      context: { paletteId: palette?.id ?? null },
    });
    return null;
  }
}

function enqueueSavedPalettePreviewWarmup(palette) {
  const paletteId = Number(palette?.id);
  if (!Number.isFinite(paletteId) || queuedPreviewWarmups.has(paletteId)) {
    return;
  }

  queuedPreviewWarmups.add(paletteId);
  const task = async () => {
    try {
      if (!(getStoredPalettePreviewBlob(palette) instanceof Blob)) {
        await warmSavedPalettePreview(palette);
      }
    } finally {
      queuedPreviewWarmups.delete(paletteId);
    }
  };

  previewWarmupQueue = previewWarmupQueue.catch(() => undefined).then(task);
}

export function scheduleSavedPalettePreviewWarmup(palette) {
  if (!(palette && typeof palette === "object")) {
    return;
  }

  scheduleIdleTask(() => {
    enqueueSavedPalettePreviewWarmup(palette);
  }, { timeout: 1200 });
}

export function scheduleSavedPalettePreviewWarmupBatch(palettes) {
  if (!Array.isArray(palettes) || palettes.length === 0) {
    return;
  }

  palettes.forEach((palette) => {
    scheduleSavedPalettePreviewWarmup(palette);
  });
}
