import { describe, expect, test } from "bun:test";

import {
  areAllCollectionSessionsCollapsed,
  buildCollectionPanelTitle,
  collapseAllCollectionSessions,
  expandAllCollectionSessions,
  getCollectionSessionIds,
  toggleAllCollectionSessions,
} from "./panel-state.js";

function createDayGroups() {
  return [
    {
      id: "day-1",
      sessions: [
        { id: "session-morning", palettes: [{ id: 1 }] },
        { id: "session-evening", palettes: [{ id: 2 }, { id: 3 }] },
      ],
    },
  ];
}

describe("collection panel state", () => {
  test("builds the capture title with the total count", () => {
    expect(buildCollectionPanelTitle(0)).toBe("Captures (0)");
    expect(buildCollectionPanelTitle(12)).toBe("Captures (12)");
  });

  test("returns day session ids in order", () => {
    expect(getCollectionSessionIds(createDayGroups())).toEqual([
      "session-morning",
      "session-evening",
    ]);
  });

  test("collapse all marks every session as collapsed", () => {
    const collapsedSessionIds = new Set(["session-morning"]);

    const hasChanged = collapseAllCollectionSessions(createDayGroups(), collapsedSessionIds);

    expect(hasChanged).toBe(true);
    expect([...collapsedSessionIds]).toEqual([
      "session-morning",
      "session-evening",
    ]);
    expect(areAllCollectionSessionsCollapsed(createDayGroups(), collapsedSessionIds)).toBe(true);
  });

  test("expand all clears the collapsed state for current sessions", () => {
    const collapsedSessionIds = new Set(["session-morning", "session-evening"]);

    const hasChanged = expandAllCollectionSessions(createDayGroups(), collapsedSessionIds);

    expect(hasChanged).toBe(true);
    expect([...collapsedSessionIds]).toEqual([]);
    expect(areAllCollectionSessionsCollapsed(createDayGroups(), collapsedSessionIds)).toBe(false);
  });

  test("toggle all collapses first and reopens on the next toggle", () => {
    const collapsedSessionIds = new Set();

    expect(toggleAllCollectionSessions(createDayGroups(), collapsedSessionIds)).toBe(true);
    expect([...collapsedSessionIds]).toEqual([
      "session-morning",
      "session-evening",
    ]);

    expect(toggleAllCollectionSessions(createDayGroups(), collapsedSessionIds)).toBe(true);
    expect([...collapsedSessionIds]).toEqual([]);
  });

  test("reports fully collapsed only when all session ids are present", () => {
    const collapsedSessionIds = new Set(["session-morning"]);

    expect(areAllCollectionSessionsCollapsed(createDayGroups(), collapsedSessionIds)).toBe(false);

    collapsedSessionIds.add("session-evening");

    expect(areAllCollectionSessionsCollapsed(createDayGroups(), collapsedSessionIds)).toBe(true);
  });
});
