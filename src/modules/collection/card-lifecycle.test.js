import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCollectionCardLifecycle } from "./card-lifecycle.js";
import { FakeElement, installFakeDom } from "./test-support/fake-dom.js";

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

  test("removes empty list sessions and updates the remaining day count", () => {
    const collectionGrid = new FakeElement("div");

    const day = new FakeElement("section");
    day.className = "collection-day";

    const dayCount = createCount("collection-day-count");
    const sessionOne = new FakeElement("section");
    sessionOne.className = "collection-session";
    sessionOne.dataset.sessionId = "session-1";

    const sessionOneCount = createCount("collection-session-count");
    const sessionOneBody = new FakeElement("div");
    sessionOneBody.className = "collection-session-body";
    const sessionOneCard = createCard();
    sessionOneBody.appendChild(sessionOneCard);
    sessionOne.append(sessionOneCount, sessionOneBody);

    const sessionTwo = new FakeElement("section");
    sessionTwo.className = "collection-session";
    sessionTwo.dataset.sessionId = "session-2";

    const sessionTwoCount = createCount("collection-session-count");
    const sessionTwoBody = new FakeElement("div");
    sessionTwoBody.className = "collection-session-body";
    sessionTwoBody.appendChild(createCard());
    sessionTwo.append(sessionTwoCount, sessionTwoBody);

    day.append(dayCount, sessionOne, sessionTwo);
    collectionGrid.appendChild(day);

    const collapsedSessionIds = new Set(["session-1"]);
    const lifecycle = createCollectionCardLifecycle({
      collectionGrid,
      emptyMessageText: "Aucune capture",
      collapsedSessionIds,
      reloadCollectionUi: async () => {},
    });

    sessionOneCard.remove();
    lifecycle.syncSessionStateFromCardContainer(sessionOneBody);

    expect(collectionGrid.querySelectorAll(".collection-session")).toHaveLength(1);
    expect(dayCount.textContent).toBe("1");
    expect(collapsedSessionIds.has("session-1")).toBe(false);
  });

  test("removes empty day grids and restores the empty message in grid mode", () => {
    const collectionGrid = new FakeElement("div");

    const day = new FakeElement("section");
    day.className = "collection-day";

    const dayCount = createCount("collection-day-count");
    const dayGrid = new FakeElement("div");
    dayGrid.className = "collection-day-grid";
    const card = createCard();
    dayGrid.appendChild(card);
    day.append(dayCount, dayGrid);
    collectionGrid.appendChild(day);

    const lifecycle = createCollectionCardLifecycle({
      collectionGrid,
      emptyMessageText: "Aucune capture",
      collapsedSessionIds: new Set(),
      reloadCollectionUi: async () => {},
    });

    card.remove();
    lifecycle.syncSessionStateFromCardContainer(dayGrid);

    expect(collectionGrid.querySelector(".collection-day")).toBeNull();
    expect(collectionGrid.querySelector(".empty-message")?.textContent).toBe("Aucune capture");
  });
});
