export const COMMUNITY_SURFACE_NAME = "community";

/**
 * Opens the community feed panel from the footer button. The panel's code is
 * loaded on the first tap, like the collection's.
 */
export function createCommunityEntryController({
  communityButton,
  loadCommunityModule,
  onLoadError,
  onSurfaceOpening,
  onSurfaceOpenAbandoned,
}) {
  let communityModule = null;
  let communityModulePromise = null;
  let pendingOpen = null;
  let isBound = false;
  let isDestroyed = false;
  let isCommunityModuleDestroyed = false;

  function destroyCommunityModuleOnce(module) {
    if (isCommunityModuleDestroyed) {
      return;
    }

    isCommunityModuleDestroyed = true;
    module?.destroyCommunityUi?.();
  }

  async function getCommunityModule() {
    if (isDestroyed) {
      return null;
    }

    communityModulePromise ??= Promise.resolve()
      .then(loadCommunityModule)
      .catch((error) => {
        communityModulePromise = null;
        throw error;
      });
    const loadedModule = await communityModulePromise;
    if (isDestroyed) {
      destroyCommunityModuleOnce(loadedModule);
      return null;
    }

    communityModule = loadedModule;
    return loadedModule;
  }

  async function runOpen() {
    onSurfaceOpening?.(COMMUNITY_SURFACE_NAME);
    let didOpen = false;
    try {
      const module = await getCommunityModule();
      if (!module) {
        return;
      }
      didOpen = (await module.openCommunityPanel()) === true;
    } catch (error) {
      if (!isDestroyed) {
        onLoadError?.(error);
      }
    } finally {
      if (!didOpen) {
        onSurfaceOpenAbandoned?.(COMMUNITY_SURFACE_NAME);
      }
    }
  }

  function openCommunity() {
    if (pendingOpen) {
      return pendingOpen;
    }

    const openPromise = runOpen();
    pendingOpen = openPromise;
    const clearPendingOpen = () => {
      if (pendingOpen === openPromise) {
        pendingOpen = null;
      }
    };
    void openPromise.then(clearPendingOpen, clearPendingOpen);
    return openPromise;
  }

  function bindEvents() {
    if (isBound || isDestroyed) {
      return;
    }

    isBound = true;
    communityButton?.addEventListener("click", openCommunity);
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    if (isBound) {
      communityButton?.removeEventListener("click", openCommunity);
      isBound = false;
    }

    if (communityModule) {
      destroyCommunityModuleOnce(communityModule);
    } else if (communityModulePromise) {
      void communityModulePromise.then(destroyCommunityModuleOnce).catch(() => {});
    }
    communityModule = null;
    communityModulePromise = null;
    pendingOpen = null;
  }

  return { bindEvents, destroy, openCommunity };
}
