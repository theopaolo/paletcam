import { clearCommunitySession, getCommunityAccessToken } from "../community-session.js";

export function createCommunityServiceError(message, { code = "UNKNOWN", cause = undefined } = {}) {
  const error = /** @type {Error & CommunityServiceError} */ (new Error(message));
  error.name = "CommunityServiceError";
  error.code = code;
  error.cause = cause;
  error.status = Number(cause?.status || 0);
  return error;
}

export function getAuthTokenOrThrow() {
  const token = getCommunityAccessToken();
  if (!token) {
    throw createCommunityServiceError("Authentication required.", { code: "NOT_AUTHENTICATED" });
  }

  return token;
}

/**
 * @param {any} error
 * @param {{expectedToken?: string}} [options]
 */
export function mapApiError(error, { expectedToken = "" } = {}) {
  if (error?.cause?.name === "AbortError" || error?.payload?.failureKind === "aborted") {
    return createCommunityServiceError("Request was cancelled.", {
      code: "REQUEST_CANCELLED",
      cause: error,
    });
  }

  if (Number(error?.status) === 401) {
    // A response belongs to the bearer capability that originated its request.
    // Never let a late 401 from an older request clear a newer login.
    if (expectedToken && getCommunityAccessToken() === expectedToken) {
      clearCommunitySession();
    }
    return createCommunityServiceError("Authentication expired.", {
      code: "AUTH_EXPIRED",
      cause: error,
    });
  }

  return createCommunityServiceError(error?.message || "Community API request failed.", {
    code: "API_ERROR",
    cause: error,
  });
}
