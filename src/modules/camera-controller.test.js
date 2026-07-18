import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCameraController } from "./camera-controller.js";

function createFakeVideoElement() {
  return {
    autoplay: false,
    controls: false,
    currentTime: 0,
    defaultMuted: false,
    disablePictureInPicture: false,
    ended: false,
    muted: false,
    paused: true,
    playsInline: false,
    readyState: 4,
    srcObject: null,
    videoHeight: 1080,
    videoWidth: 1920,
    pause() {
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
    setAttribute() {},
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createFakeTrack() {
  const listeners = new Map();
  let stopCount = 0;
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async applyConstraints() {},
    getCapabilities() {
      return {};
    },
    getSettings() {
      return {};
    },
    getListenerCount() {
      return listeners.size;
    },
    getStopCount() {
      return stopCount;
    },
    readyState: "live",
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.({ type });
    },
    stop() {
      stopCount += 1;
      this.readyState = "ended";
    },
  };
}

describe("createCameraController", () => {
  const originalMediaDevices = globalThis.navigator?.mediaDevices;
  const originalMediaStream = globalThis.MediaStream;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    console.warn = () => {};
    console.error = () => {};
    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: class FakeMediaStream {
        constructor(track) {
          this.track = track;
        }

        getTracks() {
          return [this.track];
        }

        getVideoTracks() {
          return [this.track];
        }
      },
    });
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;

    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
    }

    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: originalMediaStream,
    });
  });

  test("returns false and re-syncs exposure state when track constraints are rejected", async () => {
    let shouldRejectConstraints = false;
    const trackSettings = {
      exposureCompensation: 0,
      zoom: 1,
    };
    const track = {
      addEventListener() {},
      applyConstraints: async ({ advanced }) => {
        if (shouldRejectConstraints) {
          throw new Error("Constraint rejected");
        }

        const nextControls = advanced?.[0] ?? {};
        if (typeof nextControls.zoom === "number") {
          trackSettings.zoom = nextControls.zoom;
        }
        if (typeof nextControls.exposureCompensation === "number") {
          trackSettings.exposureCompensation = nextControls.exposureCompensation;
        }
      },
      getCapabilities() {
        return {
          exposureCompensation: { min: -2, max: 2, step: 0.1 },
          exposureMode: ["continuous"],
          zoom: { min: 1, max: 3, step: 0.1 },
        };
      },
      getSettings() {
        return trackSettings;
      },
      readyState: "live",
      removeEventListener() {},
      stop() {},
    };
    const stream = new MediaStream(track);

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia() {
          return stream;
        },
      },
    });

    const exposureChanges = [];
    const controller = createCameraController({
      cameraFeed: createFakeVideoElement(),
      onExposureChange(exposureValue) {
        exposureChanges.push(exposureValue);
      },
    });

    expect(await controller.startStream()).toBe(true);

    exposureChanges.length = 0;
    shouldRejectConstraints = true;

    expect(await controller.applyExposureCompensation(1)).toBe(false);
    expect(controller.getCurrentExposureCompensation()).toBe(0);
    expect(exposureChanges.at(-1)).toBe(0);
  });

  test("deduplicates overlapping starts", async () => {
    const deferredStream = createDeferred();
    let requestCount = 0;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia() {
          requestCount += 1;
          return deferredStream.promise;
        },
      },
    });
    const controller = createCameraController({ cameraFeed: createFakeVideoElement() });

    const first = controller.startStream();
    const second = controller.startStream();

    expect(requestCount).toBe(1);
    deferredStream.resolve(new MediaStream(createFakeTrack()));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  test("stops a stale stream without overriding the newer active stream", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const requests = [firstRequest, secondRequest];
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia() {
          return requests.shift().promise;
        },
      },
    });
    const cameraFeed = createFakeVideoElement();
    const activeChanges = [];
    const errors = [];
    const controller = createCameraController({
      cameraFeed,
      onCameraActiveChange: (active) => activeChanges.push(active),
      onError: (error) => errors.push(error),
    });
    const staleTrack = createFakeTrack();
    const currentTrack = createFakeTrack();
    const staleStart = controller.startStream();
    controller.stopStream();
    const currentStart = controller.startStream();

    secondRequest.resolve(new MediaStream(currentTrack));
    expect(await currentStart).toBe(true);
    firstRequest.resolve(new MediaStream(staleTrack));
    expect(await staleStart).toBe(false);

    expect(cameraFeed.srcObject.getVideoTracks()[0]).toBe(currentTrack);
    expect(staleTrack.getStopCount()).toBe(1);
    expect(currentTrack.getStopCount()).toBe(0);
    expect(activeChanges.at(-1)).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("releases an acquired stream when inline playback fails", async () => {
    const track = createFakeTrack();
    const stream = new MediaStream(track);
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    const cameraFeed = createFakeVideoElement();
    cameraFeed.play = async () => {
      throw new DOMException("Playback blocked", "AbortError");
    };
    const errors = [];
    const controller = createCameraController({
      cameraFeed,
      onError: (error) => errors.push(error),
    });

    expect(await controller.startStream()).toBe(false);
    expect(track.getStopCount()).toBe(1);
    expect(cameraFeed.srcObject).toBeNull();
    expect(errors).toHaveLength(1);
  });

  test("destroy invalidates pending acquisition and permanently prevents restart", async () => {
    const deferredStream = createDeferred();
    let requestCount = 0;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia() {
          requestCount += 1;
          return deferredStream.promise;
        },
      },
    });
    const cameraFeed = createFakeVideoElement();
    const activeChanges = [];
    const errors = [];
    const controller = createCameraController({
      cameraFeed,
      onCameraActiveChange: (active) => activeChanges.push(active),
      onError: (error) => errors.push(error),
    });
    const track = createFakeTrack();
    const pendingStart = controller.startStream();

    controller.destroy();
    deferredStream.resolve(new MediaStream(track));

    expect(await pendingStart).toBe(false);
    expect(track.getStopCount()).toBe(1);
    expect(await controller.startStream()).toBe(false);
    expect(requestCount).toBe(1);
    expect(activeChanges.at(-1)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test("removes interruption listeners when the stream stops", async () => {
    const track = createFakeTrack();
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream(track) },
    });
    const interruptions = [];
    const controller = createCameraController({
      cameraFeed: createFakeVideoElement(),
      onStreamInterrupted: (event) => interruptions.push(event),
    });

    expect(await controller.startStream()).toBe(true);
    expect(track.getListenerCount()).toBe(2);
    track.dispatch("mute");
    expect(interruptions).toEqual([{ type: "mute", trackReadyState: "live" }]);

    controller.stopStream();
    expect(track.getListenerCount()).toBe(0);
    track.dispatch("ended");
    expect(interruptions).toHaveLength(1);
  });
});
