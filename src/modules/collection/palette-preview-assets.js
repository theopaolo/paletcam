import { ensurePaletteMasterPhotoBlob } from "../../palette-storage.js";
import { hasPaletteMasterPhoto, renderPalettePolaroidBlob } from "./palette-polaroid-renderer.js";
import {
  ensureSavedPalettePreviewBlob,
  getCurrentPalettePreviewFooterLabel,
  getStoredPalettePreviewBlob,
} from "./palette-preview-persistence.js";

const POLAROID_EXPORT_MAX_WIDTH = 1600;
const POLAROID_EXPORT_SCALE = 1;
const POLAROID_EXPORT_QUALITY = 0.95;

const previewAssetCache = new Map();

function createAssetFromBlob(blob) {
  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
  };
}

function getCachedAsset(cache, cacheKey) {
  const cached = cache.get(cacheKey);

  if (cached?.blob && cached?.objectUrl) {
    return cached;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  return null;
}

function buildPreviewAssetCacheKey(palette, variant = "viewer") {
  const cropRect = palette?.captureCropRect;

  return JSON.stringify([
    String(palette?.id ?? ""),
    String(variant),
    String(palette?.captureAspectRatio ?? ""),
    cropRect?.x ?? "",
    cropRect?.y ?? "",
    cropRect?.width ?? "",
    cropRect?.height ?? "",
    getCurrentPalettePreviewFooterLabel(),
  ]);
}

function getPaletteIdFromCacheKey(cacheKey) {
  try {
    const parsed = JSON.parse(cacheKey);
    return Array.isArray(parsed) ? String(parsed[0] ?? "") : "";
  } catch (_error) {
    return "";
  }
}

function downloadBlob(blob, filename) {
  if (!blob) {
    return false;
  }

  const link = document.createElement("a");
  const downloadUrl = URL.createObjectURL(blob);

  link.download = filename;
  link.href = downloadUrl;
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 0);

  return true;
}

function disposePreviewAssetCacheEntry(cacheKey) {
  const cached = previewAssetCache.get(cacheKey);
  if (cached?.objectUrl) {
    URL.revokeObjectURL(cached.objectUrl);
  }
  previewAssetCache.delete(cacheKey);
}

function getStoredPreviewAsset(
  palette,
  variant = "viewer",
  cacheKey = buildPreviewAssetCacheKey(palette, variant),
) {
  const cached = getCachedAsset(previewAssetCache, cacheKey);
  if (cached) {
    return cached;
  }

  const storedPreviewBlob = getStoredPalettePreviewBlob(palette, variant);
  if (!(storedPreviewBlob instanceof Blob)) {
    return null;
  }

  const asset = createAssetFromBlob(storedPreviewBlob);
  previewAssetCache.set(cacheKey, asset);
  return asset;
}

async function renderHighQualityPalettePolaroidBlob(palette) {
  const masterPhotoBlob = await ensurePaletteMasterPhotoBlob(palette);
  if (!(masterPhotoBlob instanceof Blob)) {
    return null;
  }

  return renderPalettePolaroidBlob(
    { ...palette, photoBlob: masterPhotoBlob },
    {
      maxWidth: POLAROID_EXPORT_MAX_WIDTH,
      scale: POLAROID_EXPORT_SCALE,
      quality: POLAROID_EXPORT_QUALITY,
    },
  );
}

/**
 * @param {Palette} palette
 * @param {object} [options]
 * @param {"gallery" | "viewer"} [options.variant]
 * @returns {Promise<PreviewAsset>}
 */
export async function getPalettePreviewPolaroidAsset(palette, { variant = "viewer" } = {}) {
  const cacheKey = buildPreviewAssetCacheKey(palette, variant);
  const storedAsset = getStoredPreviewAsset(palette, variant, cacheKey);
  if (storedAsset) {
    return storedAsset;
  }

  const promise = (async () => {
    const previewBlob = await ensureSavedPalettePreviewBlob(palette, variant);
    if (!(previewBlob instanceof Blob)) {
      throw new Error("Unable to generate palette preview");
    }

    const asset = createAssetFromBlob(previewBlob);
    previewAssetCache.set(cacheKey, asset);
    return asset;
  })().catch((error) => {
    if (previewAssetCache.get(cacheKey)?.promise === promise) {
      previewAssetCache.delete(cacheKey);
    }
    throw error;
  });

  previewAssetCache.set(cacheKey, { promise });
  return promise;
}

/**
 * @param {Palette} palette
 * @returns {Promise<PreviewAsset>}
 */
export async function getPaletteGalleryPreviewAsset(palette) {
  return getPalettePreviewPolaroidAsset(palette, { variant: "gallery" });
}

/**
 * @param {Palette} palette
 * @returns {Promise<PreviewAsset>}
 */
export async function getPaletteViewerPreviewAsset(palette) {
  return getPalettePreviewPolaroidAsset(palette, { variant: "viewer" });
}

/**
 * @param {Palette} palette
 * @returns {Promise<PreviewAsset>}
 */
export async function getPaletteDisplayPreviewAsset(palette) {
  return getPaletteViewerPreviewAsset(palette);
}

export function disposePalettePreviewPolaroidAsset(paletteOrId) {
  const isObject = typeof paletteOrId === "object" && paletteOrId !== null;
  const paletteId = isObject ? String(paletteOrId.id ?? "") : String(paletteOrId ?? "");
  const cacheKey = isObject
    ? buildPreviewAssetCacheKey(paletteOrId, "viewer")
    : JSON.stringify([paletteId, "", "", "", "", "", ""]);
  disposePreviewAssetCacheEntry(cacheKey);

  // Backward cleanup: remove any cache entries for the same id if the key schema changes.

  if (!paletteId) {
    return;
  }

  [...previewAssetCache.keys()].forEach((key) => {
    if (getPaletteIdFromCacheKey(key) !== paletteId) {
      return;
    }
    disposePreviewAssetCacheEntry(key);
  });
}

export async function exportPalettePolaroidImage(palette) {
  try {
    const blob = await renderHighQualityPalettePolaroidBlob(palette);
    if (!blob) {
      return false;
    }

    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return downloadBlob(blob, `palette-${palette.id}.${ext}`);
  } catch (error) {
    console.error("Failed to render export image:", error);
    return false;
  }
}

/**
 * @param {Palette} palette
 * @returns {Promise<ShareResult>}
 */
export async function sharePalettePolaroidImage(palette) {
  if (!navigator.share || typeof File !== "function") {
    return { status: "unsupported" };
  }

  try {
    const blob = await renderHighQualityPalettePolaroidBlob(palette);
    if (!(blob instanceof Blob)) {
      return { status: "error" };
    }

    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const file = new File([blob], `palette-${palette.id}.${ext}`, {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });

    const shareData = {
      files: [file],
      title: "Palette",
    };

    if (navigator.canShare) {
      try {
        if (!navigator.canShare({ files: [file] })) {
          return { status: "unsupported" };
        }
      } catch (_error) {
        return { status: "unsupported" };
      }
    }

    await navigator.share(shareData);
    return { status: "shared" };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: "cancelled" };
    }

    console.error("Failed to share palette image:", error);
    return { status: "error" };
  }
}

export { hasPaletteMasterPhoto };
