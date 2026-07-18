import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_API_CONTRACT_LIMITS,
  validateAcknowledgement,
  validateCatchPublication,
  validateLoginVerification,
  validateMagicLink,
  validateModerationStatuses,
} from "./community-api-contract.js";

const normalizeStatus = (value) => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"].includes(normalized) ? normalized : null;
};

describe("community API response contracts", () => {
  test("accepts empty and object acknowledgement responses", () => {
    expect(validateAcknowledgement(null, "login")).toBeNull();
    expect(validateAcknowledgement({}, "account deletion code")).toEqual({});
    expect(validateAcknowledgement({ success: true }, "account deletion")).toEqual({});
    expect(validateAcknowledgement({}, "catch unpublish")).toEqual({});
  });

  test("rejects non-object acknowledgement payloads", () => {
    expect(() => validateAcknowledgement("ok", "login")).toThrow(/empty response or JSON object/);
    expect(() => validateAcknowledgement([], "catch unpublish")).toThrow(
      /empty response or JSON object/,
    );
  });

  test("requires a login token and validates the optional user shape", () => {
    const response = {
      token: "secret-token",
      user: { id: "user-1", email: "catcher@example.com" },
    };
    expect(validateLoginVerification(response)).toEqual(response);
    expect(validateLoginVerification({ token: "token", user: null })).toEqual({
      token: "token",
      user: null,
    });
    expect(() => validateLoginVerification({ user: {} })).toThrow(/token/);
    expect(() => validateLoginVerification({ token: "token", user: "user" })).toThrow(/user/);
  });

  test("bounds retained login credentials and user identity fields", () => {
    expect(
      validateLoginVerification({
        token: "t".repeat(COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters),
        user: {
          id: 42.5,
          name: "n".repeat(COMMUNITY_API_CONTRACT_LIMITS.userNameCharacters),
          email: "e".repeat(COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters),
        },
      }).user.id,
    ).toBe("42.5");

    expect(() =>
      validateLoginVerification({
        token: "t".repeat(COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters + 1),
      }),
    ).toThrow(/8192/);
    expect(() => validateLoginVerification({ token: "token", user: { id: Infinity } })).toThrow(
      /finite number/,
    );
    expect(() =>
      validateLoginVerification({
        token: "token",
        user: { id: "i".repeat(COMMUNITY_API_CONTRACT_LIMITS.remoteIdCharacters + 1) },
      }),
    ).toThrow(/256/);
    expect(() =>
      validateLoginVerification({
        token: "token",
        user: { name: "n".repeat(COMMUNITY_API_CONTRACT_LIMITS.userNameCharacters + 1) },
      }),
    ).toThrow(/160/);
    expect(() =>
      validateLoginVerification({
        token: "token",
        user: { email: "e".repeat(COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters + 1) },
      }),
    ).toThrow(/320/);
  });

  test("preserves optional magic-link fields while rejecting wrong field types", () => {
    expect(validateMagicLink({})).toEqual({});
    expect(
      validateMagicLink({
        magic_link: "https://colorcatchers.co/auth/magic/example",
        expires_at: "2026-07-12T10:00:00.000Z",
      }),
    ).toEqual({
      magic_link: "https://colorcatchers.co/auth/magic/example",
      expires_at: "2026-07-12T10:00:00.000Z",
    });
    expect(() => validateMagicLink({ magic_link: 42 })).toThrow(/magic_link/);
    expect(() => validateMagicLink({ magic_link: "javascript:alert(1)" })).toThrow(/HTTPS/);
    expect(() => validateMagicLink({ magic_link: "/relative" })).toThrow(/HTTPS/);
    expect(() =>
      validateMagicLink(
        { magic_link: "https://phishing.example/auth/magic/example" },
        "https://colorcatchers.co",
      ),
    ).toThrow(/origin/);
    expect(() => validateMagicLink({ expires_at: false })).toThrow(/expires_at/);
    expect(() => validateMagicLink({ expires_at: "not-a-date" })).toThrow(/ISO-compatible/);
  });

  test("requires a published catch id and accepts known optional moderation status", () => {
    const response = { catch: { id: 42, status: "public" } };
    expect(validateCatchPublication(response, normalizeStatus)).toEqual({
      catch: { id: "42", status: "PUBLIC" },
    });
    expect(validateCatchPublication({ catch: { id: "remote-1" } }, normalizeStatus)).toEqual({
      catch: { id: "remote-1" },
    });
    expect(() => validateCatchPublication({ catch: {} }, normalizeStatus)).toThrow(/catch.id/);
    expect(() =>
      validateCatchPublication({ catch: { id: "remote-1", status: "UNKNOWN" } }, normalizeStatus),
    ).toThrow(/status is unknown/);
  });

  test("normalizes valid moderation results and rejects any malformed entry", () => {
    expect(
      validateModerationStatuses(
        {
          catches: [
            { id: "remote-1", status: "public" },
            { id: 2, status: "TO_MODERATE" },
          ],
          deletedIds: ["remote-3", 4],
        },
        normalizeStatus,
      ),
    ).toEqual({
      statuses: [
        { remoteCatchId: "remote-1", status: "PUBLIC" },
        { remoteCatchId: "2", status: "TO_MODERATE" },
      ],
      deletedIds: ["remote-3", "4"],
    });
    expect(validateModerationStatuses({}, normalizeStatus)).toEqual({
      statuses: [],
      deletedIds: [],
    });
    expect(() =>
      validateModerationStatuses({ catches: [{ id: "remote-1", status: "bad" }] }, normalizeStatus),
    ).toThrow(/status is unknown/);
    expect(() =>
      validateModerationStatuses({ catches: [], deletedIds: [""] }, normalizeStatus),
    ).toThrow(/1 to 256 characters/);
  });

  test("bounds moderation responses and rejects duplicate or unrequested ids", () => {
    expect(() =>
      validateModerationStatuses(
        {
          catches: [
            { id: "same", status: "public" },
            { id: "same", status: "private" },
          ],
        },
        normalizeStatus,
      ),
    ).toThrow(/duplicates/);
    expect(() =>
      validateModerationStatuses(
        {
          catches: [{ id: 7, status: "public" }],
          deletedIds: ["7"],
        },
        normalizeStatus,
      ),
    ).toThrow(/duplicates/);
    expect(() =>
      validateModerationStatuses(
        { catches: [{ id: "unexpected", status: "public" }] },
        normalizeStatus,
        { allowedIds: ["requested"], maxEntries: 1 },
      ),
    ).toThrow(/unrequested/);

    const oversized = Array.from(
      { length: COMMUNITY_API_CONTRACT_LIMITS.moderationBatchIds + 1 },
      (_, index) => ({ id: `id-${index}`, status: "public" }),
    );
    expect(() => validateModerationStatuses({ catches: oversized }, normalizeStatus)).toThrow(
      /at most 100 total entries/,
    );
  });
});
