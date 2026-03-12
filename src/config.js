export const LOCAL_API_BASE_URL = "/api/v1";
export const LIVE_API_BASE_URL = "https://colorcatchers.co/api/v1";

export function isLocalDevHost() {
  const hostname = String(globalThis.location?.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function getApiBaseUrl() {
  return isLocalDevHost() ? LOCAL_API_BASE_URL : LIVE_API_BASE_URL;
}
