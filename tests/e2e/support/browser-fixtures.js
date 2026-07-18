/**
 * Keep camera behavior explicit in each browser test. Playwright's default
 * browser state varies between engines when no physical capture device exists.
 */
export async function installDeniedCamera(page) {
  await page.addInitScript(() => {
    const denied = async () => {
      throw new DOMException("Camera permission denied by test", "NotAllowedError");
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        getUserMedia: denied,
      },
    });
  });
}

export async function installRecoveringCamera(page) {
  await page.addInitScript(() => {
    const state = {
      attempts: 0,
      playCount: 0,
      stopCount: 0,
    };
    Object.defineProperty(window, "__cameraTestState", { value: state });

    class FakeTrack extends EventTarget {
      constructor() {
        super();
        this.readyState = "live";
      }

      async applyConstraints() {}

      getCapabilities() {
        return {};
      }

      getSettings() {
        return {};
      }

      stop() {
        if (this.readyState === "ended") return;
        this.readyState = "ended";
        state.stopCount += 1;
      }
    }

    class FakeMediaStream {
      constructor() {
        this.track = new FakeTrack();
      }

      getTracks() {
        return [this.track];
      }

      getVideoTracks() {
        return [this.track];
      }
    }

    Object.defineProperty(window, "MediaStream", {
      configurable: true,
      value: FakeMediaStream,
    });

    const mediaState = new WeakMap();
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: {
        configurable: true,
        get() {
          const item = mediaState.get(this);
          return item?.paused === false ? performance.now() / 1000 : 0;
        },
      },
      ended: { configurable: true, get: () => false },
      paused: {
        configurable: true,
        get() {
          return mediaState.get(this)?.paused ?? true;
        },
      },
      readyState: { configurable: true, get: () => 4 },
      srcObject: {
        configurable: true,
        get() {
          return mediaState.get(this)?.srcObject ?? null;
        },
        set(value) {
          const item = mediaState.get(this) ?? { paused: true, srcObject: null };
          item.srcObject = value;
          mediaState.set(this, item);
        },
      },
      videoHeight: { configurable: true, get: () => 480 },
      videoWidth: { configurable: true, get: () => 640 },
    });
    HTMLMediaElement.prototype.play = async function play() {
      const item = mediaState.get(this) ?? { paused: true, srcObject: null };
      item.paused = false;
      mediaState.set(this, item);
      state.playCount += 1;
    };
    HTMLMediaElement.prototype.pause = function pause() {
      const item = mediaState.get(this) ?? { paused: true, srcObject: null };
      item.paused = true;
      mediaState.set(this, item);
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        async getUserMedia() {
          state.attempts += 1;
          if (state.attempts === 1) {
            throw new DOMException("Denied once by lifecycle test", "NotAllowedError");
          }
          return new FakeMediaStream();
        },
      },
    });
  });
}

/**
 * Install a deterministic, successful camera without depending on host camera
 * hardware or browser media-file flags. Video frames are painted as five
 * stable color bands whenever the app draws the synthetic video to a canvas.
 */
