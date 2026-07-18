const COMMUNITY_ACCOUNT_KEY_PATTERN = /^account:[a-f0-9]{16}$/;

/** @param {unknown} value */
function hashAccountIdentity(value) {
  // FNV-1a 64-bit keeps raw account identifiers and bearer tokens out of storage.
  let hash = 0xcbf29ce484222325n;
  for (const character of String(value).slice(0, 1024)) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** @param {unknown} value */
export function normalizeCommunityAccountKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return COMMUNITY_ACCOUNT_KEY_PATTERN.test(normalized) ? normalized : null;
}

/**
 * @typedef {object} CommunityAccountSession
 * @property {unknown} [token]
 * @property {unknown} [email]
 * @property {{id?: unknown, email?: unknown} | null} [user]
 */

/** @param {CommunityAccountSession | null | undefined} session */
export function deriveCommunityAccountKey(session) {
  if (!session?.token) return "";

  const userId = String(session.user?.id ?? "").trim();
  const email = String(session.user?.email || session.email || "")
    .trim()
    .toLowerCase();
  const identity = userId ? `user:${userId}` : email ? `email:${email}` : "";
  if (!identity) return "";
  return `account:${hashAccountIdentity(identity)}`;
}

/** @param {CommunityAccountSession | null | undefined} session */
export function deriveCommunityAccountKeyAliases(session) {
  if (!session) return [];
  const primary = deriveCommunityAccountKey(session);
  if (!primary) return [];

  const userId = String(session.user?.id ?? "").trim();
  const email = String(session.user?.email || session.email || "")
    .trim()
    .toLowerCase();
  const aliases = [primary];
  if (userId && email) {
    aliases.push(`account:${hashAccountIdentity(`email:${email}`)}`);
  }
  return [...new Set(aliases)];
}

/**
 * @param {{remoteOwnerAccountKey?: unknown} | null | undefined} palette
 * @param {CommunityAccountSession | null | undefined} session
 */
export function paletteRemoteOwnerMatchesSession(palette, session) {
  const ownerAccountKey = normalizeCommunityAccountKey(palette?.remoteOwnerAccountKey);
  return Boolean(
    ownerAccountKey && deriveCommunityAccountKeyAliases(session).includes(ownerAccountKey),
  );
}
