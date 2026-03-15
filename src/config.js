export const BRAND = "colorcatchers.co";
export const COMMUNITY_BASE_URL = `https://${BRAND}`;
export const LOCAL_API_BASE_URL = "/api/v1";
export const LIVE_API_BASE_URL = `${COMMUNITY_BASE_URL}/api/v1`;

function getPlatformRef() {
  const ua = String(globalThis.navigator?.userAgent || "");
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isStandalone =
    /** @type {any} */ (globalThis.navigator)?.standalone === true ||
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true;

  if (isStandalone && isIos) return "pwa_ios";
  if (isStandalone && isAndroid) return "pwa_android";
  if (isIos) return "ios";
  return "browser";
}

export function buildCommunityUrl(path = "") {
  const url = new URL(path, COMMUNITY_BASE_URL);
  url.searchParams.set("ref", getPlatformRef());
  return url.toString();
}

export function isLocalDevHost() {
  const hostname = String(globalThis.location?.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function getApiBaseUrl() {
  return isLocalDevHost() ? LOCAL_API_BASE_URL : LIVE_API_BASE_URL;
}
