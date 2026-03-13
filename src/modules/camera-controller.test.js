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

describe("createCameraController", () => {
  const originalMediaDevices = globalThis.navigator?.mediaDevices;
  const originalMediaStream = globalThis.MediaStream;
  const originalWarn = console.warn;

  beforeEach(() => {
    console.warn = () => {};
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
});
