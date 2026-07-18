import { describe, expect, test } from "bun:test";
import {
  deriveCommunityAccountKey,
  deriveCommunityAccountKeyAliases,
  normalizeCommunityAccountKey,
  paletteRemoteOwnerMatchesSession,
} from "./community-account-key.js";

describe("community account keys", () => {
  test("derives a stable non-secret key from normalized account identity", () => {
    const first = deriveCommunityAccountKey({
      token: "secret-a",
      email: " USER@example.com ",
      user: null,
    });
    const second = deriveCommunityAccountKey({
      token: "secret-b",
      email: "user@example.com",
      user: null,
    });

    expect(first).toMatch(/^account:[a-f0-9]{16}$/);
    expect(second).toBe(first);
    expect(first).not.toContain("user");
    expect(deriveCommunityAccountKey(null)).toBe("");
  });

  test("prefers stable user id while retaining the historical email-key alias", () => {
    const beforeEmailChange = {
      token: "secret-a",
      email: "old@example.com",
      user: { id: "stable-id", email: "old@example.com" },
    };
    const afterEmailChange = {
      token: "secret-b",
      email: "new@example.com",
      user: { id: "stable-id", email: "new@example.com" },
    };

    expect(deriveCommunityAccountKey(afterEmailChange)).toBe(
      deriveCommunityAccountKey(beforeEmailChange),
    );
    expect(deriveCommunityAccountKeyAliases(beforeEmailChange)).toHaveLength(2);
  });

  test("normalizes only closed account-key values", () => {
    expect(normalizeCommunityAccountKey(" account:0123456789abcdef ")).toBe(
      "account:0123456789abcdef",
    );
    expect(normalizeCommunityAccountKey("account:0123")).toBeNull();
    expect(normalizeCommunityAccountKey(null)).toBeNull();
  });

  test("fails closed for legacy ownerless rows and rejects a known mismatch", () => {
    const session = { token: "token", email: "owner@example.com", user: null };
    const ownerAccountKey = deriveCommunityAccountKey(session);

    expect(paletteRemoteOwnerMatchesSession({ remoteOwnerAccountKey: null }, session)).toBe(false);
    expect(
      paletteRemoteOwnerMatchesSession({ remoteOwnerAccountKey: ownerAccountKey }, session),
    ).toBe(true);
    expect(
      paletteRemoteOwnerMatchesSession(
        { remoteOwnerAccountKey: "account:0123456789abcdef" },
        session,
      ),
    ).toBe(false);
  });
});
