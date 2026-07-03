import { describe, expect, test } from "bun:test";

import {
  areAllCollectionDaysCollapsed,
  buildCollectionPanelTitle,
  collapseAllCollectionDays,
  expandAllCollectionDays,
  getCollectionDayIds,
  toggleAllCollectionDays,
} from "./panel-state.js";

function createDayGroups() {
  return [
    { id: "day-1", palettes: [{ id: 1 }] },
    { id: "day-2", palettes: [{ id: 2 }, { id: 3 }] },
  ];
}

describe("collection panel state", () => {
  test("builds the capture title with the total count", () => {
    expect(buildCollectionPanelTitle(0)).toBe("Captures (0)");
    expect(buildCollectionPanelTitle(12)).toBe("Captures (12)");
  });

  test("returns day ids in order", () => {
    expect(getCollectionDayIds(createDayGroups())).toEqual(["day-1", "day-2"]);
  });

  test("collapse all marks every day as collapsed", () => {
    const collapsedDayIds = new Set(["day-1"]);

    const hasChanged = collapseAllCollectionDays(createDayGroups(), collapsedDayIds);

    expect(hasChanged).toBe(true);
    expect([...collapsedDayIds]).toEqual(["day-1", "day-2"]);
    expect(areAllCollectionDaysCollapsed(createDayGroups(), collapsedDayIds)).toBe(true);
  });

  test("expand all clears the collapsed state for current days", () => {
    const collapsedDayIds = new Set(["day-1", "day-2"]);

    const hasChanged = expandAllCollectionDays(createDayGroups(), collapsedDayIds);

    expect(hasChanged).toBe(true);
    expect([...collapsedDayIds]).toEqual([]);
    expect(areAllCollectionDaysCollapsed(createDayGroups(), collapsedDayIds)).toBe(false);
  });

  test("toggle all collapses first and reopens on the next toggle", () => {
    const collapsedDayIds = new Set();

    expect(toggleAllCollectionDays(createDayGroups(), collapsedDayIds)).toBe(true);
    expect([...collapsedDayIds]).toEqual(["day-1", "day-2"]);

    expect(toggleAllCollectionDays(createDayGroups(), collapsedDayIds)).toBe(true);
    expect([...collapsedDayIds]).toEqual([]);
  });

  test("reports fully collapsed only when all day ids are present", () => {
    const collapsedDayIds = new Set(["day-1"]);

    expect(areAllCollectionDaysCollapsed(createDayGroups(), collapsedDayIds)).toBe(false);

    collapsedDayIds.add("day-2");

    expect(areAllCollectionDaysCollapsed(createDayGroups(), collapsedDayIds)).toBe(true);
  });
});
