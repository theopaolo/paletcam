import { describe, expect, mock, test } from "bun:test";
import { PALETTE_DELETED_EVENT } from "../collection/collection-events.js";
import { createCollectionEntryController } from "./collection-entry-controller.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) {
        listeners.delete(name);
      }
    },
    dispatch(name, detail = {}) {
      return listeners.get(name)?.({ detail });
    },
  };
}

function createHarness({ loadCollectionModule } = {}) {
  const photoOutput = {
    ...createEventTarget(),
    getAttribute: mock(() => "blob:photo"),
    hidden: true,
  };
  const viewCollectionButton = createEventTarget();
  const deletedEventTarget = createEventTarget();
  const photoOutputController = {
    clear: mock(() => {}),
    getPaletteId: mock(() => 42),
    hasPhoto: mock(() => true),
  };
  const collectionModule = {
    destroyCollectionUi: mock(() => {}),
    openCollectionPanel: mock(async () => true),
    openDirectPaletteViewer: mock(async () => "opened"),
  };
  const loadModule = loadCollectionModule ?? mock(async () => collectionModule);
  const onLoadError = mock(() => {});
  const onViewerMissing = mock(() => {});
  const onViewerPendingDelete = mock(() => {});
  const onSurfaceOpening = mock(() => {});
  const onSurfaceOpenAbandoned = mock(() => {});
  const controller = createCollectionEntryController({
    photoOutput,
    viewCollectionButton,
    photoOutputController,
    deletedEventTarget,
    loadCollectionModule: loadModule,
    onLoadError,
    onViewerMissing,
    onViewerPendingDelete,
    onSurfaceOpening,
    onSurfaceOpenAbandoned,
  });

  return {
    collectionModule,
    controller,
    deletedEventTarget,
    loadModule,
    onLoadError,
    onSurfaceOpenAbandoned,
    onSurfaceOpening,
    onViewerMissing,
    onViewerPendingDelete,
    photoOutput,
    photoOutputController,
    viewCollectionButton,
  };
}