export async function installSyntheticCamera(page) {
  await page.addInitScript(() => {
    // Keep this fixture focused on camera/capture persistence. Worker transport
    // has separate E2E coverage; using the sync extractor here removes a
    // second scheduler from the synthetic-frame readiness signal.
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: undefined,
    });

    const state = {
      playCount: 0,
      requests: [],
      stopCount: 0,
      streams: [],
    };
    Object.defineProperty(window, "__syntheticCameraTestState", { value: state });

    function readFacingMode(videoConstraint) {
      if (!videoConstraint || typeof videoConstraint !== "object") {
        return null;
      }

      const facingMode = videoConstraint.facingMode;
      if (typeof facingMode === "string") {
        return facingMode;
      }

      return facingMode?.exact ?? facingMode?.ideal ?? null;
    }

    class SyntheticVideoTrack extends EventTarget {
      constructor(facingMode) {
        super();
        this.facingMode = facingMode;
        this.readyState = "live";
      }

      async applyConstraints() {}

      getCapabilities() {
        return {};
      }

      getSettings() {
        return {
          facingMode: this.facingMode,
          frameRate: 30,
          height: 480,
          width: 640,
        };
      }

      stop() {
        if (this.readyState === "ended") return;
        this.readyState = "ended";
        state.stopCount += 1;
        this.dispatchEvent(new Event("ended"));
      }
    }

    class SyntheticMediaStream {
      constructor(facingMode = "environment") {
        this.track = new SyntheticVideoTrack(facingMode);
        state.streams.push(this);
      }

      getTracks() {
        return [this.track];
      }

      getVideoTracks() {
        return [this.track];
      }
    }

    Object.defineProperty(window, "MediaStream", {
      configurable: true,
      value: SyntheticMediaStream,
    });

    const mediaState = new WeakMap();
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: {
        configurable: true,
        get() {
          return mediaState.get(this)?.paused === false ? performance.now() / 1000 : 0;
        },
      },
      ended: { configurable: true, get: () => false },
      paused: {
        configurable: true,
        get() {
          return mediaState.get(this)?.paused ?? true;
        },
      },
      readyState: { configurable: true, get: () => 4 },
      srcObject: {
        configurable: true,
        get() {
          return mediaState.get(this)?.srcObject ?? null;
        },
        set(value) {
          const item = mediaState.get(this) ?? { paused: true, srcObject: null };
          item.srcObject = value;
          mediaState.set(this, item);
        },
      },
      videoHeight: { configurable: true, get: () => 480 },
      videoWidth: { configurable: true, get: () => 640 },
    });
    HTMLMediaElement.prototype.play = async function play() {
      const item = mediaState.get(this) ?? { paused: true, srcObject: null };
      item.paused = false;
      mediaState.set(this, item);
      state.playCount += 1;
      queueMicrotask(() => this.dispatchEvent(new Event("canplay")));
    };
    HTMLMediaElement.prototype.pause = function pause() {
      const item = mediaState.get(this) ?? { paused: true, srcObject: null };
      item.paused = true;
      mediaState.set(this, item);
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          { deviceId: "rear-test-camera", kind: "videoinput", label: "Rear test camera" },
          { deviceId: "front-test-camera", kind: "videoinput", label: "Front test camera" },
        ],
        async getUserMedia(constraints) {
          const facingMode = readFacingMode(constraints?.video) ?? "environment";
          state.requests.push({ facingMode });
          return new SyntheticMediaStream(facingMode);
        },
      },
    });

    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    const nativeFillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(source, ...args) {
      const isSyntheticVideo =
        source instanceof HTMLVideoElement && source.srcObject instanceof SyntheticMediaStream;
      if (!isSyntheticVideo) {
        return nativeDrawImage.call(this, source, ...args);
      }

      const [x, y, width, height] =
        args.length === 8
          ? [args[4], args[5], args[6], args[7]]
          : [args[0], args[1], args[2], args[3]];
      const colors = ["#e63946", "#2a9d8f", "#457b9d", "#f4a261", "#9b5de5"];
      const bandWidth = width / colors.length;

      this.save();
      colors.forEach((color, index) => {
        this.fillStyle = color;
        nativeFillRect.call(
          this,
          x + index * bandWidth,
          y,
          index === colors.length - 1 ? width - index * bandWidth : bandWidth,
          height,
        );
      });
      this.restore();
    };
  });
}

/** Fail exactly the next palette metadata insertion as if browser storage were full. */
export async function installOneShotPaletteQuotaFailure(page) {
  await page.addInitScript(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    const state = { addAttempts: 0, remainingFailures: 1 };
    Object.defineProperty(window, "__paletteQuotaFailureState", { value: state });

    IDBObjectStore.prototype.add = function addWithQuotaFailure(...args) {
      if (this.name === "palettes") {
        state.addAttempts += 1;
        if (state.remainingFailures > 0) {
          state.remainingFailures -= 1;
          throw new DOMException("Storage quota exceeded by browser test", "QuotaExceededError");
        }
      }
      return originalAdd.apply(this, args);
    };
  });
}

