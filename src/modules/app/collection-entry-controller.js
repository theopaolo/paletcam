import { PALETTE_DELETED_EVENT } from "../collection/collection-events.js";

export const COLLECTION_SURFACE_NAME = "collection";
export const VIEWER_SURFACE_NAME = "catch-details";

export function createCollectionEntryController({
  photoOutput,
  viewCollectionButton,
  photoOutputController,
  deletedEventTarget = window,
  loadCollectionModule,
  onLoadError,
  onViewerPendingDelete,
  onViewerMissing,
  onSurfaceOpening,
  onSurfaceOpenAbandoned,
}) {
  let collectionModule = null;
  let collectionModulePromise = null;
  let isBound = false;
  let isDestroyed = false;
  let isCollectionModuleDestroyed = false;
  let pendingViewerOpen = null;

  function destroyCollectionModuleOnce(module) {
    if (isCollectionModuleDestroyed) {
      return;
    }

    isCollectionModuleDestroyed = true;
    module?.destroyCollectionUi?.();
  }

  async function getCollectionModule() {
    if (isDestroyed) {
      return null;
    }

    collectionModulePromise ??= Promise.resolve()
      .then(loadCollectionModule)
      .catch((error) => {
        collectionModulePromise = null;
        throw error;
      });
    const loadedModule = await collectionModulePromise;
    if (isDestroyed) {
      destroyCollectionModuleOnce(loadedModule);
      return null;
    }

    collectionModule = loadedModule;
    return loadedModule;
  }

  async function openCollection() {
    onSurfaceOpening?.(COLLECTION_SURFACE_NAME);
    let didOpen = false;
    try {
      const module = await getCollectionModule();
      if (!module) {
        return;
      }
      didOpen = (await module.openCollectionPanel()) === true;
    } catch (error) {
      if (!isDestroyed) {
        onLoadError?.(error, "collection");
      }
    } finally {
      if (!didOpen) {
        onSurfaceOpenAbandoned?.(COLLECTION_SURFACE_NAME);
      }
    }
  }

  async function runMiniOutputViewerOpen() {
    const paletteId = photoOutputController.getPaletteId();
    if (!photoOutputController.hasPhoto() || paletteId === null) {
      return;
    }

    onSurfaceOpening?.(VIEWER_SURFACE_NAME);
    let viewerOpenState;
    try {
      const module = await getCollectionModule();
      if (!module) {
        return;
      }
      viewerOpenState = await module.openDirectPaletteViewer(paletteId);
    } catch (error) {
      if (!isDestroyed) {
        onLoadError?.(error, "viewer");
      }
    } finally {
      if (viewerOpenState !== "opened") {
        onSurfaceOpenAbandoned?.(VIEWER_SURFACE_NAME);
      }
    }

    if (isDestroyed || !viewerOpenState || viewerOpenState === "opened") {
      return;
    }

    if (viewerOpenState === "pending-delete") {
      onViewerPendingDelete?.();
      return;
    }

    photoOutputController.clear();
    onViewerMissing?.();
  }

  function openMiniOutputViewer() {
    if (pendingViewerOpen) {
      return pendingViewerOpen;
    }

    const openPromise = runMiniOutputViewerOpen();
    pendingViewerOpen = openPromise;
    const clearPendingViewerOpen = () => {
      if (pendingViewerOpen === openPromise) {
        pendingViewerOpen = null;
      }
    };
    void openPromise.then(clearPendingViewerOpen, clearPendingViewerOpen);
    return openPromise;
  }

  function handlePhotoLoad() {
    photoOutput.hidden = false;
  }

  function handlePhotoError() {
    if (photoOutput.getAttribute("src")) {
      photoOutputController.clear();
    }
  }

  function handlePaletteDeleted(event) {
    const deletedPaletteId = Number(event?.detail?.paletteId);
    if (
      !Number.isFinite(deletedPaletteId) ||
      photoOutputController.getPaletteId() !== deletedPaletteId
    ) {
      return;
    }

    photoOutputController.clear();
  }

  function bindEvents() {
    if (isBound || isDestroyed) {
      return;
    }

    isBound = true;
    photoOutput?.addEventListener("load", handlePhotoLoad);
    photoOutput?.addEventListener("error", handlePhotoError);
    photoOutput?.addEventListener("click", openMiniOutputViewer);
    viewCollectionButton?.addEventListener("click", openCollection);
    deletedEventTarget?.addEventListener(PALETTE_DELETED_EVENT, handlePaletteDeleted);
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    if (isBound) {
      photoOutput?.removeEventListener("load", handlePhotoLoad);
      photoOutput?.removeEventListener("error", handlePhotoError);
      photoOutput?.removeEventListener("click", openMiniOutputViewer);
      viewCollectionButton?.removeEventListener("click", openCollection);
      deletedEventTarget?.removeEventListener(PALETTE_DELETED_EVENT, handlePaletteDeleted);
      isBound = false;
    }

    if (collectionModule) {
      destroyCollectionModuleOnce(collectionModule);
    } else if (collectionModulePromise) {
      void collectionModulePromise.then(destroyCollectionModuleOnce).catch(() => {});
    }
    collectionModule = null;
    collectionModulePromise = null;
    pendingViewerOpen = null;
  }

  return {
    bindEvents,
    destroy,
    openCollection,
    openMiniOutputViewer,
  };
}
