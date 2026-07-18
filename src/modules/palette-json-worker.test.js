import { afterEach, describe, expect, mock, test } from "bun:test";

const errorReportingUrl = new URL("./error-reporting.js", import.meta.url).href;
const moduleUrl = new URL("./palette-json-worker.js", import.meta.url).href;
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

  postMessage(message) {
    this.messages.push(message);
  }

  emit(type, payload) {
    this.listeners.get(type)?.(type === "message" ? { data: payload } : payload);
  }
}

async function createController() {
  const reportAppError = mock(() => {});
  mock.module(errorReportingUrl, () => ({ reportAppError }));
  globalThis.Worker = FakeWorker;
  const module = await import(`${moduleUrl}?test=${Math.random()}`);
  return { controller: module.createPaletteJsonWorkerController(), reportAppError };
}

afterEach(() => {
  globalThis.Worker = originalWorker;
  FakeWorker.instances = [];
  mock.restore();
});

describe("palette JSON worker controller", () => {
  test("routes concurrent results by request id and ignores stale results", async () => {
    const { controller } = await createController();
    const firstPromise = controller.exportPalettes([{ id: 1 }]);
    const secondPromise = controller.importPalettes("{}");
    const worker = FakeWorker.instances[0];
    const [first, second] = worker.messages;

    worker.emit("message", {
      type: "palette-json-export-result",
      requestId: 999,
      json: "stale",
    });
    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: second.requestId,
      palettes: [2],
    });
    worker.emit("message", {
      type: "palette-json-export-result",
      requestId: first.requestId,
      json: "first",
    });

    expect(await secondPromise).toEqual(expect.objectContaining({ palettes: [2] }));
    expect(await firstPromise).toEqual(expect.objectContaining({ json: "first" }));
  });

  test("posts Blob imports without materializing a main-thread JSON string", async () => {
    const { controller } = await createController();
    const importBlob = new Blob(["{}"], { type: "application/json" });
    const result = controller.importPalettes(importBlob);
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];

    expect(request.importSource).toBe(importBlob);
    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: request.requestId,
      palettes: [],
    });
    expect(await result).toEqual(expect.objectContaining({ palettes: [] }));
  });

  test("acknowledges streamed import batches only after the consumer applies backpressure", async () => {
    const { controller } = await createController();
    let releaseBatch;
    const onBatch = mock(
      () =>
        new Promise((resolve) => {
          releaseBatch = resolve;
        }),
    );
    const result = controller.importPalettes(new Blob(["{}"]), {
      collect: false,
      onBatch,
    });
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];
    const palettes = [{ timestamp: "2026-04-30T10:00:00.000Z" }];
    const progress = {
      completed: 1,
      loadedBytes: 100,
      phase: "parsing",
      totalBytes: 200,
    };

    worker.emit("message", {
      type: "palette-json-import-batch",
      requestId: request.requestId,
      batchId: 1,
      palettes,
      progress,
    });

    await Promise.resolve();
    expect(onBatch).toHaveBeenCalledWith(palettes, progress);
    expect(worker.messages).toHaveLength(1);
    releaseBatch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.messages.at(-1)).toEqual({
      type: "palette-json-import-batch-ack",
      requestId: request.requestId,
      batchId: 1,
      accepted: true,
    });

    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: request.requestId,
      completed: 1,
    });
    expect(await result).toEqual({
      type: "palette-json-import-result",
      requestId: request.requestId,
      completed: 1,
      palettes: [],
    });
  });

  test("collects streamed batches for compatible callers and rejects broken batch order", async () => {
    const { controller } = await createController();
    const collectedResult = controller.importPalettes(new Blob(["{}"]));
    const malformedResult = controller.importPalettes(new Blob(["{}"]));
    const worker = FakeWorker.instances[0];
    const [collectedRequest, malformedRequest] = worker.messages;
    const progress = {
      completed: 1,
      loadedBytes: 2,
      phase: "parsing",
      totalBytes: 2,
    };

    worker.emit("message", {
      type: "palette-json-import-batch",
      requestId: collectedRequest.requestId,
      batchId: 1,
      palettes: [{ id: 1 }],
      progress,
    });
    await Promise.resolve();
    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: collectedRequest.requestId,
      completed: 1,
    });
    expect(await collectedResult).toEqual(expect.objectContaining({ palettes: [{ id: 1 }] }));

    worker.emit("message", {
      type: "palette-json-import-batch",
      requestId: malformedRequest.requestId,
      batchId: 2,
      palettes: [{ id: 2 }],
      progress,
    });
    await expect(malformedResult).rejects.toThrow("Unexpected palette JSON worker response.");
    expect(worker.messages.at(-1)).toEqual(
      expect.objectContaining({
        type: "palette-json-import-batch-ack",
        requestId: malformedRequest.requestId,
        accepted: false,
      }),
    );
  });

  test("rejects a streamed import and negatively acknowledges a synchronous batch failure", async () => {
    const { controller } = await createController();
    const result = controller.importPalettes(new Blob(["{}"]), {
      onBatch() {
        throw new Error("staging failed");
      },
    });
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];

    worker.emit("message", {
      type: "palette-json-import-batch",
      requestId: request.requestId,
      batchId: 1,
      palettes: [{ id: 1 }],
      progress: {
        completed: 1,
        loadedBytes: 2,
        phase: "parsing",
        totalBytes: 2,
      },
    });

    await expect(result).rejects.toThrow("staging failed");
    expect(worker.messages.at(-1)).toEqual({
      type: "palette-json-import-batch-ack",
      requestId: request.requestId,
      batchId: 1,
      accepted: false,
      message: "staging failed",
    });
  });

  test("resolves an empty streamed backup with the compatible palettes array", async () => {
    const { controller } = await createController();
    const result = controller.importPalettes(new Blob(["{}"]));
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];

    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: request.requestId,
      completed: 0,
    });

    expect(await result).toEqual(expect.objectContaining({ completed: 0, palettes: [] }));
  });

  test("forwards progress while pending and rejects unexpected result types", async () => {
    const { controller } = await createController();
    const onProgress = mock(() => {});
    const result = controller.exportPalettes([], { onProgress });
    const worker = FakeWorker.instances[0];
    const requestId = worker.messages[0].requestId;

    worker.emit("message", {
      type: "palette-json-progress",
      requestId,
      completed: 1,
      phase: "serializing",
      total: 2,
    });
    worker.emit("message", { type: "wrong-result", requestId });

    expect(onProgress).toHaveBeenCalledWith({ completed: 1, phase: "serializing", total: 2 });
    expect(result).rejects.toThrow("Unexpected palette JSON worker response.");
  });

  test("preserves stable worker error codes for caller-specific recovery UI", async () => {
    const { controller } = await createController();
    const result = controller.exportPalettes([]);
    const worker = FakeWorker.instances[0];
    const requestId = worker.messages[0].requestId;

    worker.emit("message", {
      type: "palette-json-error",
      requestId,
      code: "PALETTE_BACKUP_SIZE_LIMIT",
      message: "Palette backup is too large to export and restore safely.",
    });

    await expect(result).rejects.toMatchObject({
      code: "PALETTE_BACKUP_SIZE_LIMIT",
      message: "Palette backup is too large to export and restore safely.",
    });
  });

  test("rejects malformed progress and result payloads without resolving application work", async () => {
    const { controller } = await createController();
    const malformedProgress = controller.exportPalettes([]);
    const malformedResult = controller.importPalettes("{}");
    const worker = FakeWorker.instances[0];
    const [progressRequest, resultRequest] = worker.messages;

    worker.emit("message", {
      type: "palette-json-progress",
      requestId: progressRequest.requestId,
      completed: 3,
      phase: "serializing",
      total: 2,
    });
    worker.emit("message", {
      type: "palette-json-import-result",
      requestId: resultRequest.requestId,
      palettes: "not-an-array",
    });

    expect(malformedProgress).rejects.toThrow("Unexpected palette JSON worker response.");
    expect(malformedResult).rejects.toThrow("Unexpected palette JSON worker response.");
  });

  test("worker failure disables fallback path and rejects every pending request", async () => {
    const { controller, reportAppError } = await createController();
    const first = controller.exportPalettes([]);
    const second = controller.importPalettes("{}");
    const worker = FakeWorker.instances[0];

    worker.emit("error", { message: "worker crashed" });

    expect(first).rejects.toThrow("worker crashed");
    expect(second).rejects.toThrow("worker crashed");
    expect(controller.isEnabled()).toBe(false);
    expect(controller.exportPalettes([])).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(reportAppError).toHaveBeenCalledTimes(1);
  });

  test("destroy rejects pending work, terminates once, and prevents recreation", async () => {
    const { controller, reportAppError } = await createController();
    const pending = controller.exportPalettes([]);
    const worker = FakeWorker.instances[0];

    controller.destroy();
    controller.destroy();

    expect(pending).rejects.toThrow("Palette JSON worker controller destroyed.");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(controller.isEnabled()).toBe(false);
    expect(controller.importPalettes("{}")).toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(reportAppError).not.toHaveBeenCalled();
  });
});
