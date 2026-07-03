import { ensurePaletteMasterPhotoBlob } from "../../palette-storage.js";
import { isIOSDevice } from "../platform.js";
import { hasPaletteMasterPhoto, renderPalettePolaroidBlob } from "./palette-polaroid-renderer.js";
import {
  ensurePalettePolaroidColorNames,
  ensureSavedPalettePreviewBlob,
  getPalettePreviewFingerprint,
  getStoredPalettePreviewBlob,
  hydratePalettePreviewBlobFromIdb,
  renderSavedPalettePreviewBlob,
} from "./palette-preview-persistence.js";

const POLAROID_EXPORT_MAX_WIDTH = 1600;
const POLAROID_EXPORT_SCALE = 1;
const POLAROID_EXPORT_QUALITY = 0.95;
const MAX_PREVIEW_ASSET_CACHE_ENTRIES = 24;

const previewAssetCache = new Map();

function describeBlob(blob) {
  if (!(blob instanceof Blob)) {
    return null;
  }

  return {
    size: blob.size,
    type: blob.type || "application/octet-stream",
  };
}

function describeObjectUrl(objectUrl) {
  if (typeof objectUrl !== "string" || objectUrl.length === 0) {
    return null;
  }

  if (objectUrl.startsWith("blob:")) {
    return "blob";
  }

  if (objectUrl.startsWith("data:")) {
    return "data";
  }

  return "other";
}

function createAssetFromBlob(blob) {
  return { blob, source: null };
}

function getCachedAsset(cache, cacheKey) {
  const cached = cache.get(cacheKey);

  if (cached?.blob) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  return null;
}

function setPreviewAssetCacheEntry(cacheKey, asset) {
  previewAssetCache.set(cacheKey, asset);

  for (const [key, cached] of previewAssetCache) {
    if (previewAssetCache.size <= MAX_PREVIEW_ASSET_CACHE_ENTRIES) {
      return;
    }

    if (cached?.promise) {
      continue;
    }

    disposePreviewAssetCacheEntry(key);
  }
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
    getPalettePreviewFingerprint(palette, variant),
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

export async function downloadBlob(blob, filename) {
  if (!blob) {
    return false;
  }

  const isIOS = isIOSDevice();

  if (isIOS && typeof navigator.share === "function") {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const canShareFiles =
      typeof navigator.canShare === "function"
        ? (() => {
            try {
              return navigator.canShare({ files: [file] });
            } catch (_error) {
              return false;
            }
          })()
        : true;

    if (canShareFiles) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (shareError) {
        if (shareError instanceof Error && shareError.name === "AbortError") {
          return false;
        }
      }
    }
  }

  const downloadUrl = URL.createObjectURL(blob);
  const revokeUrlLater = () => {
    window.setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 60000);
  };

  if (isIOS) {
    window.open(downloadUrl, "_blank");
    revokeUrlLater();
    return true;
  }

  const link = document.createElement("a");
  link.download = filename;
  link.href = downloadUrl;
  link.click();
  revokeUrlLater();
  return true;
}

function disposePreviewAssetCacheEntry(cacheKey) {
  previewAssetCache.delete(cacheKey);
}

export function resetPreviewAssetCacheForTests() {
  for (const key of [...previewAssetCache.keys()]) {
    disposePreviewAssetCacheEntry(key);
  }
}

export function getPalettePreviewDebugInfo(palette, asset = null, variant = "viewer") {
  return {
    variant,
    paletteId: Number.isFinite(Number(palette?.id)) ? Number(palette.id) : null,
    hasPhotoAsset: Boolean(palette?.hasPhotoAsset),
    captureAspectRatio: palette?.captureAspectRatio ?? null,
    hasLegacyPreviewBlob: palette?.previewBlob instanceof Blob,
    hasViewerPreviewBlob: palette?.previewViewerBlob instanceof Blob,
    hasGalleryPreviewBlob: palette?.previewGalleryBlob instanceof Blob,
    legacyPreview: describeBlob(palette?.previewBlob),
    viewerPreview: describeBlob(palette?.previewViewerBlob),
    galleryPreview: describeBlob(palette?.previewGalleryBlob),
    assetBlob: describeBlob(asset?.blob),
    assetUrlKind: describeObjectUrl(asset?.objectUrl),
  };
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
  setPreviewAssetCacheEntry(cacheKey, asset);
  return asset;
}

/**
 * Synchronously returns a cached or freshly-built gallery preview asset.
 * Returns null when no preview blob is available without doing async I/O.
 * The asset's `source` field is populated only if a prior load memoized it.
 * @param {Palette} palette
 * @returns {{ blob: Blob, source: string | null } | null}
 */
export function getStoredPaletteGalleryPreviewAssetSync(palette) {
  const variant = "gallery";
  const cacheKey = buildPreviewAssetCacheKey(palette, variant);
  const asset = getStoredPreviewAsset(palette, variant, cacheKey);
  if (!asset || asset.promise || !(asset.blob instanceof Blob)) {
    return null;
  }
  return asset;
}

async function renderHighQualityPalettePolaroidBlob(palette) {
  const masterPhotoBlob = await ensurePaletteMasterPhotoBlob(palette);
  if (!(masterPhotoBlob instanceof Blob)) {
    return null;
  }

  await ensurePalettePolaroidColorNames(palette);

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
 * @returns {Promise<PreviewAsset>}
 */
export async function getPaletteGalleryPreviewAsset(palette) {
  const variant = "gallery";
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
    setPreviewAssetCacheEntry(cacheKey, asset);
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
export async function getPaletteViewerPreviewAsset(palette) {
  const variant = "viewer";
  const cacheKey = buildPreviewAssetCacheKey(palette, variant);
  const storedAsset = getStoredPreviewAsset(palette, variant, cacheKey);
  if (storedAsset) {
    return storedAsset;
  }

  const promise = (async () => {
    const hydratedPreviewBlob = await hydratePalettePreviewBlobFromIdb(palette, variant);
    if (hydratedPreviewBlob instanceof Blob) {
      const asset = createAssetFromBlob(hydratedPreviewBlob);
      setPreviewAssetCacheEntry(cacheKey, asset);
      return asset;
    }

    const previewBlob = await renderSavedPalettePreviewBlob(palette, variant);
    if (!(previewBlob instanceof Blob)) {
      throw new Error("Unable to generate palette preview");
    }

    const asset = createAssetFromBlob(previewBlob);
    setPreviewAssetCacheEntry(cacheKey, asset);
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

export function refreshPaletteGalleryAsset(palette, paletteId) {
  disposePalettePreviewAsset(paletteId);
  if (palette && typeof palette === "object") {
    palette.previewGalleryBlob = null;
    palette.photoBlob = null;
  }
}

export function disposePalettePreviewAsset(paletteOrId) {
  const isObject = typeof paletteOrId === "object" && paletteOrId !== null;
  const paletteId = isObject ? String(paletteOrId.id ?? "") : String(paletteOrId ?? "");
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
