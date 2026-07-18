import { isProductionDeploy } from "./build-policy.js";

const ENVIRONMENT_VARIABLE = "PALETCAM_LOG_API_BASE_URL";
const PRODUCTION_LOG_API_ORIGIN = "https://cclogs.ludique.dev";

function configurationError(message) {
  return new Error(`Invalid ${ENVIRONMENT_VARIABLE}: ${message}`);
}

/**
 * Resolve the compile-time telemetry base URL. Only an explicit production
 * artifact requires it; development and preprod remain usable without a log
 * service. Production also verifies that browser CSP permits the destination.
 */
export function resolveLogApiBaseUrl(rawValue, deployBranchName) {
  const value = String(rawValue || "").trim();
  const production = isProductionDeploy(deployBranchName);

  if (!value) {
    if (production) {
      throw configurationError("is required for pwa/prod builds.");
    }
    return "";
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

  if (production && url.origin !== PRODUCTION_LOG_API_ORIGIN) {
    throw configurationError(
      `must use the authorized production origin ${PRODUCTION_LOG_API_ORIGIN}.`,
    );
  }

  return url.toString().replace(/\/+$/, "");
}
