import { describe, expect, mock, test } from "bun:test";
import {
  normalizeOperationalMetric,
  recordOperationalMetric,
  recordSessionStarted,
} from "./operational-metrics.js";

describe("operational metrics", () => {
  test("rejects unknown events and strips fields outside the event schema", () => {
    expect(normalizeOperationalMetric("unknown", {})).toBeNull();
    expect(
      normalizeOperationalMetric("camera-start", {
        durationMs: 14.6,
        email: "private@example.com",
        operation: "start",
        outcome: "success",
        token: "secret",
      }),
    ).toEqual({
      message: "metric:camera-start",
      context: { durationMs: 15, operation: "start", outcome: "success" },
    });
  });

  test("bounds timing and categorical values", () => {
    expect(
      normalizeOperationalMetric("capture-save", {
        durationMs: 999_999,
        errorName: "x".repeat(100),
        hasPalette: true,
        outcome: "arbitrary",
      }),
    ).toEqual({
      message: "metric:capture-save",
      context: { durationMs: 300_000, errorName: "OtherError", hasPalette: true },
    });
  });

  test("keeps backup outcomes categorical and strips file or collection details", () => {
    expect(
      normalizeOperationalMetric("backup-transfer", {
        category: "invalid-file",
        direction: "import",
        durationMs: 1200.6,
        filename: "private-camera-backup.json",
        paletteCount: 193,
        outcome: "failure",
        parserMessage: "private parser detail",
      }),
    ).toEqual({
      message: "metric:backup-transfer",
      context: {
        category: "invalid-file",
        direction: "import",
        durationMs: 1201,
        outcome: "failure",
      },
    });
  });

  test("supports deterministic sampling", () => {
    const log = mock(() => true);
    expect(
      recordOperationalMetric("session-started", {}, { log, random: () => 0.6, sampleRate: 0.5 }),
    ).toBe(false);
    expect(log).not.toHaveBeenCalled();

    expect(
      recordOperationalMetric("session-started", {}, { log, random: () => 0.4, sampleRate: 0.5 }),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith("metric:session-started", {});
  });

  test("records the session denominator once and tolerates restricted storage", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const log = mock(() => true);

    expect(recordSessionStarted({ storage, log, random: () => 0 })).toBe(true);
    expect(recordSessionStarted({ storage, log, random: () => 0 })).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);

    expect(
      recordSessionStarted({
        storage: {
          getItem() {
            throw new Error("blocked");
          },
        },
        log,
        random: () => 0,
      }),
    ).toBe(true);
  });
});
