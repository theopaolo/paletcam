/**
 * Owns which collection filters are active and how they narrow a palette list,
 * without importing DOM, storage, network, or settings.
 *
 * Filters compose with AND: two active chips mean "captures matching both".
 * The set of valid filter names is the key set of the injected predicate map, so
 * a new axis (colour family, tag) is added by passing one more predicate rather
 * than by editing this file.
 */

/** @param {Palette | null | undefined} palette */
export function isPaletteFavorite(palette) {
  return typeof palette?.favoritedAt === "string" && palette.favoritedAt.length > 0;
}

/**
 * @param {Record<string, (palette: Palette) => boolean>} [predicates]
 */
export function createCollectionFilterState(predicates = {}) {
  const orderedNames = Object.keys(predicates).filter(
    (name) => typeof predicates[name] === "function",
  );
  const knownNames = new Set(orderedNames);
  /** @type {Set<string>} */
  const activeNames = new Set();

  /** @param {string} name */
  const isKnown = (name) => knownNames.has(name);

  return {
    /** @param {Palette[]} palettes */
    apply(palettes) {
      const source = Array.isArray(palettes) ? palettes : [];
      const activePredicates = orderedNames
        .filter((name) => activeNames.has(name))
        .map((name) => predicates[name]);

      if (activePredicates.length === 0) {
        return source;
      }

      return source.filter((palette) => activePredicates.every((predicate) => predicate(palette)));
    },
    /** Removes every active filter. @returns {boolean} whether anything changed. */
    clear() {
      if (activeNames.size === 0) {
        return false;
      }

      activeNames.clear();
      return true;
    },
    /**
     * Counts the palettes a single filter would keep, ignoring the other active
     * filters — this is what a chip's badge should read.
     * @param {Palette[]} palettes @param {string} name
     */
    count(palettes, name) {
      if (!isKnown(name) || !Array.isArray(palettes)) {
        return 0;
      }

      return palettes.filter((palette) => predicates[name](palette)).length;
    },
    getActive: () => orderedNames.filter((name) => activeNames.has(name)),
    getNames: () => [...orderedNames],
    hasActive: () => activeNames.size > 0,
    /** @param {string} name */
    isActive: (name) => activeNames.has(name),
    /**
     * @param {string} name
     * @returns {boolean} whether the filter is active after the toggle.
     */
    toggle(name) {
      if (!isKnown(name)) {
        return false;
      }

      if (activeNames.has(name)) {
        activeNames.delete(name);
        return false;
      }

      activeNames.add(name);
      return true;
    },
  };
}
