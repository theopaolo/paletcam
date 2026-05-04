export const COMMUNITY_BASE_URL = "https://colorcatchers.co";
export const LOCAL_API_BASE_URL = `${COMMUNITY_BASE_URL}/api/v1`;
export const LIVE_API_BASE_URL = `${COMMUNITY_BASE_URL}/api/v1`;
const PREPROD_BRANCH_NAME = "preprod";
const DEPLOY_BRANCH_NAME =
  typeof __PALETCAM_DEPLOY_BRANCH__ === "string" ? __PALETCAM_DEPLOY_BRANCH__ : "";

function normalizeBranchName(branchName) {
  return String(branchName || "").trim().toLowerCase();
}

function getPlatformRef() {
  const ua = String(globalThis.navigator?.userAgent || "");
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isStandalone =
    globalThis.navigator?.standalone === true ||
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

export function isPreprodBranch(branchName) {
  const normalizedBranchName = normalizeBranchName(branchName);
  const branchSegments = normalizedBranchName.split("/").filter(Boolean);
  return branchSegments.at(-1) === PREPROD_BRANCH_NAME;
}

export function shouldShowPanelFormVersion() {
  return isPreprodBranch(DEPLOY_BRANCH_NAME);
}
