import { describe, expect, mock, test } from "bun:test";
import { runBulkPublication } from "./bulk-publication.js";

const palettes = [
  { id: 1, remoteCatchId: null },
  { id: 2, remoteCatchId: null },
  { id: 3, remoteCatchId: null },
];

describe("bulk publication", () => {
  test("aggregates success, already-done reload policy, and failures", async () => {
    const error = new Error("network");
    const results = [
      { status: "success" },
      { status: "already_done", actionConfig: { shouldReloadOnAlreadyDone: true } },
      { status: "error", error },
    ];
    const runAction = mock(async () => results.shift());

    expect(await runBulkPublication({ palettes, runAction })).toEqual({
      alreadyDoneCount: 1,
      authRequired: false,
      cancelled: false,
      failureCount: 1,
      firstFailure: error,
      sessionChanged: false,
      shouldReload: true,
      successCount: 1,
    });
    expect(runAction).toHaveBeenCalledTimes(3);
  });

  test("stops immediately after authentication becomes required", async () => {
    const error = new Error("expired");
    const runAction = mock(async (palette) =>
      palette.id === 1 ? { status: "auth_required", error } : { status: "success" },
    );

    const result = await runBulkPublication({ palettes, runAction });

    expect(result).toMatchObject({ authRequired: true, firstFailure: error, successCount: 0 });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test("observes cancellation between sequential mutations", async () => {
    let cancelled = false;
    const runAction = mock(async () => {
      cancelled = true;
      return { status: "success" };
    });

    const result = await runBulkPublication({
      palettes,
      runAction,
      isCancelled: () => cancelled,
    });

    expect(result).toMatchObject({ cancelled: true, successCount: 1 });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test("stops between items when the originating session changes", async () => {
    let sessionCurrent = true;
    const runAction = mock(async () => {
      sessionCurrent = false;
      return { status: "success" };
    });

    const result = await runBulkPublication({
      palettes,
      runAction,
      isSessionCurrent: () => sessionCurrent,
    });

    expect(result).toMatchObject({ sessionChanged: true, successCount: 1 });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test("normalizes an unexpected adapter rejection as one failure", async () => {
    const error = new Error("unexpected");
    const runAction = mock(async () => {
      throw error;
    });

    const result = await runBulkPublication({ palettes: [palettes[0]], runAction });

    expect(result).toMatchObject({ failureCount: 1, firstFailure: error });
  });
});
