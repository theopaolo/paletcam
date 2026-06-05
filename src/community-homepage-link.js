import * as communityApi from "./community-api.js";
import { getCommunityAccessToken } from "./community-session.js";
import { buildCommunityUrl, COMMUNITY_BASE_URL } from "./config.js";
import { clientLog } from "./modules/client-log.js";

/**
 * Open a URL in the user's real (system default) browser.
 *
 * In a standalone PWA, `window.open(url, "_blank")` is captured by an in-app
 * browser view. A user-gesture anchor click with target="_blank" instead hands
 * the URL off to the system's default browser (reliable on Android PWAs).
 *
 * The URL must be known synchronously inside the originating user gesture:
 * opening it after an awaited fetch loses the gesture and falls back to the
 * in-app view (and may be popup-blocked). Callers therefore pre-resolve the URL
 * before the click rather than resolving it inside the handler.
 *
 * @param {string} url
 */
function defaultOpenExternal(url) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Resolve the destination URL for a community link. Logged-in users get an
 * auto-login magic link; anonymous users (and any failure) fall back to the
 * plain community URL.
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
 * Wire the header "Catchers Community" link so it opens in the user's real
 * browser (not the in-app PWA view). The anchor opens natively via
 * target="_blank"; JS only refreshes its href to an auto-login magic link.
 *
 * The magic link is pre-fetched on the first sign of interaction (hover /
 * focus / touch start) so it is usually ready by the time the click fires. If
 * the fetch has not resolved yet, the native click still opens the plain
 * community URL in the real browser (without auto-login) rather than blocking.
 *
 * @param {object} [options]
 * @param {HTMLAnchorElement | null} [options.link]
 * @param {() => string} [options.getToken]
 * @param {(args: { token: string, redirect?: string }) => Promise<{ magic_link?: string }>} [options.requestMagicLink]
 */
export function initCommunityHomepageLink(options = {}) {
  const {
    link = /** @type {HTMLAnchorElement | null} */ (
      document.getElementById("communityHomepageLink")
    ),
    getToken = getCommunityAccessToken,
    requestMagicLink = (args) => communityApi.requestCommunityMagicLink(args),
  } = options;

  if (!link) {
    return;
  }

  link.target = "_blank";
  link.rel = "noopener noreferrer";

  let pending = false;
  const prefetchMagicLink = () => {
    const token = getToken();
    if (!token || pending) {
      return;
    }

    pending = true;
    const fallbackUrl = link.href || COMMUNITY_BASE_URL;
    resolveCommunityHomepageUrl({ token, requestMagicLink, fallbackUrl })
      .then((url) => {
        link.href = url;
      })
      .finally(() => {
        pending = false;
      });
  };

  link.addEventListener("pointerenter", prefetchMagicLink);
  link.addEventListener("pointerdown", prefetchMagicLink);
  link.addEventListener("focus", prefetchMagicLink);
}

/**
 * Build a click handler that opens a community path in the user's real browser,
 * auto-logging them in via a magic link when a session token is available.
 *
 * Call this when the action is *offered* (e.g. when a toast is shown) rather
 * than inside the click handler: it kicks off the magic-link fetch immediately
 * so the resolved URL is ready by the time the user taps. The returned handler
 * opens whatever URL has resolved so far — the magic link if ready, otherwise
 * the plain community URL — synchronously, keeping the user gesture intact.
 *
 * @param {object} [options]
 * @param {string} [options.path] Relative community path to land on (default "/").
 * @param {() => string} [options.getToken]
 * @param {(args: { token: string, redirect?: string }) => Promise<{ magic_link?: string }>} [options.requestMagicLink]
 * @param {(url: string) => void} [options.openExternal]
 * @returns {() => void}
 */
export function createCommunityAutoLoginOpener({
  path = "/",
  getToken = getCommunityAccessToken,
  requestMagicLink = (args) => communityApi.requestCommunityMagicLink(args),
  openExternal = defaultOpenExternal,
} = {}) {
  const fallbackUrl = buildCommunityUrl(path);
  let targetUrl = fallbackUrl;

  const token = getToken();
  if (token) {
    resolveCommunityHomepageUrl({
      token,
      requestMagicLink: (args) => requestMagicLink({ ...args, redirect: path }),
      fallbackUrl,
    }).then((url) => {
      targetUrl = url;
    });
  }

  return () => {
    openExternal(targetUrl);
  };
}
