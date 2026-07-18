/**
 * @param {object} config
 * @param {HTMLElement | null} config.collectionGrid
 * @param {string | (() => string)} config.emptyMessageText
 * @param {Set<string>} config.collapsedDayIds
 * @param {() => Promise<void>} config.reloadCollectionUi
 * @returns {CollectionCardLifecycle}
 */
export function createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText,
  collapsedDayIds,
  reloadCollectionUi,
}) {
  const readEmptyMessageText =
    typeof emptyMessageText === "function" ? emptyMessageText : () => emptyMessageText;

  function removeEmptyMessage() {
    const message = collectionGrid?.querySelector(".empty-message");
    message?.remove();
  }

  function ensureEmptyMessage() {
    if (!collectionGrid) {
      return;
    }

    const hasCard = Boolean(collectionGrid.querySelector(".palette-card"));
    if (hasCard) {
      removeEmptyMessage();
      return;
    }

    if (collectionGrid.querySelector(".empty-message")) {
      return;
    }

    const message = document.createElement("p");
    message.className = "empty-message";
    message.textContent = readEmptyMessageText();
    collectionGrid.appendChild(message);
  }

  function getDayCardCount(dayElement) {
    if (!dayElement) {
      return 0;
    }

    return dayElement.querySelectorAll(".palette-card").length;
  }

  function updateDayCardCount(dayElement) {
    if (!dayElement) {
      return 0;
    }

    const countElement = dayElement.querySelector(".collection-day-count");
    if (!countElement) {
      return 0;
    }

    const cardCount = getDayCardCount(dayElement);
    countElement.textContent = String(cardCount);
    return cardCount;
  }

  function syncDayStateFromCardContainer(cardContainer) {
    const dayElement = cardContainer?.closest(".collection-day");

    if (dayElement) {
      const dayCount = updateDayCardCount(dayElement);
      if (dayCount > 0) {
        removeEmptyMessage();
        return;
      }

      const dayId = dayElement.dataset.dayId;
      if (dayId) {
        collapsedDayIds.delete(dayId);
      }

      dayElement.remove();
      ensureEmptyMessage();
      return;
    }

    ensureEmptyMessage();
  }

  function takeCardPositionSnapshot(card) {
    return {
      parent: card.parentElement,
      nextSibling: card.nextSibling,
    };
  }

  function restoreCardFromSnapshot(card, snapshot) {
    if (!collectionGrid) {
      return false;
    }

    if (card.isConnected) {
      return true;
    }

    removeEmptyMessage();

    const { parent, nextSibling } = snapshot;
    if (!parent || !parent.isConnected) {
      void reloadCollectionUi();
      return false;
    }

    if (nextSibling && nextSibling.parentElement === parent) {
      parent.insertBefore(card, nextSibling);
    } else {
      parent.appendChild(card);
    }

    syncDayStateFromCardContainer(parent);
    return true;
  }

  return {
    ensureEmptyMessage,
    syncDayStateFromCardContainer,
    takeCardPositionSnapshot,
    restoreCardFromSnapshot,
  };
}
