import { describe, expect, mock, test } from "bun:test";
import { createCommunityFeedController } from "./community-feed-controller.js";

const item = (id) => ({
  id,
  userName: "nuagelait",
  caughtAt: "2026-02-20T12:44:14.000Z",
  colors: ["#ffc800", "#000000", "#112233"],
  squareUrl: `https://community.test/catch/square/${id}`,
  polaroidUrl: `https://community.test/catch/polaroid/${id}`,
  url: `https://community.test/c/${id}`,
});

const page = (ids, nextCursor = null) => ({ items: ids.map(item), nextCursor });

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createHarness(fetchPage, options = {}) {
  const states = [];
  const controller = createCommunityFeedController({
    fetchPage,
    onChange: (state) => states.push(state),
    ...options,
  });
  return { controller, states };
}

describe("community feed controller", () => {
  test("loads the first page once and exposes the cursor", async () => {
    const fetchPage = mock(async () => page(["a", "b"], "b"));
    const { controller, states } = createHarness(fetchPage, { pageSize: 2 });

    await controller.ensureLoaded();
    await controller.ensureLoaded();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toMatchObject({ after: null, limit: 2 });
    expect(states[0].status).toBe("loading");
    expect(controller.getState()).toMatchObject({
      status: "ready",
      hasMore: true,
      items: [{ id: "a" }, { id: "b" }],
    });
  });

  test("appends older pages with the cursor and stops on the last one", async () => {
    const fetchPage = mock(async ({ after }) =>
      after === null ? page(["a", "b"], "b") : page(["c"], null),
    );
    const { controller } = createHarness(fetchPage);

    await controller.ensureLoaded();
    await controller.loadMore();
    await controller.loadMore();

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0].after).toBe("b");
    expect(controller.getState().items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(controller.getState().hasMore).toBe(false);
  });

  test("ignores duplicate items across pages", async () => {
    const fetchPage = mock(async ({ after }) =>
      after === null ? page(["a", "b"], "b") : page(["b", "c"], null),
    );
    const { controller } = createHarness(fetchPage);

    await controller.ensureLoaded();
    await controller.loadMore();

    expect(controller.getState().items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  test("does not start a second older-page request while one is in flight", async () => {
    const deferred = createDeferred();
    const fetchPage = mock(async ({ after }) =>
      after === null ? page(["a"], "a") : deferred.promise,
    );
    const { controller } = createHarness(fetchPage);
    await controller.ensureLoaded();

    const first = controller.loadMore();
    await controller.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(controller.getState().isLoadingMore).toBe(true);

    deferred.resolve(page(["b"], null));
    await first;
    expect(controller.getState().isLoadingMore).toBe(false);
  });

  test("reports a first-page failure and retries from ensureLoaded", async () => {
    let shouldFail = true;
    const fetchPage = mock(async () => {
      if (shouldFail) throw new Error("offline");
      return page(["a"]);
    });
    const { controller } = createHarness(fetchPage);

    await controller.ensureLoaded();
    expect(controller.getState()).toMatchObject({ status: "error", items: [] });
    expect(controller.getState().error).toBeInstanceOf(Error);

    shouldFail = false;
    await controller.ensureLoaded();
    expect(controller.getState()).toMatchObject({ status: "ready", items: [{ id: "a" }] });
  });

  test("keeps the feed and flags a failed older page so it can be retried", async () => {
    let shouldFail = true;
    const fetchPage = mock(async ({ after }) => {
      if (after === null) return page(["a"], "a");
      if (shouldFail) throw new Error("offline");
      return page(["b"]);
    });
    const { controller } = createHarness(fetchPage);
    await controller.ensureLoaded();

    await controller.loadMore();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      loadMoreFailed: true,
      hasMore: true,
      items: [{ id: "a" }],
    });

    shouldFail = false;
    await controller.loadMore();
    expect(controller.getState()).toMatchObject({ loadMoreFailed: false, hasMore: false });
    expect(controller.getState().items).toHaveLength(2);
  });

  test("refreshes a stale feed in place and keeps it if the refresh fails", async () => {
    let clock = 0;
    let shouldFail = false;
    const fetchPage = mock(async () => {
      if (shouldFail) throw new Error("offline");
      return page([`id-${clock}`]);
    });
    const { controller } = createHarness(fetchPage, { now: () => clock, staleAfterMs: 1000 });

    await controller.ensureLoaded();
    clock = 500;
    await controller.ensureLoaded();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    clock = 2000;
    await controller.ensureLoaded();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(controller.getState().items[0].id).toBe("id-2000");

    clock = 4000;
    shouldFail = true;
    await controller.ensureLoaded();
    expect(controller.getState()).toMatchObject({ status: "ready", items: [{ id: "id-2000" }] });
  });

  test("bumps the version on each first-page load so views can reset", async () => {
    const fetchPage = mock(async () => page(["a"]));
    const { controller } = createHarness(fetchPage);

    await controller.ensureLoaded();
    const firstVersion = controller.getState().version;
    await controller.refresh();

    expect(controller.getState().version).toBe(firstVersion + 1);
  });

  test("drops a late response after destroy", async () => {
    const deferred = createDeferred();
    const { controller, states } = createHarness(() => deferred.promise);

    const loading = controller.ensureLoaded();
    controller.destroy();
    deferred.resolve(page(["a"]));
    await loading;

    expect(states.at(-1).status).toBe("loading");
    expect(controller.getState().items).toEqual([]);
  });

  test("aborts the in-flight cold load when the panel closes, then loads again on reopen", async () => {
    const signals = [];
    const fetchPage = mock(({ signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { controller } = createHarness(fetchPage);

    void controller.ensureLoaded();
    controller.cancelPending();

    expect(signals[0].aborted).toBe(true);
    expect(controller.getState().status).toBe("idle");

    void controller.ensureLoaded();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
