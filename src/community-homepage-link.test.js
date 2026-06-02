import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  initCommunityHomepageLink,
  openCommunityWithAutoLogin,
  resolveCommunityHomepageUrl,
} from "./community-homepage-link.js";

const FALLBACK = "https://colorcatchers.co/";
const MAGIC = "https://colorcatchers.co/auth/magic/42?expires=1&signature=abc";

function createFakeLink({ href = FALLBACK } = {}) {
  let handler = null;
  return {
    href,
    addEventListener: (type, fn) => {
      if (type === "click") {
        handler = fn;
      }
    },
    click() {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      handler?.(event);
      return event;
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
  let openWindow;
  let navigateCurrent;
  let pendingWindow;

  beforeEach(() => {
    pendingWindow = { location: { href: "about:blank" } };
    openWindow = mock(() => pendingWindow);
    navigateCurrent = mock(() => {});
  });

  test("keeps the default navigation for anonymous users", () => {
    const link = createFakeLink();

    initCommunityHomepageLink({
      link,
      getToken: () => "",
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
      openWindow,
      navigateCurrent,
    });

    const event = link.click();

    expect(event.defaultPrevented).toBe(false);
    expect(openWindow).not.toHaveBeenCalled();
  });

  test("opens the magic link in the pending window for authenticated users", async () => {
    const link = createFakeLink();

    initCommunityHomepageLink({
      link,
      getToken: () => "tok",
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
      openWindow,
      navigateCurrent,
    });

    const event = link.click();
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith("about:blank");
    expect(pendingWindow.location.href).toBe(MAGIC);
    expect(navigateCurrent).not.toHaveBeenCalled();
  });

  test("navigates the current window when the popup is blocked", async () => {
    const link = createFakeLink();

    initCommunityHomepageLink({
      link,
      getToken: () => "tok",
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
      openWindow: mock(() => null),
      navigateCurrent,
    });

    link.click();
    await flush();

    expect(navigateCurrent).toHaveBeenCalledWith(MAGIC);
  });
});

describe("openCommunityWithAutoLogin", () => {
  let openWindow;
  let navigateCurrent;
  let pendingWindow;

  beforeEach(() => {
    pendingWindow = { location: { href: "about:blank" } };
    openWindow = mock(() => pendingWindow);
    navigateCurrent = mock(() => {});
  });

  test("auto-logs in and lands the pending tab on the requested path", async () => {
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    openCommunityWithAutoLogin({
      path: "/my/catches",
      getToken: () => "tok",
      requestMagicLink,
      openWindow,
      navigateCurrent,
    });
    await flush();

    expect(openWindow).toHaveBeenCalledWith("about:blank");
    expect(requestMagicLink).toHaveBeenCalledWith({ token: "tok", redirect: "/my/catches" });
    expect(pendingWindow.location.href).toBe(MAGIC);
    expect(navigateCurrent).not.toHaveBeenCalled();
  });

  test("opens the plain url for anonymous users without requesting a magic link", () => {
    const requestMagicLink = mock(async () => ({ magic_link: MAGIC }));

    openCommunityWithAutoLogin({
      path: "/my/catches",
      getToken: () => "",
      requestMagicLink,
      openWindow,
      navigateCurrent,
    });

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledTimes(1);
    const openedUrl = openWindow.mock.calls[0][0];
    expect(openedUrl).toContain("/my/catches");
    expect(openedUrl).not.toBe("about:blank");
    expect(navigateCurrent).not.toHaveBeenCalled();
  });

  test("navigates the current window when the popup is blocked", async () => {
    openCommunityWithAutoLogin({
      path: "/my/catches",
      getToken: () => "tok",
      requestMagicLink: mock(async () => ({ magic_link: MAGIC })),
      openWindow: mock(() => null),
      navigateCurrent,
    });
    await flush();

    expect(navigateCurrent).toHaveBeenCalledWith(MAGIC);
  });
});
