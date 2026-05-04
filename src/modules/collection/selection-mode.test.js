import { describe, expect, test } from "bun:test";

import { applySelectionModeCardClick } from "./selection-mode.js";

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
