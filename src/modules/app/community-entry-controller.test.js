import { describe, expect, mock, test } from "bun:test";
import {
  COMMUNITY_SURFACE_NAME,
  createCommunityEntryController,
} from "./community-entry-controller.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createHarness({ loadCommunityModule, openResult = true } = {}) {
  const listeners = new Map();
  const communityButton = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
  const communityModule = {
    destroyCommunityUi: mock(() => {}),
    openCommunityPanel: mock(async () => openResult),
  };
  const callbacks = {
    onLoadError: mock(() => {}),
    onSurfaceOpenAbandoned: mock(() => {}),
    onSurfaceOpening: mock(() => {}),
  };
  const load = loadCommunityModule ?? mock(async () => communityModule);
  const controller = createCommunityEntryController({
    communityButton,
    loadCommunityModule: load,
    ...callbacks,
  });
  return { callbacks, communityModule, controller, listeners, load };
}

describe("community entry controller", () => {
  test("loads the module on first tap, suspends the camera surface and opens the panel", async () => {
    const { callbacks, communityModule, controller, listeners, load } = createHarness();
    controller.bindEvents();

    await listeners.get("click")();
    await listeners.get("click")();

    expect(load).toHaveBeenCalledTimes(1);
    expect(callbacks.onSurfaceOpening).toHaveBeenCalledWith(COMMUNITY_SURFACE_NAME);
    expect(communityModule.openCommunityPanel).toHaveBeenCalledTimes(2);
    expect(callbacks.onSurfaceOpenAbandoned).not.toHaveBeenCalled();
  });

  test("ignores taps while an open is already pending", async () => {
    const deferred = createDeferred();
    const { communityModule, controller } = createHarness({
      loadCommunityModule: () => deferred.promise,
    });

    const first = controller.openCommunity();
    const second = controller.openCommunity();
    expect(second).toBe(first);

    deferred.resolve(communityModule);
    await first;
    expect(communityModule.openCommunityPanel).toHaveBeenCalledTimes(1);
  });

  test("releases the camera surface and reports when the module fails to load", async () => {
    const error = new Error("chunk failed");
    const { callbacks, controller } = createHarness({
      loadCommunityModule: async () => {
        throw error;
      },
    });

    await controller.openCommunity();

    expect(callbacks.onLoadError).toHaveBeenCalledWith(error);
    expect(callbacks.onSurfaceOpenAbandoned).toHaveBeenCalledWith(COMMUNITY_SURFACE_NAME);
  });

  test("retries loading the module after a failed load", async () => {
    let shouldFail = true;
    const communityModule = {
      destroyCommunityUi: mock(() => {}),
      openCommunityPanel: mock(async () => true),
    };
    const load = mock(async () => {
      if (shouldFail) throw new Error("offline");
      return communityModule;
    });
    const { controller } = createHarness({ loadCommunityModule: load });

    await controller.openCommunity();
    shouldFail = false;
    await controller.openCommunity();

    expect(load).toHaveBeenCalledTimes(2);
    expect(communityModule.openCommunityPanel).toHaveBeenCalledTimes(1);
  });

  test("releases the camera surface when the panel could not open", async () => {
    const { callbacks, controller } = createHarness({ openResult: false });

    await controller.openCommunity();

    expect(callbacks.onSurfaceOpenAbandoned).toHaveBeenCalledWith(COMMUNITY_SURFACE_NAME);
  });

  test("unbinds and destroys the loaded module once", async () => {
    const { communityModule, controller, listeners } = createHarness();
    controller.bindEvents();
    await controller.openCommunity();

    controller.destroy();
    controller.destroy();

    expect(listeners.has("click")).toBe(false);
    expect(communityModule.destroyCommunityUi).toHaveBeenCalledTimes(1);
  });

  test("destroys a module that finishes loading after the controller was destroyed", async () => {
    const deferred = createDeferred();
    const { communityModule, controller } = createHarness({
      loadCommunityModule: () => deferred.promise,
    });

    const opening = controller.openCommunity();
    controller.destroy();
    deferred.resolve(communityModule);
    await opening;

    expect(communityModule.openCommunityPanel).not.toHaveBeenCalled();
    expect(communityModule.destroyCommunityUi).toHaveBeenCalledTimes(1);
  });
});
