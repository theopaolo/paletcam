import { describe, expect, test } from "bun:test";

import { createCollectionFilterState, isPaletteFavorite } from "./collection-filter.js";

function createPalette(id, overrides = {}) {
  return {
    id,
    timestamp: "2026-07-30T10:00:00.000Z",
    colors: [],
    favoritedAt: null,
    remoteCatchId: null,
    remoteOwnerAccountKey: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
    ...overrides,
  };
}

function createTestState() {
  return createCollectionFilterState({
    published: (palette) => palette.moderationStatus === "PUBLIC",
    favorites: isPaletteFavorite,
  });
}

describe("isPaletteFavorite", () => {
  test("treats a non-empty ISO timestamp as favorited", () => {
    expect(isPaletteFavorite(createPalette(1, { favoritedAt: "2026-07-30T10:00:00.000Z" }))).toBe(
      true,
    );
  });

  test("treats null, empty, and missing values as not favorited", () => {
    expect(isPaletteFavorite(createPalette(1))).toBe(false);
    expect(isPaletteFavorite(createPalette(1, { favoritedAt: "" }))).toBe(false);
    expect(isPaletteFavorite({})).toBe(false);
    expect(isPaletteFavorite(null)).toBe(false);
  });
});

describe("createCollectionFilterState", () => {
  test("returns the source list untouched when no filter is active", () => {
    const state = createTestState();
    const palettes = [createPalette(1), createPalette(2)];

    expect(state.apply(palettes)).toBe(palettes);
    expect(state.hasActive()).toBe(false);
    expect(state.getActive()).toEqual([]);
  });

  test("keeps only palettes matching a single active filter", () => {
    const state = createTestState();
    const favorite = createPalette(1, { favoritedAt: "2026-07-30T10:00:00.000Z" });
    const palettes = [favorite, createPalette(2)];

    expect(state.toggle("favorites")).toBe(true);

    expect(state.apply(palettes)).toEqual([favorite]);
    expect(state.isActive("favorites")).toBe(true);
    expect(state.getActive()).toEqual(["favorites"]);
  });

  test("composes multiple active filters with AND", () => {
    const state = createTestState();
    const both = createPalette(1, {
      favoritedAt: "2026-07-30T10:00:00.000Z",
      moderationStatus: "PUBLIC",
    });
    const favoriteOnly = createPalette(2, { favoritedAt: "2026-07-30T10:00:00.000Z" });
    const publishedOnly = createPalette(3, { moderationStatus: "PUBLIC" });

    state.toggle("favorites");
    state.toggle("published");

    expect(state.apply([both, favoriteOnly, publishedOnly])).toEqual([both]);
    expect(state.getActive()).toEqual(["published", "favorites"]);
  });

  test("toggling an active filter turns it back off", () => {
    const state = createTestState();

    expect(state.toggle("favorites")).toBe(true);
    expect(state.toggle("favorites")).toBe(false);
    expect(state.hasActive()).toBe(false);
  });

  test("ignores filter names without a predicate", () => {
    const state = createTestState();
    const palettes = [createPalette(1)];

    expect(state.toggle("tags")).toBe(false);
    expect(state.isActive("tags")).toBe(false);
    expect(state.apply(palettes)).toBe(palettes);
    expect(state.count(palettes, "tags")).toBe(0);
  });

  test("counts a single filter independently of the other active filters", () => {
    const state = createTestState();
    const palettes = [
      createPalette(1, { favoritedAt: "2026-07-30T10:00:00.000Z" }),
      createPalette(2, { moderationStatus: "PUBLIC" }),
      createPalette(3),
    ];

    state.toggle("published");

    expect(state.count(palettes, "favorites")).toBe(1);
    expect(state.count(palettes, "published")).toBe(1);
  });

  test("clear reports whether it removed anything", () => {
    const state = createTestState();

    expect(state.clear()).toBe(false);
    state.toggle("favorites");
    expect(state.clear()).toBe(true);
    expect(state.hasActive()).toBe(false);
  });

  test("exposes its filter names in predicate-map order", () => {
    expect(createTestState().getNames()).toEqual(["published", "favorites"]);
  });
});
