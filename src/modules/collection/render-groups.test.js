import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createDayGroup } from "./render-groups.js";
import { FakeElement, installFakeDom } from "../test-support/fake-dom.js";

function createPalette(id) {
  return {
    id,
    colors: [
      { r: 40 + id, g: 60 + id, b: 80 + id },
      { r: 30 + id, g: 45 + id, b: 55 + id },
    ],
  };
}

function createDayGroupFixture() {
  return {
    id: "day-2026-03-12",
    title: "Aujourd'hui",
    dateLabel: "12 mars 2026",
    paletteCount: 3,
    sessions: [
      {
        id: "session-day-morning",
        title: "Matin",
        palettes: [createPalette(1)],
      },
      {
        id: "session-day-evening",
        title: "Soirée",
        palettes: [createPalette(2), createPalette(3)],
      },
    ],
  };
}

function createPaletteCard(palette) {
  const card = new FakeElement("div");
  card.className = "palette-card";
  card.dataset.paletteId = String(palette.id);
  return card;
}

describe("createDayGroup", () => {
  let restoreDom = () => {};

  beforeEach(() => {
    restoreDom = installFakeDom();
  });

  afterEach(() => {
    restoreDom();
  });

  test("renders grouped sessions in list mode and honors collapsed state", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isSessionCollapsed: (sessionId) => sessionId === "session-day-evening",
      onSessionCollapsedChange() {},
      sessionRevealDurationMs: 280,
      sessionRevealStaggerMs: 42,
      viewMode: "list",
    });

    mountContent();

    expect(dayElement.querySelectorAll(".collection-session")).toHaveLength(2);
    expect(dayElement.querySelector(".collection-day-grid")).toBeNull();
    expect(dayElement.querySelector(".collection-day-count")?.textContent).toBe("3");

    const sessions = dayElement.querySelectorAll(".collection-session");

    expect(sessions[1]?.classList.contains("is-collapsed")).toBe(true);
    expect(dayElement.querySelectorAll(".is-collapsed")).toHaveLength(1);
    expect(dayElement.querySelectorAll(".collection-session-toggle")).toHaveLength(2);
  });

  test("renders a day-level grid in grid mode without session rows", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isSessionCollapsed: () => false,
      onSessionCollapsedChange() {},
      sessionRevealDurationMs: 280,
      sessionRevealStaggerMs: 42,
      viewMode: "grid",
    });

    mountContent();

    const dayGrid = dayElement.querySelector(".collection-day-grid");

    expect(dayGrid).not.toBeNull();
    expect(dayGrid?.children).toHaveLength(3);
    expect(dayElement.querySelectorAll(".collection-session")).toHaveLength(0);
    expect(dayElement.querySelectorAll(".collection-session-toggle")).toHaveLength(0);
  });

  test("updates collapse state when a session toggle is clicked", () => {
    const collapseEvents = [];
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isSessionCollapsed: () => false,
      onSessionCollapsedChange: (sessionId, isCollapsed) => {
        collapseEvents.push({ sessionId, isCollapsed });
      },
      sessionRevealDurationMs: 280,
      sessionRevealStaggerMs: 42,
      viewMode: "list",
    });

    mountContent();

    const firstToggle = dayElement.querySelector(".collection-session-toggle");
    firstToggle?.click();

    const firstSession = dayElement.querySelector(".collection-session");

    expect(collapseEvents).toEqual([
      { sessionId: "session-day-morning", isCollapsed: true },
    ]);
    expect(firstSession?.classList.contains("is-collapsed")).toBe(true);
    expect(firstToggle?.getAttribute("aria-expanded")).toBe("false");
  });
});
