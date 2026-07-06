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

export function mapApiError(error) {
  if (Number(error?.status) === 401) {
    clearCommunitySession();
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
