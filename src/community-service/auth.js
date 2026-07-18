import {
  deleteAccount,
  requestAccountDeletionCode,
  requestCommunityLoginCode,
  verifyCommunityLoginCode,
} from "../community-api.js";
import {
  clearCommunitySession,
  communitySessionsEqual,
  getCommunitySession,
  setCommunitySession,
  subscribeCommunitySession,
} from "../community-session.js";
import { clearCommunityStateForAccount } from "../palette-storage.js";
import { reportAppError } from "../modules/error-reporting.js";
import { beginCriticalOperation } from "../modules/critical-operation.js";
import {
  deriveCommunityAccountKey,
  deriveCommunityAccountKeyAliases,
  normalizeCommunityAccountKey,
} from "../community-account-key.js";
import { createCommunityServiceError, getAuthTokenOrThrow, mapApiError } from "./errors.js";
import { COMMUNITY_API_CONTRACT_LIMITS } from "../community-api-contract.js";

const ACCOUNT_DELETION_CLEANUP_MARKER_KEY = "paletcam:account-deletion-cleanup-pending:v1";

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeAccountKeys(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values]).map(normalizeCommunityAccountKey).filter(Boolean),
    ),
  ];
}

function getPendingAccountDeletionCleanupAccountKeys() {
  try {
    const value = getLocalStorage()?.getItem(ACCOUNT_DELETION_CLEANUP_MARKER_KEY);
    if (!value) return [];
    const legacyOwner = normalizeCommunityAccountKey(value);
    if (legacyOwner) return [legacyOwner];
    if (value === "1") return ["ownerless"];
    const marker = JSON.parse(value);
    const accountKeys = normalizeAccountKeys(marker?.ownerAccountKeys ?? marker?.ownerAccountKey);
    return accountKeys.length > 0 ? accountKeys : ["ownerless"];
  } catch {
    return ["ownerless"];
  }
}

/**
 * @param {boolean} isPending
 * @param {string | string[]} [ownerAccountKeys]
 * @param {string} [expectedOwner]
 */
