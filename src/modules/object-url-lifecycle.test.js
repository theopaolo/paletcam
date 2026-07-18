import { describe, expect, mock, test } from "bun:test";

import { createObjectUrlLifecycle } from "./object-url-lifecycle.js";

describe("object URL lifecycle", () => {
  test("cancels timers and revokes every live URL exactly once on dispose", () => {
    const createObjectURL = mock((blob) => `blob:${blob.size}`);
    const revokeObjectURL = mock(() => {});
    const setTimeoutFn = mock((_callback, _delay) => 71);
    const clearTimeoutFn = mock(() => {});
    const lifecycle = createObjectUrlLifecycle({
      clearTimeoutFn,
      createObjectURL,
      revokeObjectURL,
      setTimeoutFn,
    });

    expect(lifecycle.create(new Blob(["one"]))).toBe("blob:3");
    expect(lifecycle.dispose()).toBe(true);
    expect(lifecycle.dispose()).toBe(false);
    expect(clearTimeoutFn).toHaveBeenCalledWith(71);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:3");
  });

  test("natural expiry removes ownership so later disposal cannot double-revoke", () => {
    let expire = () => {};
    const revokeObjectURL = mock(() => {});
    const clearTimeoutFn = mock(() => {});
    const lifecycle = createObjectUrlLifecycle({
      clearTimeoutFn,
      createObjectURL: () => "blob:palette",
      revokeObjectURL,
      setTimeoutFn: (callback) => {
        expire = callback;
        return 72;
      },
    });

    lifecycle.create(new Blob(["photo"]));
    expire();
    lifecycle.dispose();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).not.toHaveBeenCalled();
  });
});
