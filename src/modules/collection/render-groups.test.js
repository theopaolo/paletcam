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
    palettes: [createPalette(1), createPalette(2), createPalette(3)],
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

  test("renders a collapsible day with cards in list mode and honors collapsed state", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isDayCollapsed: (dayId) => dayId === "day-2026-03-12",
      onDayCollapsedChange() {},
      revealDurationMs: 280,
      revealStaggerMs: 42,
      viewMode: "list",
    });

    mountContent();

    expect(dayElement.classList.contains("is-collapsed")).toBe(true);
    expect(dayElement.querySelector(".collection-day-grid")).toBeNull();
    expect(dayElement.querySelector(".collection-day-cards")).not.toBeNull();
    expect(dayElement.querySelectorAll(".palette-card")).toHaveLength(3);
    expect(dayElement.querySelector(".collection-day-count")?.textContent).toBe("3");
    expect(dayElement.querySelector(".collection-day-cover")).not.toBeNull();

    const toggle = dayElement.querySelector(".collection-day-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  test("renders a day-level grid in grid mode", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isDayCollapsed: () => false,
      onDayCollapsedChange() {},
      revealDurationMs: 280,
      revealStaggerMs: 42,
      viewMode: "grid",
    });

    mountContent();

    const dayGrid = dayElement.querySelector(".collection-day-grid");

    expect(dayGrid).not.toBeNull();
    expect(dayGrid?.children).toHaveLength(3);
    expect(dayElement.querySelector(".collection-day-cards")).toBeNull();
    expect(dayElement.querySelector(".collection-day-toggle")?.disabled).toBeFalsy();
  });

  test("disables collapse in swatch mode", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isDayCollapsed: () => true,
      onDayCollapsedChange() {},
      revealDurationMs: 280,
      revealStaggerMs: 42,
      viewMode: "swatch",
    });

    mountContent();

    const toggle = dayElement.querySelector(".collection-day-toggle");

    expect(dayElement.classList.contains("is-collapsed")).toBe(false);
    expect(toggle?.disabled).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  test("updates collapse state when the day toggle is clicked", () => {
    const collapseEvents = [];
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      isDayCollapsed: () => false,
      onDayCollapsedChange: (dayId, isCollapsed) => {
        collapseEvents.push({ dayId, isCollapsed });
      },
      revealDurationMs: 280,
      revealStaggerMs: 42,
      viewMode: "list",
    });

    mountContent();

    const toggle = dayElement.querySelector(".collection-day-toggle");
    toggle?.click();

    expect(collapseEvents).toEqual([{ dayId: "day-2026-03-12", isCollapsed: true }]);
    expect(dayElement.classList.contains("is-collapsed")).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });
});
