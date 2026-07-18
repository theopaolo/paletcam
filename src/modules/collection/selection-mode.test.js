import { describe, expect, test } from "bun:test";

import { applySelectionModeCardClick, createCollectionSelectionState } from "./selection-mode.js";

describe("applySelectionModeCardClick", () => {
  test("suppresses the first click after select mode activation without changing selection", () => {
    const selectedIds = new Set([12]);

    const result = applySelectionModeCardClick({
      paletteId: 12,
      selectedIds,
      suppressNextClick: true,
    });

    expect(result).toEqual({
      isSelected: true,
      suppressNextClick: false,
      toggled: false,
    });
    expect([...selectedIds]).toEqual([12]);
  });

  test("selects an unselected palette", () => {
    const selectedIds = new Set();

    const result = applySelectionModeCardClick({
      paletteId: 12,
      selectedIds,
    });

    expect(result).toEqual({
      isSelected: true,
      suppressNextClick: false,
      toggled: true,
    });
    expect([...selectedIds]).toEqual([12]);
  });

  test("deselects an already selected palette", () => {
    const selectedIds = new Set([12]);

    const result = applySelectionModeCardClick({
      paletteId: 12,
      selectedIds,
    });

    expect(result).toEqual({
      isSelected: false,
      suppressNextClick: false,
      toggled: true,
    });
    expect([...selectedIds]).toEqual([]);
  });
});

describe("collection selection state", () => {
  test("owns entry, suppressed activation click, toggles, and exit", () => {
    const state = createCollectionSelectionState();
    state.enter(12, { suppressNextClick: true });

    expect(state.isActive()).toBe(true);
    expect(state.getSelectedIds()).toEqual([12]);
    expect(state.applyCardClick(12).toggled).toBe(false);
    expect(state.applyCardClick(12)).toMatchObject({ isSelected: false, toggled: true });

    state.exit();
    expect(state.isActive()).toBe(false);
    expect(state.getCount()).toBe(0);
  });

  test("prunes unavailable ids and returns selected palettes through a policy predicate", () => {
    const state = createCollectionSelectionState();
    const palettes = [
      { id: 1, exportable: true },
      { id: 2, exportable: false },
      { id: 3, exportable: true },
    ];
    state.enter(1);
    state.applyCardClick(2);
    state.applyCardClick(99);

    state.pruneUnavailable(palettes);

    expect(state.getSelectedIds()).toEqual([1, 2]);
    expect(state.getSelected(palettes, (palette) => palette.exportable)).toEqual([palettes[0]]);
  });
});
