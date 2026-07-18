import { createHash } from "node:crypto";

/**
 * Produces a stable service-worker cache identity from the exact precache
 * contents. Entry order cannot affect the result, while path or byte changes do.
 *
 * @param {Array<{path: string, content: string | Uint8Array}>} entries
 */
export function createContentBuildId(entries) {
  const hash = createHash("sha256");
  const sortedEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of sortedEntries) {
    hash.update(String(entry.path));
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 20);
}
