import {
  hasPaletteMasterPhoto,
  renderPalettePolaroidBlob,
} from "./palette-polaroid-renderer.js";

const POLAROID_PREVIEW_MAX_WIDTH = 1080;
const POLAROID_PREVIEW_SCALE = 0.78;
const POLAROID_PREVIEW_QUALITY = 0.9;
const POLAROID_EXPORT_MAX_WIDTH = 1600;
const POLAROID_EXPORT_SCALE = 1;
const POLAROID_EXPORT_QUALITY = 0.95;

const previewAssetCache = new Map();
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

  const promise = enqueuePreviewRender(async () => {
    const blob = await renderPalettePolaroidBlob(palette, {
      maxWidth: POLAROID_PREVIEW_MAX_WIDTH,
      scale: POLAROID_PREVIEW_SCALE,
      quality: POLAROID_PREVIEW_QUALITY,
    });

    if (!blob) {
      throw new Error("Unable to generate palette preview");
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

export function disposePalettePreviewPolaroidAsset(paletteOrId) {
  const cacheKey = typeof paletteOrId === "object" && paletteOrId !== null
    ? buildPreviewAssetCacheKey(paletteOrId)
    : JSON.stringify([String(paletteOrId ?? ""), "", "", "", "", ""]);
  disposePreviewAssetCacheEntry(cacheKey);

  // Backward cleanup: remove any cache entries for the same id if the key schema changes.
  const paletteId = typeof paletteOrId === "object" && paletteOrId !== null
    ? String(paletteOrId.id ?? "")
    : String(paletteOrId ?? "");

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
    const blob = await renderPalettePolaroidBlob(palette, {
      maxWidth: POLAROID_EXPORT_MAX_WIDTH,
      scale: POLAROID_EXPORT_SCALE,
      quality: POLAROID_EXPORT_QUALITY,
    });

    if (!blob) {
      return false;
    }

    return downloadBlob(blob, `palette-${palette.id}.webp`);
  } catch (error) {
    console.error("Failed to render export image:", error);
    return false;
  }
}

export async function sharePalettePolaroidImage(palette) {
  if (!navigator.share || typeof File !== "function") {
    return { status: "unsupported" };
  }

  try {
    const asset = await getPalettePreviewPolaroidAsset(palette);
    const file = new File([asset.blob], `palette-${palette.id}.webp`, {
      type: asset.blob.type || "image/webp",
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
