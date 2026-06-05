import { describe, expect, mock, test } from "bun:test";
import {
  createCommunityAutoLoginOpener,
  initCommunityHomepageLink,
  resolveCommunityHomepageUrl,
} from "./community-homepage-link.js";

const FALLBACK = "https://colorcatchers.co/";
const MAGIC = "https://colorcatchers.co/auth/magic/42?expires=1&signature=abc";

function createFakeLink({ href = FALLBACK } = {}) {
  const handlers = {};
  return {
    href,
    target: "",
    rel: "",
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    fire(type) {
      handlers[type]?.();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("resolveCommunityHomepageUrl", () => {
  test("returns the fallback url when there is no token", async () => {
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    const url = await resolveCommunityHomepageUrl({
      token: "",
      requestMagicLink,
      fallbackUrl: FALLBACK,
    });

    expect(url).toBe(FALLBACK);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  test("returns the magic link for an authenticated user", async () => {
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

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
});

describe("initCommunityHomepageLink", () => {
  test("opens natively in a new tab via target=_blank", () => {
    const link = createFakeLink();

    initCommunityHomepageLink({
      link,
      getToken: () => "tok",
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
    });

    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  test("refreshes the href to a magic link when an authenticated user interacts", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    initCommunityHomepageLink({ link, getToken: () => "tok", requestMagicLink });

    link.fire("pointerenter");
    await flush();

    expect(requestMagicLink).toHaveBeenCalledWith({ token: "tok", redirect: undefined });
    expect(link.href).toBe(MAGIC);
  });

  test("leaves the plain href untouched for anonymous users", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    initCommunityHomepageLink({ link, getToken: () => "", requestMagicLink });

    link.fire("pointerdown");
    await flush();

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(link.href).toBe(FALLBACK);
  });

  test("does not fire overlapping fetches while one is pending", async () => {
    const link = createFakeLink();
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    initCommunityHomepageLink({ link, getToken: () => "tok", requestMagicLink });

    link.fire("pointerenter");
    link.fire("pointerdown");
    link.fire("focus");
    await flush();

    expect(requestMagicLink).toHaveBeenCalledTimes(1);
  });
});

describe("createCommunityAutoLoginOpener", () => {
  test("opens the magic link once it has resolved before the click", async () => {
    const openExternal = mock(() => {});
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

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
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

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
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
      openExternal,
    });

    // Click immediately, before the pending fetch resolves.
    open();

    expect(openExternal).toHaveBeenCalledTimes(1);
    const openedUrl = openExternal.mock.calls[0][0];
    expect(openedUrl).toContain("/my/catches");
    expect(openedUrl).not.toBe(MAGIC);
  });
});