describe("collection entry controller", () => {
  test("reports collection and direct-viewer surface ownership", async () => {
    const harness = createHarness();

    await harness.controller.openCollection();
    await harness.controller.openMiniOutputViewer();

    expect(harness.onSurfaceOpening).toHaveBeenNthCalledWith(1, "collection");
    expect(harness.onSurfaceOpening).toHaveBeenNthCalledWith(2, "catch-details");
    expect(harness.onSurfaceOpenAbandoned).not.toHaveBeenCalled();
  });

  test("shares one lazy module across collection and viewer actions", async () => {
    const harness = createHarness();

    await Promise.all([
      harness.controller.openCollection(),
      harness.controller.openMiniOutputViewer(),
    ]);

    expect(harness.loadModule).toHaveBeenCalledTimes(1);
    expect(harness.collectionModule.openCollectionPanel).toHaveBeenCalledTimes(1);
    expect(harness.collectionModule.openDirectPaletteViewer).toHaveBeenCalledWith(42);
  });

  test("deduplicates rapid direct-viewer opens so one request owns the surface", async () => {
    const deferred = createDeferred();
    const harness = createHarness();
    harness.collectionModule.openDirectPaletteViewer.mockImplementation(() => deferred.promise);

    const firstOpen = harness.controller.openMiniOutputViewer();
    const secondOpen = harness.controller.openMiniOutputViewer();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstOpen).toBe(secondOpen);
    expect(harness.onSurfaceOpening).toHaveBeenCalledTimes(1);
    expect(harness.collectionModule.openDirectPaletteViewer).toHaveBeenCalledTimes(1);

    deferred.resolve("opened");
    await firstOpen;
    expect(harness.onSurfaceOpenAbandoned).not.toHaveBeenCalled();
  });

  test("retries collection module loading after a transient failure", async () => {
    const loadError = new Error("temporary chunk failure");
    const harness = createHarness();
    harness.loadModule
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(harness.collectionModule);

    await harness.controller.openCollection();
    await harness.controller.openCollection();

    expect(harness.loadModule).toHaveBeenCalledTimes(2);
    expect(harness.onLoadError).toHaveBeenCalledWith(loadError, "collection");
    expect(harness.collectionModule.openCollectionPanel).toHaveBeenCalledTimes(1);
  });

  test("preserves pending-delete and missing viewer outcomes", async () => {
    const harness = createHarness();
    harness.collectionModule.openDirectPaletteViewer
      .mockResolvedValueOnce("pending-delete")
      .mockResolvedValueOnce("missing");

    await harness.controller.openMiniOutputViewer();
    expect(harness.onViewerPendingDelete).toHaveBeenCalledTimes(1);
    expect(harness.photoOutputController.clear).not.toHaveBeenCalled();
    expect(harness.onSurfaceOpenAbandoned).toHaveBeenCalledWith("catch-details");

    await harness.controller.openMiniOutputViewer();
    expect(harness.photoOutputController.clear).toHaveBeenCalledTimes(1);
    expect(harness.onViewerMissing).toHaveBeenCalledTimes(1);
    expect(harness.onSurfaceOpenAbandoned).toHaveBeenCalledTimes(2);
  });

  test("owns photo output and palette-deletion synchronization", () => {
    const harness = createHarness();
    harness.controller.bindEvents();

    harness.photoOutput.dispatch("load");
    expect(harness.photoOutput.hidden).toBe(false);

    harness.photoOutput.dispatch("error");
    expect(harness.photoOutputController.clear).toHaveBeenCalledTimes(1);

    harness.deletedEventTarget.dispatch(PALETTE_DELETED_EVENT, { paletteId: 7 });
    expect(harness.photoOutputController.clear).toHaveBeenCalledTimes(1);
    harness.deletedEventTarget.dispatch(PALETTE_DELETED_EVENT, { paletteId: 42 });
    expect(harness.photoOutputController.clear).toHaveBeenCalledTimes(2);
  });

  test("reports collection and viewer load failures by operation", async () => {
    const firstError = new Error("chunk unavailable");
    const firstHarness = createHarness({
      loadCollectionModule: mock(async () => {
        throw firstError;
      }),
    });
    await firstHarness.controller.openCollection();
    expect(firstHarness.onLoadError).toHaveBeenCalledWith(firstError, "collection");
    expect(firstHarness.onSurfaceOpenAbandoned).toHaveBeenCalledWith("collection");

    const secondError = new Error("viewer unavailable");
    const secondHarness = createHarness();
    secondHarness.collectionModule.openDirectPaletteViewer.mockRejectedValueOnce(secondError);
    await secondHarness.controller.openMiniOutputViewer();
    expect(secondHarness.onLoadError).toHaveBeenCalledWith(secondError, "viewer");
    expect(secondHarness.onSurfaceOpenAbandoned).toHaveBeenCalledWith("catch-details");
  });

  test("destroys a module that resolves after teardown without presenting stale UI", async () => {
    const deferred = createDeferred();
    const harness = createHarness({ loadCollectionModule: () => deferred.promise });
    const opening = harness.controller.openMiniOutputViewer();

    harness.controller.destroy();
    deferred.resolve(harness.collectionModule);
    await opening;
    await Promise.resolve();

    expect(harness.collectionModule.openDirectPaletteViewer).not.toHaveBeenCalled();
    expect(harness.collectionModule.destroyCollectionUi).toHaveBeenCalledTimes(1);
    expect(harness.onLoadError).not.toHaveBeenCalled();
    expect(harness.onViewerMissing).not.toHaveBeenCalled();
    expect(harness.onSurfaceOpenAbandoned).toHaveBeenCalledWith("catch-details");
  });

  test("destroy is idempotent and removes every owned listener", async () => {
    const harness = createHarness();
    harness.controller.bindEvents();
    await harness.controller.openCollection();

    harness.controller.destroy();
    harness.controller.destroy();

    expect(harness.collectionModule.destroyCollectionUi).toHaveBeenCalledTimes(1);
    expect(harness.photoOutput.listeners.size).toBe(0);
    expect(harness.viewCollectionButton.listeners.size).toBe(0);
    expect(harness.deletedEventTarget.listeners.size).toBe(0);
  });
});
