import { ensurePaletteMasterPhotoBlob } from "../../palette-storage.js";
import { hasPaletteMasterPhoto, renderPalettePolaroidBlob } from "./palette-polaroid-renderer.js";
import {
  getCurrentPalettePreviewFooterLabel,
  getStoredPalettePreviewBlob,
  persistSavedPalettePreviewBlob,
  renderPalettePreviewBlobFromMasterPhoto,
} from "./palette-preview-persistence.js";

const POLAROID_EXPORT_MAX_WIDTH = 1600;
const POLAROID_EXPORT_SCALE = 1;
const POLAROID_EXPORT_QUALITY = 0.95;

const previewAssetCache = new Map();
const masterPhotoAssetCache = new Map();
let previewRenderQueue = Promise.resolve();

function buildPreviewAssetCacheKey(palette) {
  const cropRect = palette?.captureCropRect;

  return JSON.stringify([
    String(palette?.id ?? ""),
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

function enqueuePreviewRender(task) {
  const runTask = previewRenderQueue.catch(() => undefined).then(task);
  previewRenderQueue = runTask.catch(() => undefined);
  return runTask;
}

function disposePreviewAssetCacheEntry(cacheKey) {
  const cached = previewAssetCache.get(cacheKey);
  if (cached?.objectUrl) {
    URL.revokeObjectURL(cached.objectUrl);
  }
  previewAssetCache.delete(cacheKey);
}

function disposeMasterPhotoAssetCacheEntry(cacheKey) {
  const cached = masterPhotoAssetCache.get(cacheKey);
  if (cached?.objectUrl) {
    URL.revokeObjectURL(cached.objectUrl);
  }
  masterPhotoAssetCache.delete(cacheKey);
}

/**
 * @param {Palette} palette
 * @returns {Promise<PreviewAsset>}
 */
export async function getPalettePreviewPolaroidAsset(palette) {
  if (!hasPaletteMasterPhoto(palette)) {
    throw new Error("Missing palette photo");
  }

  const cacheKey = buildPreviewAssetCacheKey(palette);
  const cached = previewAssetCache.get(cacheKey);

  if (cached?.blob && cached?.objectUrl) {
    return cached;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const storedPreviewBlob = getStoredPalettePreviewBlob(palette);
  if (storedPreviewBlob instanceof Blob) {
    const asset = {
      blob: storedPreviewBlob,
      objectUrl: URL.createObjectURL(storedPreviewBlob),
    };
    previewAssetCache.set(cacheKey, asset);
    return asset;
  }

  const promise = enqueuePreviewRender(async () => {
    let blob = null;
    const masterPhotoBlob = await ensurePaletteMasterPhotoBlob(palette);
    const previewFooterLabel = getCurrentPalettePreviewFooterLabel();

    try {
      if (masterPhotoBlob instanceof Blob) {
        blob = await renderPalettePreviewBlobFromMasterPhoto(palette, masterPhotoBlob);
      }
    } catch (error) {
      console.warn("Falling back to raw palette preview image.", error);
    }

    if (!(blob instanceof Blob)) {
      blob = getStoredPalettePreviewBlob(palette);
    }

    if (!(blob instanceof Blob) && masterPhotoBlob instanceof Blob) {
      blob = masterPhotoBlob;
    }

    if (!blob) {
      throw new Error("Unable to generate palette preview");
    }

    if (blob instanceof Blob && blob !== masterPhotoBlob) {
      void persistSavedPalettePreviewBlob(palette, blob, previewFooterLabel).catch((error) => {
        console.error(`Failed to persist preview blob for palette ${palette.id}:`, error);
      });
    }

    const asset = {
      blob,
      objectUrl: URL.createObjectURL(blob),
    };

    previewAssetCache.set(cacheKey, asset);
    return asset;
  }).catch((error) => {
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
export async function getPaletteMasterPhotoAsset(palette) {
  if (!hasPaletteMasterPhoto(palette)) {
    throw new Error("Missing palette photo");
  }

  const cacheKey = JSON.stringify([String(palette?.id ?? ""), "master-photo"]);
  const cached = masterPhotoAssetCache.get(cacheKey);

  if (cached?.blob && cached?.objectUrl) {
    return cached;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = (async () => {
    const blob = await ensurePaletteMasterPhotoBlob(palette);
    if (!(blob instanceof Blob)) {
      throw new Error("Missing palette photo");
    }

    const asset = {
      blob,
      objectUrl: URL.createObjectURL(blob),
    };

    masterPhotoAssetCache.set(cacheKey, asset);
    return asset;
  })().catch((error) => {
    if (masterPhotoAssetCache.get(cacheKey)?.promise === promise) {
      masterPhotoAssetCache.delete(cacheKey);
    }
    throw error;
  });

  masterPhotoAssetCache.set(cacheKey, { promise });
  return promise;
}

export function disposePalettePreviewPolaroidAsset(paletteOrId) {
  const isObject = typeof paletteOrId === "object" && paletteOrId !== null;
  const paletteId = isObject ? String(paletteOrId.id ?? "") : String(paletteOrId ?? "");
  const cacheKey = isObject
    ? buildPreviewAssetCacheKey(paletteOrId)
    : JSON.stringify([paletteId, "", "", "", "", "", ""]);
  disposePreviewAssetCacheEntry(cacheKey);
  disposeMasterPhotoAssetCacheEntry(JSON.stringify([paletteId, "master-photo"]));

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

  [...masterPhotoAssetCache.keys()].forEach((key) => {
    if (getPaletteIdFromCacheKey(key) !== paletteId) {
      return;
    }
    disposeMasterPhotoAssetCacheEntry(key);
  });
}

export async function exportPalettePolaroidImage(palette) {
  try {
    const masterPhotoBlob = await ensurePaletteMasterPhotoBlob(palette);
    if (!(masterPhotoBlob instanceof Blob)) {
      return false;
    }

    const blob = await renderPalettePolaroidBlob(
      { ...palette, photoBlob: masterPhotoBlob },
      {
        maxWidth: POLAROID_EXPORT_MAX_WIDTH,
        scale: POLAROID_EXPORT_SCALE,
        quality: POLAROID_EXPORT_QUALITY,
      },
    );

    if (!blob) {
      return false;
    }

    return downloadBlob(blob, `palette-${palette.id}.webp`);
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
    const asset = await getPalettePreviewPolaroidAsset(palette);
    const ext = asset.blob.type === "image/webp" ? "webp" : "jpg";
    const file = new File([asset.blob], `palette-${palette.id}.${ext}`, {
      type: asset.blob.type || "image/jpeg",
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
