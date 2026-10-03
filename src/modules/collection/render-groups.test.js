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

  test("renders a day header with its count above the day's cards", () => {
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: createDayGroupFixture(),
      createPaletteCard,
      viewMode: "grid",
    });

    mountContent();

    expect(dayElement.querySelector(".collection-day-title")?.textContent).toBe(
      "Aujourd'hui — 12 mars 2026",
    );
    expect(dayElement.querySelector(".collection-day-count")?.textContent).toBe("3");
    expect(dayElement.querySelector(".collection-day-grid")?.children).toHaveLength(3);
  });

  test("hydrates large days in bounded batches without dropping cards", async () => {
    const palettes = Array.from({ length: 30 }, (_value, index) => createPalette(index + 1));
    const mountedIds = [];
    const { element: dayElement, mountContent } = createDayGroup({
      dayGroup: {
        ...createDayGroupFixture(),
        paletteCount: palettes.length,
        palettes,
      },
      createPaletteCard,
      onCardMount: (card) => mountedIds.push(Number(card.dataset.paletteId)),
      viewMode: "grid",
    });

    mountContent();
    expect(dayElement.querySelectorAll(".palette-card")).toHaveLength(12);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dayElement.querySelectorAll(".palette-card")).toHaveLength(30);
    expect(mountedIds).toHaveLength(30);
  });

  test("cancels pending card batches when a virtualized day unmounts", async () => {
    const palettes = Array.from({ length: 30 }, (_value, index) => createPalette(index + 1));
    const unmountedIds = [];
    const {
      element: dayElement,
      mountContent,
      unmountContent,
    } = createDayGroup({
      dayGroup: {
        ...createDayGroupFixture(),
        paletteCount: palettes.length,
        palettes,
      },
      createPaletteCard,
      onCardUnmount: (card) => unmountedIds.push(Number(card.dataset.paletteId)),
      viewMode: "grid",
    });

    mountContent();
    expect(dayElement.querySelectorAll(".palette-card")).toHaveLength(12);
    unmountContent(5_000);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dayElement.querySelectorAll(".palette-card")).toHaveLength(0);
    expect(unmountedIds).toEqual(Array.from({ length: 12 }, (_value, index) => index + 1));
  });
});
