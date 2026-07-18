import { describe, expect, test } from "bun:test";
import { runSessionBoundAction } from "./session-bound-action.js";

describe("session-bound async action", () => {
  test("does not apply stale completion or busy state to a replacement session", async () => {
    let resolveAction;
    let currentSession = { id: "old" };
    const originatingSession = currentSession;
    const effects = [];
    const actionPromise = runSessionBoundAction({
      isCurrent: () => currentSession === originatingSession,
      run: () => new Promise((resolve) => (resolveAction = resolve)),
      onCurrentSuccess: () => effects.push("success"),
      onCurrentFinally: () => effects.push("idle"),
    });

    currentSession = { id: "new" };
    resolveAction();

    expect(await actionPromise).toBe(false);
    expect(effects).toEqual([]);
  });

  test("applies completion and clears busy state for the originating session", async () => {
    const effects = [];
    expect(
      await runSessionBoundAction({
        isCurrent: () => true,
        run: async () => {},
        onCurrentSuccess: () => effects.push("success"),
        onCurrentFinally: () => effects.push("idle"),
      }),
    ).toBe(true);
    expect(effects).toEqual(["success", "idle"]);
  });
});
