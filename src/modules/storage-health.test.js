import { describe, expect, mock, test } from "bun:test";

import { inspectStorageHealth } from "./storage-health.js";

describe("storage health", () => {
  test("requests persistence and reports normalized usage", async () => {
    const persist = mock(async () => true);
    const result = await inspectStorageHealth({
      persisted: mock(async () => false),
      persist,
      estimate: mock(async () => ({ usage: 250.4, quota: 1000.2 })),
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      supported: true,
      persisted: true,
      persistenceRequested: true,
      usageBytes: 250,
      quotaBytes: 1000,
      usageRatio: 0.25,
    });
  });

  test("does not request persistence when storage is already durable", async () => {
    const persist = mock(async () => true);
    const result = await inspectStorageHealth({
      persisted: mock(async () => true),
      persist,
      estimate: mock(async () => ({ usage: 1, quota: 10 })),
    });

    expect(persist).not.toHaveBeenCalled();
    expect(result.persisted).toBe(true);
  });

  test("degrades safely when browser APIs reject or are unavailable", async () => {
    const rejectingStorage = {
      persisted: mock(async () => {
        throw new Error("restricted");
      }),
      estimate: mock(async () => {
        throw new Error("restricted");
      }),
    };

    expect(await inspectStorageHealth(rejectingStorage)).toEqual({
      supported: true,
      persisted: null,
      persistenceRequested: false,
      usageBytes: null,
      quotaBytes: null,
      usageRatio: null,
    });
    expect(await inspectStorageHealth(null)).toEqual({
      supported: false,
      persisted: null,
      persistenceRequested: false,
      usageBytes: null,
      quotaBytes: null,
      usageRatio: null,
    });
  });
});
