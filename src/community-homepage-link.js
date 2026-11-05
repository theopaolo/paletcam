import * as communityApi from "./community-api.js";
import { getCommunityAccessToken } from "./community-session.js";
import { buildCommunityUrl } from "./config.js";
import { clientLog } from "./modules/client-log.js";

const MAGIC_LINK_MIN_VALIDITY_MS = 1_000;

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
 * @param {(args: { token: string, redirect?: string, signal?: AbortSignal }) => Promise<{ magic_link?: string, expires_at?: string }>} options.requestMagicLink
 * @param {string} options.fallbackUrl
 * @param {AbortSignal} [options.signal]
 * @param {() => number} [options.now]
 * @returns {Promise<{url: string, expiresAtMs: number}>}
 */
async function resolveCommunityHomepageDestination({
  token,
  requestMagicLink,
  fallbackUrl,
  signal,
  now = Date.now,
}) {
  if (!token) {
    return { url: fallbackUrl, expiresAtMs: 0 };
  }

  try {
    const payload = await requestMagicLink({ token, ...(signal ? { signal } : {}) });
    const magicLink = typeof payload?.magic_link === "string" ? payload.magic_link.trim() : "";
    const expiresAtMs = Date.parse(payload?.expires_at || "");
    if (
      !magicLink ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now() + MAGIC_LINK_MIN_VALIDITY_MS
    ) {
      return { url: fallbackUrl, expiresAtMs: 0 };
    }

    try {
      const target = new URL(magicLink);
      const fallback = new URL(fallbackUrl);
      if (target.protocol !== "https:" || target.origin !== fallback.origin) {
        return { url: fallbackUrl, expiresAtMs: 0 };
      }
    } catch {
      return { url: fallbackUrl, expiresAtMs: 0 };
    }

    return { url: magicLink, expiresAtMs };
  } catch (error) {
    if (error?.name !== "AbortError" && !signal?.aborted) {
      clientLog("Failed to generate community magic link.", {
        errorName: error?.name ?? "Error",
      });
    }
    return { url: fallbackUrl, expiresAtMs: 0 };
  }
}

/**
 * @param {Parameters<typeof resolveCommunityHomepageDestination>[0]} options
 * @returns {Promise<string>}
 */
export async function resolveCommunityHomepageUrl(options) {
  return (await resolveCommunityHomepageDestination(options)).url;
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
 * @param {(args: { token: string, redirect?: string, signal?: AbortSignal }) => Promise<{ magic_link?: string, expires_at?: string }>} [options.requestMagicLink]
 * @param {(url: string) => void} [options.openExternal]
 * @param {() => number} [options.now]
 * @returns {() => void}
 */
export function createCommunityAutoLoginOpener({
  path = "/",
  getToken = getCommunityAccessToken,
  requestMagicLink = (args) => communityApi.requestCommunityMagicLink(args),
  openExternal = defaultOpenExternal,
  now = Date.now,
} = {}) {
  const fallbackUrl = buildCommunityUrl(path);
  let targetUrl = fallbackUrl;
  let targetToken = "";
  let targetExpiresAtMs = 0;

  const token = getToken();
  if (token) {
    resolveCommunityHomepageDestination({
      token,
      requestMagicLink: (args) => requestMagicLink({ ...args, redirect: path }),
      fallbackUrl,
      now,
    }).then(({ url, expiresAtMs }) => {
      if (getToken() === token) {
        targetUrl = url;
        targetToken = url === fallbackUrl ? "" : token;
        targetExpiresAtMs = expiresAtMs;
      }
    });
  }

  return () => {
    const hasCurrentCapability =
      targetToken && getToken() === targetToken && now() < targetExpiresAtMs;
    openExternal(hasCurrentCapability ? targetUrl : fallbackUrl);
  };
}
