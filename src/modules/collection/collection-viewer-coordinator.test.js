import { describe, expect, mock, test } from "bun:test";

import { createCollectionViewerCoordinator } from "./collection-viewer-coordinator.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createViewerModule() {
  return {
    closePaletteViewerOverlay: mock(() => {}),
    destroyPaletteViewerOverlay: mock(() => {}),
    openPaletteViewerOverlay: mock(() => true),
    refreshPaletteViewerOverlay: mock(() => {}),
  };
}

describe("collection viewer coordinator", () => {
  test("deduplicates lazy loading and opens only after each current guard passes", async () => {
    const deferred = createDeferred();
    const viewerModule = createViewerModule();
    const loadModule = mock(() => deferred.promise);
    const coordinator = createCollectionViewerCoordinator({ loadModule });

    const firstOpen = coordinator.open({ initialIndex: 0 }, { canOpen: () => true });
    const staleOpen = coordinator.open({ initialIndex: 1 }, { canOpen: () => false });
    deferred.resolve(viewerModule);

    await expect(firstOpen).resolves.toBe(true);
    await expect(staleOpen).resolves.toBe(false);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(viewerModule.openPaletteViewerOverlay).toHaveBeenCalledTimes(1);
    expect(viewerModule.openPaletteViewerOverlay).toHaveBeenCalledWith({ initialIndex: 0 });
  });

  test("forwards close and refresh only after the viewer has loaded", async () => {
    const viewerModule = createViewerModule();
    const coordinator = createCollectionViewerCoordinator({
      loadModule: mock(async () => viewerModule),
    });

    coordinator.close();
    coordinator.refresh({ preferredPaletteId: 1 });
    expect(viewerModule.closePaletteViewerOverlay).not.toHaveBeenCalled();
    expect(viewerModule.refreshPaletteViewerOverlay).not.toHaveBeenCalled();

    await coordinator.open({ initialIndex: 0 });
    coordinator.close();
    coordinator.refresh({ preferredPaletteId: 2 });

    expect(viewerModule.closePaletteViewerOverlay).toHaveBeenCalledTimes(1);
    expect(viewerModule.refreshPaletteViewerOverlay).toHaveBeenCalledWith({
      preferredPaletteId: 2,
    });
  });

  test("destroys a late module and suppresses its pending open", async () => {
    const deferred = createDeferred();
    const viewerModule = createViewerModule();
    const coordinator = createCollectionViewerCoordinator({
      loadModule: () => deferred.promise,
    });
    const pendingOpen = coordinator.open({ initialIndex: 0 });

    expect(coordinator.destroy()).toBe(true);
    expect(coordinator.destroy()).toBe(false);
    deferred.resolve(viewerModule);

    await expect(pendingOpen).rejects.toMatchObject({ name: "AbortError" });
    expect(viewerModule.destroyPaletteViewerOverlay).toHaveBeenCalledTimes(1);
    expect(viewerModule.openPaletteViewerOverlay).not.toHaveBeenCalled();
  });

  test("destroys a loaded module once and rejects future opens", async () => {
    const viewerModule = createViewerModule();
    const coordinator = createCollectionViewerCoordinator({
      loadModule: async () => viewerModule,
    });

    await expect(coordinator.open({ initialIndex: 0 })).resolves.toBe(true);
    expect(coordinator.destroy()).toBe(true);
    expect(coordinator.destroy()).toBe(false);
    await expect(coordinator.open({ initialIndex: 1 })).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(viewerModule.destroyPaletteViewerOverlay).toHaveBeenCalledTimes(1);
    expect(viewerModule.openPaletteViewerOverlay).toHaveBeenCalledTimes(1);
  });

  test("tracks latest direct-open intent and forwards the overlay result", async () => {
    const viewerModule = createViewerModule();
    const coordinator = createCollectionViewerCoordinator({
      loadModule: async () => viewerModule,
    });
    const firstIntentIsCurrent = coordinator.beginOpenIntent();
    const secondIntentIsCurrent = coordinator.beginOpenIntent();

    expect(firstIntentIsCurrent()).toBe(false);
    expect(secondIntentIsCurrent()).toBe(true);

    viewerModule.openPaletteViewerOverlay.mockReturnValueOnce(false);
    await expect(
      coordinator.open({ initialIndex: 0 }, { canOpen: secondIntentIsCurrent }),
    ).resolves.toBe(false);

    coordinator.destroy();
    expect(secondIntentIsCurrent()).toBe(false);
  });

  test("clears a failed lazy import so a later open can retry", async () => {
    const viewerModule = createViewerModule();
    const loadModule = mock()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(viewerModule);
    const coordinator = createCollectionViewerCoordinator({ loadModule });

    await expect(coordinator.open({ initialIndex: 0 })).rejects.toThrow("chunk unavailable");
    await expect(coordinator.open({ initialIndex: 1 })).resolves.toBe(true);

    expect(loadModule).toHaveBeenCalledTimes(2);
    expect(viewerModule.openPaletteViewerOverlay).toHaveBeenCalledWith({ initialIndex: 1 });
  });
});
