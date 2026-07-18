function createViewerAbortError() {
  return new DOMException("Collection viewer was destroyed.", "AbortError");
}

/**
 * @typedef {object} CollectionViewerModule
 * @property {(options: PaletteViewerOpenOptions) => boolean | void} openPaletteViewerOverlay
 * @property {() => void} [closePaletteViewerOverlay]
 * @property {(options?: object) => void} [refreshPaletteViewerOverlay]
 * @property {() => void} [destroyPaletteViewerOverlay]
 */

/**
 * Owns lazy loading and terminal cleanup for the collection viewer module.
 * Presentation policy stays with the caller through the options passed to
 * `open`; this boundary only coordinates module lifetime and stale-open guards.
 *
 * @param {object} options
 * @param {() => Promise<CollectionViewerModule>} options.loadModule
 * @param {() => Error} [options.createAbortError]
 */
export function createCollectionViewerCoordinator({
  loadModule,
  createAbortError = createViewerAbortError,
}) {
  let destroyed = false;
  let openIntentGeneration = 0;
  /** @type {CollectionViewerModule | null} */
  let viewerModule = null;
  /** @type {Promise<CollectionViewerModule> | null} */
  let viewerModulePromise = null;

  function getViewerModule() {
    if (destroyed) {
      return Promise.reject(createAbortError());
    }

    if (viewerModule) {
      return Promise.resolve(viewerModule);
    }

    viewerModulePromise ??= Promise.resolve()
      .then(loadModule)
      .then((loadedModule) => {
        if (destroyed) {
          loadedModule.destroyPaletteViewerOverlay?.();
          throw createAbortError();
        }
        viewerModule = loadedModule;
        return viewerModule;
      })
      .catch((error) => {
        viewerModulePromise = null;
        throw error;
      });

    return viewerModulePromise;
  }

  /**
   * @param {PaletteViewerOpenOptions} options
   * @param {{canOpen?: () => boolean}} [openOptions]
   */
  async function open(options, { canOpen = () => true } = {}) {
    const loadedModule = await getViewerModule();
    if (destroyed || !canOpen()) {
      return false;
    }

    return loadedModule.openPaletteViewerOverlay(options) === true;
  }

  function beginOpenIntent() {
    const intentGeneration = ++openIntentGeneration;
    return () => !destroyed && intentGeneration === openIntentGeneration;
  }

  function close() {
    viewerModule?.closePaletteViewerOverlay?.();
  }

  /** @param {object} [options] */
  function refresh(options) {
    viewerModule?.refreshPaletteViewerOverlay?.(options);
  }

  function destroy() {
    if (destroyed) {
      return false;
    }

    destroyed = true;
    openIntentGeneration += 1;
    viewerModule?.destroyPaletteViewerOverlay?.();
    viewerModule = null;
    return true;
  }

  return {
    beginOpenIntent,
    close,
    destroy,
    isDestroyed: () => destroyed,
    open,
    refresh,
  };
}
