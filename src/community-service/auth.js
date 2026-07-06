import {
  deleteAccount,
  requestAccountDeletionCode,
  requestCommunityLoginCode,
  verifyCommunityLoginCode,
} from "../community-api.js";
import {
  clearCommunitySession,
  getCommunitySession,
  setCommunitySession,
  subscribeCommunitySession,
} from "../community-session.js";
import { getSavedPalettes, updatePaletteRemoteState } from "../palette-storage.js";
import { createCommunityServiceError, getAuthTokenOrThrow, mapApiError } from "./errors.js";
import { getPaletteRemoteCatchId } from "./palette-state.js";

function normalizeEmail(email) {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase();
}

export async function sendCommunityLoginOtp(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw createCommunityServiceError("Email is required.", { code: "MISSING_EMAIL" });
  }

  try {
    await requestCommunityLoginCode({ email: normalizedEmail });
    return normalizedEmail;
  } catch (error) {
    throw mapApiError(error);
  }
}

export async function verifyCommunityLoginOtp({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail) {
    throw createCommunityServiceError("Email is required.", { code: "MISSING_EMAIL" });
  }

  if (!normalizedCode) {
    throw createCommunityServiceError("Code is required.", { code: "MISSING_CODE" });
  }

  try {
    const payload = await verifyCommunityLoginCode({
      email: normalizedEmail,
      code: normalizedCode,
    });
    const token = String(payload?.token || "").trim();
    if (!token) {
      throw createCommunityServiceError("Missing token in verification response.", {
        code: "MISSING_TOKEN",
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
  clearCommunitySession();
}

export async function sendAccountDeletionCode() {
  const token = getAuthTokenOrThrow();

  try {
    await requestAccountDeletionCode({ token });
  } catch (error) {
    throw mapApiError(error);
  }
}

export async function confirmAccountDeletion({ code }) {
  const token = getAuthTokenOrThrow();
  const normalizedCode = String(code || "").trim();

  if (!normalizedCode) {
    throw createCommunityServiceError("Code is required.", { code: "MISSING_CODE" });
  }

  try {
    await deleteAccount({ token, code: normalizedCode });

    const palettes = await getSavedPalettes();
    const publishedPalettes = palettes.filter((palette) => getPaletteRemoteCatchId(palette));
    await Promise.all(
      publishedPalettes.map((palette) =>
        updatePaletteRemoteState(palette.id, {
          remoteCatchId: null,
          moderationStatus: null,
          postedAt: null,
          moderationUpdatedAt: null,
          lastModerationCheckAt: null,
        }),
      ),
    );

    clearCommunitySession();
  } catch (error) {
    if (error?.name === "CommunityServiceError") {
      throw error;
    }

    throw mapApiError(error);
  }
}

export function getCurrentCommunitySession() {
  return getCommunitySession();
}

export { subscribeCommunitySession };