function setPendingAccountDeletionCleanup(isPending, ownerAccountKeys = "", expectedOwner = "") {
  try {
    const storage = getLocalStorage();
    if (!storage) return false;
    if (isPending) {
      const normalizedOwners = normalizeAccountKeys(ownerAccountKeys);
      if (normalizedOwners.length === 0) return false;
      storage.setItem(
        ACCOUNT_DELETION_CLEANUP_MARKER_KEY,
        JSON.stringify({
          version: 1,
          ownerAccountKey: normalizedOwners[0],
          ownerAccountKeys: normalizedOwners,
        }),
      );
    } else {
      if (expectedOwner && !getPendingAccountDeletionCleanupAccountKeys().includes(expectedOwner)) {
        return false;
      }
      storage.removeItem(ACCOUNT_DELETION_CLEANUP_MARKER_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

async function clearLocalPublicationMetadata(ownerAccountKeys = ["ownerless"]) {
  const normalizedOwners = normalizeAccountKeys(ownerAccountKeys);
  if (normalizedOwners.length === 0) return;
  await clearCommunityStateForAccount(normalizedOwners);
}

export async function retryPendingAccountDeletionCleanup() {
  const ownerAccountKeys = getPendingAccountDeletionCleanupAccountKeys();
  if (ownerAccountKeys.length === 0) {
    return { attempted: false, complete: true };
  }

  try {
    await clearLocalPublicationMetadata(ownerAccountKeys);
    setPendingAccountDeletionCleanup(false);
    return { attempted: true, complete: true };
  } catch (error) {
    reportAppError(error, {
      logMessage: "Account deleted; local publication metadata cleanup failed.",
      context: { operation: "account-deletion-local-cleanup-retry" },
    });
    return { attempted: true, complete: false };
  }
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase();
}

function validateEmailLength(email) {
  if (email.length > COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters) {
    throw createCommunityServiceError("Email is too long.", { code: "EMAIL_TOO_LONG" });
  }
}

function validateCodeLength(code, maximum) {
  if (code.length > maximum) {
    throw createCommunityServiceError("Code is too long.", { code: "CODE_TOO_LONG" });
  }
}

/** @param {string} email @param {{signal?: AbortSignal}} [options] */
export async function sendCommunityLoginOtp(email, { signal } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw createCommunityServiceError("Email is required.", { code: "MISSING_EMAIL" });
  }
  validateEmailLength(normalizedEmail);

  try {
    await requestCommunityLoginCode({ email: normalizedEmail, signal });
    return normalizedEmail;
  } catch (error) {
    throw mapApiError(error);
  }
}

export async function verifyCommunityLoginOtp({ email, code, signal }) {
  const initialSession = getCommunitySession();
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail) {
    throw createCommunityServiceError("Email is required.", { code: "MISSING_EMAIL" });
  }
  validateEmailLength(normalizedEmail);

  if (!normalizedCode) {
    throw createCommunityServiceError("Code is required.", { code: "MISSING_CODE" });
  }
  validateCodeLength(normalizedCode, COMMUNITY_API_CONTRACT_LIMITS.loginCodeCharacters);

  try {
    const payload = await verifyCommunityLoginCode({
      email: normalizedEmail,
      code: normalizedCode,
      signal,
    });
    const token = String(payload?.token || "").trim();
    if (!token) {
      throw createCommunityServiceError("Missing token in verification response.", {
        code: "MISSING_TOKEN",
      });
    }

    if (!communitySessionsEqual(getCommunitySession(), initialSession)) {
      throw createCommunityServiceError("The community session changed. Try again.", {
        code: "SESSION_CHANGED",
      });
    }

    return setCommunitySession({
      token,
      email: normalizedEmail,
      user: payload?.user ?? null,
    });
  } catch (error) {
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error);
  }
}

export function logoutCommunity() {
  return clearCommunitySession();
}

/** @param {{signal?: AbortSignal}} [options] */
export async function sendAccountDeletionCode({ signal } = {}) {
  const token = getAuthTokenOrThrow();

  try {
    await requestAccountDeletionCode({ token, signal });
  } catch (error) {
    throw mapApiError(error, { expectedToken: token });
  }
}

async function confirmAccountDeletionOperation({ code, signal }) {
  const deletionSession = getCommunitySession();
  const token = String(deletionSession?.token || "").trim() || getAuthTokenOrThrow();
  const ownerAccountKey = deriveCommunityAccountKey(deletionSession);
  const ownerAccountKeys = deriveCommunityAccountKeyAliases(deletionSession);
  const normalizedCode = String(code || "").trim();

  if (!normalizedCode) {
    throw createCommunityServiceError("Code is required.", { code: "MISSING_CODE" });
  }
  validateCodeLength(normalizedCode, COMMUNITY_API_CONTRACT_LIMITS.accountDeletionCodeCharacters);
  if (!ownerAccountKey) {
    throw createCommunityServiceError("A stable community account identity is required.", {
      code: "COMMUNITY_ACCOUNT_IDENTITY_REQUIRED",
    });
  }
  if (!setPendingAccountDeletionCleanup(true, ownerAccountKeys)) {
    throw createCommunityServiceError(
      "Account deletion recovery storage is unavailable. Free local storage and try again.",
      { code: "ACCOUNT_DELETION_RECOVERY_UNAVAILABLE" },
    );
  }

  try {
    await deleteAccount({ token, code: normalizedCode, signal });
  } catch (error) {
    setPendingAccountDeletionCleanup(false, "", ownerAccountKey);
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error, { expectedToken: token });
  }

  // The remote account is already irreversibly deleted. Never retain its
  // bearer token or report that deletion itself failed because local cleanup
  // encountered a recoverable IndexedDB error.
  if (getCommunitySession()?.token === token) {
    clearCommunitySession();
  }
  try {
    await clearLocalPublicationMetadata(ownerAccountKeys);
    setPendingAccountDeletionCleanup(false, "", ownerAccountKey);
    return { localCleanupComplete: true };
  } catch (error) {
    reportAppError(error, {
      logMessage: "Account deleted; local publication metadata cleanup failed.",
      context: { operation: "account-deletion-local-cleanup" },
    });
    return { localCleanupComplete: false };
  }
}

export function confirmAccountDeletion(options) {
  const releaseCriticalOperation = beginCriticalOperation("account-deletion");
  return confirmAccountDeletionOperation(options).finally(releaseCriticalOperation);
}

export function getCurrentCommunitySession() {
  return getCommunitySession();
}

void retryPendingAccountDeletionCleanup();

export { ACCOUNT_DELETION_CLEANUP_MARKER_KEY, subscribeCommunitySession };
