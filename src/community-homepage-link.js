import * as communityApi from "./community-api.js";
import { getCommunityAccessToken } from "./community-session.js";
import { COMMUNITY_BASE_URL } from "./config.js";
import { clientLog } from "./modules/client-log.js";

/**
 * Resolve the destination URL for the "Catchers Community" header link.
 * Logged-in users get an auto-login magic link; anonymous users (and any
 * failure) fall back to the plain community homepage.
 *
 * @param {object} options
 * @param {string} options.token
 * @param {(args: { token: string }) => Promise<{ magic_link?: string }>} options.requestMagicLink
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
 * @param {(args: { token: string }) => Promise<{ magic_link?: string }>} [options.requestMagicLink]
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
    openWindow = (url) => {
      // Note: do not pass "noopener" here — it makes window.open() return null,
      // which would orphan the pending tab on "about:blank". We keep the handle
      // so we can redirect it once the magic link resolves, and sever the
      // back-reference manually to retain anti-tabnabbing protection.
      const pendingWindow = window.open(url, "_blank");
      if (pendingWindow) {
        pendingWindow.opener = null;
      }
      return pendingWindow;
    },
    navigateCurrent = (url) => {
      window.location.href = url;
    },
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
      if (pendingWindow) {
        try {
          pendingWindow.location.href = url;
        } catch (_error) {
          pendingWindow.location = url;
        }
        return;
      }

      navigateCurrent(url);
    });
  });
}
