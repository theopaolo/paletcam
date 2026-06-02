import * as communityApi from "./community-api.js";
import { getCommunityAccessToken } from "./community-session.js";
import { buildCommunityUrl, COMMUNITY_BASE_URL } from "./config.js";
import { clientLog } from "./modules/client-log.js";

/**
 * Open a new tab and keep a handle to it so we can redirect it once an async
 * magic link resolves. We intentionally avoid "noopener" (which makes
 * window.open return null and orphan the tab) and sever the back-reference
 * manually to retain anti-tabnabbing protection.
 *
 * @param {string} url
 * @returns {Window | null}
 */
function defaultOpenWindow(url) {
  const pendingWindow = window.open(url, "_blank");
  if (pendingWindow) {
    pendingWindow.opener = null;
  }
  return pendingWindow;
}

/** @param {string} url */
function defaultNavigateCurrent(url) {
  window.location.href = url;
}

/**
 * Redirect the placeholder tab to the resolved URL, falling back to navigating
 * the current window when the popup was blocked.
 *
 * @param {Window | null} pendingWindow
 * @param {string} url
 * @param {(url: string) => void} navigateCurrent
 */
function redirectResolvedWindow(pendingWindow, url, navigateCurrent) {
  if (pendingWindow) {
    try {
      pendingWindow.location.href = url;
    } catch (_error) {
      pendingWindow.location = url;
    }
    return;
  }

  navigateCurrent(url);
}

/**
 * Resolve the destination URL for the "Catchers Community" header link.
 * Logged-in users get an auto-login magic link; anonymous users (and any
 * failure) fall back to the plain community homepage.
 *
 * @param {object} options
 * @param {string} options.token
 * @param {(args: { token: string, redirect?: string }) => Promise<{ magic_link?: string }>} options.requestMagicLink
 * @param {string} options.fallbackUrl
 * @returns {Promise<string>}
 */
export async function resolveCommunityHomepageUrl({ token, requestMagicLink, fallbackUrl }) {
  if (!token) {
    return fallbackUrl;
  }

  try {
    const payload = await requestMagicLink({ token });
    const magicLink = typeof payload?.magic_link === "string" ? payload.magic_link.trim() : "";
    return magicLink || fallbackUrl;
  } catch (error) {
    clientLog("Failed to generate community magic link.", {
      originalError: error?.message || String(error),
    });
    return fallbackUrl;
  }
}

/**
 * Wire the header "Catchers Community" link so authenticated users are
 * auto-logged into the community website via a magic link, while anonymous
 * users keep the default homepage navigation.
 *
 * @param {object} [options]
 * @param {HTMLAnchorElement | null} [options.link]
 * @param {() => string} [options.getToken]
 * @param {(args: { token: string, redirect?: string }) => Promise<{ magic_link?: string }>} [options.requestMagicLink]
 * @param {(url: string) => (Window | null)} [options.openWindow]
 * @param {(url: string) => void} [options.navigateCurrent]
 */
export function initCommunityHomepageLink(options = {}) {
  const {
    link = /** @type {HTMLAnchorElement | null} */ (
      document.getElementById("communityHomepageLink")
    ),
    getToken = getCommunityAccessToken,
    requestMagicLink = (args) => communityApi.requestCommunityMagicLink(args),
    openWindow = defaultOpenWindow,
    navigateCurrent = defaultNavigateCurrent,
  } = options;

  if (!link) {
    return;
  }

  link.addEventListener("click", (event) => {
    const token = getToken();
    if (!token) {
      return;
    }

    event.preventDefault();

    const fallbackUrl = link.href || COMMUNITY_BASE_URL;
    const pendingWindow = openWindow("about:blank");

    resolveCommunityHomepageUrl({ token, requestMagicLink, fallbackUrl }).then((url) => {
      redirectResolvedWindow(pendingWindow, url, navigateCurrent);
    });
  });
}

/**
 * Open a community URL, auto-logging the user in via a magic link when a
 * session token is available so they land already authenticated on the target
 * page. Anonymous users (and any failure) just navigate to the plain URL.
 *
 * @param {object} [options]
 * @param {string} [options.path] Relative community path to land on (default "/").
 * @param {() => string} [options.getToken]
 * @param {(args: { token: string, redirect?: string }) => Promise<{ magic_link?: string }>} [options.requestMagicLink]
 * @param {(url: string) => (Window | null)} [options.openWindow]
 * @param {(url: string) => void} [options.navigateCurrent]
 */
export function openCommunityWithAutoLogin({
  path = "/",
  getToken = getCommunityAccessToken,
  requestMagicLink = (args) => communityApi.requestCommunityMagicLink(args),
  openWindow = defaultOpenWindow,
  navigateCurrent = defaultNavigateCurrent,
} = {}) {
  const fallbackUrl = buildCommunityUrl(path);
  const token = getToken();

  if (!token) {
    if (!openWindow(fallbackUrl)) {
      navigateCurrent(fallbackUrl);
    }
    return;
  }

  const pendingWindow = openWindow("about:blank");

  resolveCommunityHomepageUrl({
    token,
    requestMagicLink: (args) => requestMagicLink({ ...args, redirect: path }),
    fallbackUrl,
  }).then((url) => {
    redirectResolvedWindow(pendingWindow, url, navigateCurrent);
  });
}
