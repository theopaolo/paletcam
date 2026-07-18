import { describe, expect, mock, test } from "bun:test";
import {
  createCommunityAutoLoginOpener,
  initCommunityHomepageLink,
  resolveCommunityHomepageUrl,
} from "./community-homepage-link.js";

const FALLBACK = "https://colorcatchers.co/";
const HEADER_FALLBACK = "https://colorcatchers.co/?ref=browser";
const MAGIC = "https://colorcatchers.co/auth/magic/42?expires=1&signature=abc";
const MAGIC_EXPIRY = "2099-01-01T00:00:00.000Z";
const magicPayload = () => ({ magic_link: MAGIC, expires_at: MAGIC_EXPIRY });

function createFakeLink({ href = FALLBACK } = {}) {
  const handlers = {};
  return {
    href,
    target: "",
    rel: "",
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    removeEventListener: (type, fn) => {
      if (handlers[type] === fn) delete handlers[type];
    },
    fire(type) {
      handlers[type]?.();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("resolveCommunityHomepageUrl", () => {
  test("returns the fallback url when there is no token", async () => {
    const requestMagicLink = mock(async () => magicPayload());

    const url = await resolveCommunityHomepageUrl({
      token: "",
      requestMagicLink,
      fallbackUrl: FALLBACK,
    });

    expect(url).toBe(FALLBACK);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  test("returns the magic link for an authenticated user", async () => {
    const requestMagicLink = mock(async () => magicPayload());

    const url = await resolveCommunityHomepageUrl({
      token: "tok",
      requestMagicLink,
      fallbackUrl: FALLBACK,
    });

    expect(url).toBe(MAGIC);
    expect(requestMagicLink).toHaveBeenCalledWith({ token: "tok" });
  });

  test("falls back when the api returns no magic link", async () => {
    const requestMagicLink = mock(async () => ({ magic_link: "" }));

    const url = await resolveCommunityHomepageUrl({
      token: "tok",
      requestMagicLink,
      fallbackUrl: FALLBACK,
    });

    expect(url).toBe(FALLBACK);
  });

  test("falls back when the api call rejects", async () => {
    const requestMagicLink = mock(async () => {
      throw new Error("network down");
    });

    const url = await resolveCommunityHomepageUrl({
      token: "tok",
      requestMagicLink,
      fallbackUrl: FALLBACK,
    });

    expect(url).toBe(FALLBACK);
  });

  test("rejects expired or expiry-less login capabilities", async () => {
    const now = () => Date.parse("2026-07-13T12:00:00.000Z");

    await expect(
      resolveCommunityHomepageUrl({
        token: "tok",
        requestMagicLink: mock(async () => ({
          magic_link: MAGIC,
          expires_at: "2026-07-13T11:59:00.000Z",
        })),
        fallbackUrl: FALLBACK,
        now,
      }),
    ).resolves.toBe(FALLBACK);
    await expect(
      resolveCommunityHomepageUrl({
        token: "tok",
        requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
        fallbackUrl: FALLBACK,
        now,
      }),
    ).resolves.toBe(FALLBACK);
  });
});

describe("initCommunityHomepageLink", () => {
  test("opens natively in a new tab via target=_blank", () => {
    const link = createFakeLink();

    initCommunityHomepageLink({
      link,
      getToken: () => "tok",
      requestMagicLink: mock(async () => magicPayload()),
    });

    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  test("refreshes the href to a magic link when an authenticated user interacts", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => magicPayload());

    initCommunityHomepageLink({ link, getToken: () => "tok", requestMagicLink });

    link.fire("pointerenter");
    await flush();

    expect(requestMagicLink).toHaveBeenCalledWith({
      token: "tok",
      signal: expect.any(AbortSignal),
    });
    expect(link.href).toBe(MAGIC);
  });

  test("leaves the plain href untouched for anonymous users", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => magicPayload());

    initCommunityHomepageLink({ link, getToken: () => "", requestMagicLink });

    link.fire("pointerdown");
    await flush();

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(link.href).toBe(HEADER_FALLBACK);
  });

  test("does not fire overlapping fetches while one is pending", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => magicPayload());

    initCommunityHomepageLink({ link, getToken: () => "tok", requestMagicLink });

    link.fire("pointerenter");
    link.fire("pointerdown");
    link.fire("focus");
    await flush();

    expect(requestMagicLink).toHaveBeenCalledTimes(1);
  });

  test("resets on logout and ignores a stale completion from the previous account", async () => {
    const link = createFakeLink();
    const deferred = createDeferred();
    let token = "account-a";
    let sessionListener = () => {};
    const unsubscribe = mock(() => {});
    const dispose = initCommunityHomepageLink({
      link,
      getToken: () => token,
      requestMagicLink: mock(() => deferred.promise),
      subscribeSession: (listener) => {
        sessionListener = listener;
        return unsubscribe;
      },
    });

    link.fire("pointerenter");
    token = "account-b";
    sessionListener({ token });
    deferred.resolve(magicPayload());
    await flush();

    expect(link.href).toBe(HEADER_FALLBACK);
    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("dispose aborts pending work and removes interaction listeners", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => magicPayload());
    const dispose = initCommunityHomepageLink({
      link,
      getToken: () => "tok",
      requestMagicLink,
      subscribeSession: () => () => {},
    });

    dispose();
    link.fire("pointerdown");
    await flush();

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(link.href).toBe(HEADER_FALLBACK);
  });
});

describe("createCommunityAutoLoginOpener", () => {
  test("opens the magic link once it has resolved before the click", async () => {
    const openExternal = mock(() => {});
    const requestMagicLink = mock(async () => magicPayload());

    const open = createCommunityAutoLoginOpener({
      path: "/my/catches",
      getToken: () => "tok",
      requestMagicLink,
      openExternal,
    });

    await flush();
    open();

    expect(requestMagicLink).toHaveBeenCalledWith({ token: "tok", redirect: "/my/catches" });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal.mock.calls[0][0]).toBe(MAGIC);
  });

  test("opens the plain url for anonymous users without requesting a magic link", () => {
    const openExternal = mock(() => {});
    const requestMagicLink = mock(async () => magicPayload());

    const open = createCommunityAutoLoginOpener({
      path: "/my/catches",
      getToken: () => "",
      requestMagicLink,
      openExternal,
    });

    open();

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
    const openedUrl = openExternal.mock.calls[0][0];
    expect(openedUrl).toContain("/my/catches");
  });

  test("falls back to the plain url when clicked before the magic link resolves", () => {
    const openExternal = mock(() => {});

    const open = createCommunityAutoLoginOpener({
      path: "/my/catches",
      getToken: () => "tok",
      requestMagicLink: mock(async () => magicPayload()),
      openExternal,
    });

    // Click immediately, before the pending fetch resolves.
    open();

    expect(openExternal).toHaveBeenCalledTimes(1);
    const openedUrl = openExternal.mock.calls[0][0];
    expect(openedUrl).toContain("/my/catches");
    expect(openedUrl).not.toBe(MAGIC);
  });

  test("never opens a capability minted for a replaced session", async () => {
    const openExternal = mock(() => {});
    let token = "account-a";
    const open = createCommunityAutoLoginOpener({
      path: "/my/catches",
      getToken: () => token,
      requestMagicLink: mock(async () => magicPayload()),
      openExternal,
    });

    await flush();
    token = "account-b";
    open();

    expect(openExternal.mock.calls[0][0]).toContain("/my/catches");
    expect(openExternal.mock.calls[0][0]).not.toBe(MAGIC);
  });

  test("rechecks expiry at click time", async () => {
    const openExternal = mock(() => {});
    let nowMs = Date.parse("2026-07-13T12:00:00.000Z");
    const open = createCommunityAutoLoginOpener({
      getToken: () => "tok",
      requestMagicLink: mock(async () => ({
        magic_link: MAGIC,
        expires_at: "2026-07-13T12:01:00.000Z",
      })),
      openExternal,
      now: () => nowMs,
    });

    await flush();
    nowMs = Date.parse("2026-07-13T12:02:00.000Z");
    open();

    expect(openExternal.mock.calls[0][0]).toBe(HEADER_FALLBACK);
  });
});
