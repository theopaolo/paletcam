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

export function getCurrentPalettePreviewFooterLabel() {
  return normalizePreviewFooterLabel(getAppSettings().polaroidFooterLabel);
}

export function getStoredPalettePreviewBlob(palette) {
  const currentPreviewFooterLabel = getCurrentPalettePreviewFooterLabel();

  return (
    palette?.previewBlob instanceof Blob
    && palette?.previewFooterLabel === currentPreviewFooterLabel
  )
    ? palette.previewBlob
    : null;
}

export async function renderPalettePreviewBlobFromMasterPhoto(palette, photoBlob) {
  if (!(photoBlob instanceof Blob)) {
    return null;
  }

  return renderPalettePolaroidBlob(
    { ...palette, photoBlob },
    PALETTE_PREVIEW_RENDER_OPTIONS,
  );
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
      logMessage: 'Failed to warm saved palette preview.',
      context: { paletteId: palette?.id ?? null },
    });
    return null;
  }
}
