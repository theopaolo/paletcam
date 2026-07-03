import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCollectionCardLifecycle } from "./card-lifecycle.js";
import { FakeElement, installFakeDom } from "../test-support/fake-dom.js";

function createCard() {
  const card = new FakeElement("div");
  card.className = "palette-card";
  return card;
}

function createCount(label) {
  const count = new FakeElement("span");
  count.className = label;
  return count;
}

describe("createCollectionCardLifecycle", () => {
  let restoreDom = () => {};

  beforeEach(() => {
    restoreDom = installFakeDom();
  });

  afterEach(() => {
    restoreDom();
  });

  test("updates the day count when a card is removed from a day with remaining cards", () => {
    const collectionGrid = new FakeElement("div");

    const day = new FakeElement("section");
    day.className = "collection-day";
    day.dataset.dayId = "day-1";

    const dayCount = createCount("collection-day-count");
    const dayCards = new FakeElement("div");
    dayCards.className = "collection-day-cards";
    const removedCard = createCard();
    dayCards.append(removedCard, createCard());
    day.append(dayCount, dayCards);
    collectionGrid.appendChild(day);

    const collapsedDayIds = new Set();
    const lifecycle = createCollectionCardLifecycle({
      collectionGrid,
      emptyMessageText: "Aucune capture",
      collapsedDayIds,
      reloadCollectionUi: async () => {},
    });

    removedCard.remove();
    lifecycle.syncDayStateFromCardContainer(dayCards);

    expect(collectionGrid.querySelectorAll(".collection-day")).toHaveLength(1);
    expect(dayCount.textContent).toBe("1");
  });

  test("removes empty days, clears their collapse state, and restores the empty message", () => {
    const collectionGrid = new FakeElement("div");

    const day = new FakeElement("section");
    day.className = "collection-day";
    day.dataset.dayId = "day-1";

    const dayCount = createCount("collection-day-count");
    const dayGrid = new FakeElement("div");
    dayGrid.className = "collection-day-grid";
    const card = createCard();
    dayGrid.appendChild(card);
    day.append(dayCount, dayGrid);
    collectionGrid.appendChild(day);

    const collapsedDayIds = new Set(["day-1"]);
    const lifecycle = createCollectionCardLifecycle({
      collectionGrid,
      emptyMessageText: "Aucune capture",
      collapsedDayIds,
      reloadCollectionUi: async () => {},
    });

    card.remove();
    lifecycle.syncDayStateFromCardContainer(dayGrid);

    expect(collectionGrid.querySelector(".collection-day")).toBeNull();
    expect(collectionGrid.querySelector(".empty-message")?.textContent).toBe("Aucune capture");
    expect(collapsedDayIds.has("day-1")).toBe(false);
  });
});
