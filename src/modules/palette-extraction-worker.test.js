import { afterEach, describe, expect, mock, test } from "bun:test";

const moduleUrl = new URL("./palette-extraction-worker.js", import.meta.url).href;
const originalWorker = globalThis.Worker;

class FakeWorker {
  static instances = [];

  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminate = mock(() => {});
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message, transfer) {
    this.messages.push({ message, transfer });
  }

  emit(type, payload) {
    this.listeners.get(type)?.(type === "message" ? { data: payload } : payload);
  }
}

function extractionRequest(value = 1) {
  return {
    frozenColors: [],
    height: 1,
    imageData: new Uint8ClampedArray([value, value, value, 255]),
    options: {},
    swatchCount: 1,
    width: 1,
  };
}

async function createController(options = {}) {
  globalThis.Worker = FakeWorker;
  const module = await import(`${moduleUrl}?test=${Math.random()}`);
  return module.createPaletteExtractionWorkerController(options);
}

afterEach(() => {
  globalThis.Worker = originalWorker;
  FakeWorker.instances = [];
});

describe("palette extraction worker controller", () => {
  test("ignores unrelated and stale results without releasing the active job", async () => {
    const onResult = mock(() => {});
    const controller = await createController({ onResult });
    controller.requestExtraction(extractionRequest(1));
    controller.requestExtraction(extractionRequest(2));
    const worker = FakeWorker.instances[0];
    const first = worker.messages[0].message;

    worker.emit("message", {
      type: "palette-extraction-result",
      requestId: first.requestId + 99,
      generation: first.generation,
      colors: [],
    });
    expect(worker.messages).toHaveLength(1);

    controller.invalidate();
    worker.emit("message", {
      type: "palette-extraction-result",
      requestId: first.requestId,
      generation: first.generation,
      colors: [{ r: 1, g: 1, b: 1 }],
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  test("keeps a one-deep latest-wins queue", async () => {
    const onResult = mock(() => {});
    const controller = await createController({ onResult });
    controller.requestExtraction(extractionRequest(1));
    controller.requestExtraction(extractionRequest(2));
    controller.requestExtraction(extractionRequest(3));
    const worker = FakeWorker.instances[0];
    const first = worker.messages[0].message;

    worker.emit("message", {
      type: "palette-extraction-result",
      requestId: first.requestId,
      generation: first.generation,
      colors: [{ r: 1, g: 1, b: 1 }],
      origins: [{ x: 0.5, y: 0.5 }],
      frozenPresence: [],
      durationMs: 2,
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(worker.messages).toHaveLength(2);
    expect(new Uint8ClampedArray(worker.messages[1].message.buffer)[0]).toBe(3);
  });

  test("disables after a worker error and reports failure once", async () => {
    const onError = mock(() => {});
    const controller = await createController({ onError });
    controller.requestExtraction(extractionRequest());
    const worker = FakeWorker.instances[0];
    worker.emit("error", new Error("worker crashed"));
    worker.emit("error", new Error("again"));

    expect(controller.isEnabled()).toBe(false);
    expect(controller.requestExtraction(extractionRequest())).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("disables the worker instead of exposing a malformed current result", async () => {
    const onError = mock(() => {});
    const onResult = mock(() => {});
    const controller = await createController({ onError, onResult });
    controller.requestExtraction(extractionRequest());
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0].message;

    worker.emit("message", {
      type: "palette-extraction-result",
      requestId: request.requestId,
      generation: request.generation,
      colors: [{ r: 999, g: 1, b: 1 }],
      origins: [{ x: 0.5, y: 0.5 }],
      frozenPresence: [],
      durationMs: 1,
    });

    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(controller.isEnabled()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  test("rejects inconsistent pixel dimensions before transferring a buffer", async () => {
    const controller = await createController();

    expect(
      controller.requestExtraction({
        ...extractionRequest(),
        width: 2,
      }),
    ).toBe(false);
    expect(FakeWorker.instances[0].messages).toHaveLength(0);
  });

  test("destroy terminates, clears queued work, and prevents recreation", async () => {
    const controller = await createController();
    controller.requestExtraction(extractionRequest(1));
    controller.requestExtraction(extractionRequest(2));
    const worker = FakeWorker.instances[0];

    controller.destroy();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(controller.isEnabled()).toBe(false);
    expect(controller.requestExtraction(extractionRequest(3))).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
