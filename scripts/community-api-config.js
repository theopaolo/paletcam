import { isProductionDeploy } from "./build-policy.js";

const ENVIRONMENT_VARIABLE = "COMMUNITY_API_PROXY_TARGET";
const PRODUCTION_COMMUNITY_API_ORIGIN = "https://colorcatchers.co";

function configurationError(message) {
  return new Error(`Invalid ${ENVIRONMENT_VARIABLE}: ${message}`);
}

/**
 * Resolve the compile-time community API base URL. Production artifacts always
 * use the public root origin; local and preprod builds may target another
 * absolute HTTP(S) endpoint for development and integration testing.
 */
export function resolveCommunityApiBaseUrl(rawValue, deployBranchName) {
  const production = isProductionDeploy(deployBranchName);
  const value = String(rawValue || "").trim();

  if (!value) {
    return production ? PRODUCTION_COMMUNITY_API_ORIGIN : "";
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw configurationError("must be an absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configurationError("must use HTTP or HTTPS.");
  }

  if (production && url.protocol !== "https:") {
    throw configurationError("must use HTTPS for pwa/prod builds.");
  }

  if (url.username || url.password) {
    throw configurationError("must not contain embedded credentials.");
  }

  if (url.search || url.hash) {
    throw configurationError("must not contain a query string or fragment.");
  }

  if (production && url.pathname !== "/") {
    throw configurationError("must use the origin root path for pwa/prod builds.");
  }

  if (production && url.origin !== PRODUCTION_COMMUNITY_API_ORIGIN) {
    throw configurationError(
      `must use the authorized production origin ${PRODUCTION_COMMUNITY_API_ORIGIN}.`,
    );
  }

  return url.toString().replace(/\/+$/, "");
}
