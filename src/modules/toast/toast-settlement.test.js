import { describe, expect, mock, test } from "bun:test";

import { settleToastEntry } from "./toast-settlement.js";

describe("toast settlement routing", () => {
  test("action invokes only the action callback", () => {
    const onAction = mock(() => {});
    const onDismiss = mock(() => {});
    const onExpire = mock(() => {});

    expect(settleToastEntry({ onAction, onDismiss, onExpire }, "action")).toBe("action");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("timeout invokes only the expiry callback", () => {
    const onAction = mock(() => {});
    const onDismiss = mock(() => {});
    const onExpire = mock(() => {});

    expect(settleToastEntry({ onAction, onDismiss, onExpire }, "timeout")).toBe("expire");
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test.each([
    "user-dismiss",
    "swipe",
    "interrupted",
    "programmatic",
  ])("%s invokes only the dismissal callback", (reason) => {
    const onAction = mock(() => {});
    const onDismiss = mock(() => {});
    const onExpire = mock(() => {});

    expect(settleToastEntry({ onAction, onDismiss, onExpire }, reason)).toBe("dismiss");
    expect(onDismiss).toHaveBeenCalledWith(reason);
    expect(onAction).not.toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
  });

  test("a missing callback remains a no-op", () => {
    expect(settleToastEntry({}, "programmatic")).toBe("none");
  });
});