export async function readPaletteStoreCounts(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const transaction = database.transaction(
        ["palettes", "paletteAssets", "palettePreviews"],
        "readonly",
      );
      const count = (storeName) =>
        new Promise((resolve, reject) => {
          const countRequest = transaction.objectStore(storeName).count();
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        });
      const [palettes, paletteAssets, palettePreviews] = await Promise.all([
        count("palettes"),
        count("paletteAssets"),
        count("palettePreviews"),
      ]);
      return { palettes, paletteAssets, palettePreviews };
    } finally {
      database.close();
    }
  });
}

export async function seedPalette(
  page,
  palette,
  { photoBase64 = null, photoType = "image/png" } = {},
) {
  await page.evaluate(
    async ({ record, photoBase64Value, photoTypeValue }) => {
      // Dexie maps schema version 7 to native IndexedDB version 70. Fixture writes
      // must open the current version after app startup; requesting an older
      // version would fail with VersionError instead of seeding the test record.
      const request = indexedDB.open("PaletcamDB", 70);
      const database = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => {
          const nextDatabase = request.result;
          if (!nextDatabase.objectStoreNames.contains("palettes")) {
            const palettes = nextDatabase.createObjectStore("palettes", {
              autoIncrement: true,
              keyPath: "id",
            });
            palettes.createIndex("timestamp", "timestamp");
            palettes.createIndex("remoteCatchId", "remoteCatchId");
            palettes.createIndex("remoteOwnerAccountKey", "remoteOwnerAccountKey");
            palettes.createIndex("moderationStatus", "moderationStatus");
          }
          if (!nextDatabase.objectStoreNames.contains("paletteAssets")) {
            nextDatabase.createObjectStore("paletteAssets", { keyPath: "paletteId" });
          }
          if (!nextDatabase.objectStoreNames.contains("palettePreviews")) {
            const previews = nextDatabase.createObjectStore("palettePreviews", {
              keyPath: ["paletteId", "variant"],
            });
            previews.createIndex("paletteId", "paletteId");
          }
          if (!nextDatabase.objectStoreNames.contains("paletteStorageMetadata")) {
            nextDatabase.createObjectStore("paletteStorageMetadata", { keyPath: "key" });
          }
          if (!nextDatabase.objectStoreNames.contains("communityDeleteOutbox")) {
            const outbox = nextDatabase.createObjectStore("communityDeleteOutbox", {
              keyPath: "key",
            });
            outbox.createIndex("accountKey", "accountKey");
            outbox.createIndex("[accountKey+nextAttemptAt]", ["accountKey", "nextAttemptAt"]);
            outbox.createIndex("leaseExpiresAt", "leaseExpiresAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      let photoBlob = null;
      if (photoBase64Value) {
        // Use a Response-backed Blob, matching the browser object returned by a
        // camera/export pipeline without relying on a data: fetch (blocked by CSP).
        const bytes = Uint8Array.from(atob(photoBase64Value), (character) =>
          character.charCodeAt(0),
        );
        photoBlob = await new Response(bytes, {
          headers: { "Content-Type": photoTypeValue },
        }).blob();
      }

      await new Promise((resolve, reject) => {
        const stores = photoBase64Value ? ["palettes", "paletteAssets"] : ["palettes"];
        const transaction = database.transaction(stores, "readwrite");
        transaction.objectStore("palettes").put(record);
        if (photoBlob) {
          transaction.objectStore("paletteAssets").put({
            paletteId: record.id,
            photoBlob,
          });
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });

      database.close();
    },
    { record: palette, photoBase64Value: photoBase64, photoTypeValue: photoType },
  );
}

export async function clearPalettes(page) {
  await page.evaluate(async () => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        ["palettes", "paletteAssets", "palettePreviews"],
        "readwrite",
      );
      transaction.objectStore("palettes").clear();
      transaction.objectStore("paletteAssets").clear();
      transaction.objectStore("palettePreviews").clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    database.close();
  });
}

export async function readPalette(page, paletteId) {
  return page.evaluate(async (id) => {
    const request = indexedDB.open("PaletcamDB");
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const palette = await new Promise((resolve, reject) => {
      const transaction = database.transaction("palettes", "readonly");
      const getRequest = transaction.objectStore("palettes").get(id);
      getRequest.onsuccess = () => resolve(getRequest.result ?? null);
      getRequest.onerror = () => reject(getRequest.error);
    });
    database.close();
    return palette;
  }, paletteId);
}
