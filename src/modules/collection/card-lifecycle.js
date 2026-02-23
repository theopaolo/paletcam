export function createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText,
  collapsedSessionIds,
  reloadCollectionUi,
}) {
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
    message.textContent = emptyMessageText;
    collectionGrid.appendChild(message);
  }

  function updateSessionCardCount(sessionElement) {
    if (!sessionElement) {
      return 0;
    }

    const sessionBody = sessionElement.querySelector(".collection-session-body");
    const countElement = sessionElement.querySelector(
      ".collection-session-count",
    );

    if (!sessionBody || !countElement) {
      return 0;
    }

    const cardCount = sessionBody.querySelectorAll(".palette-card").length;
    countElement.textContent = String(cardCount);
    return cardCount;
  }

  function updateDayCardCount(dayElement) {
    if (!dayElement) {
      return 0;
    }

    const countElement = dayElement.querySelector(".collection-day-count");
    if (!countElement) {
      return 0;
    }

    const cardCount = dayElement.querySelectorAll(".palette-card").length;
    countElement.textContent = String(cardCount);
    return cardCount;
  }

  function syncSessionStateFromCardContainer(cardContainer) {
    const sessionElement = cardContainer?.closest(".collection-session");

    if (!sessionElement) {
      ensureEmptyMessage();
      return;
    }

    const dayElement = sessionElement.closest(".collection-day");
    const cardCount = updateSessionCardCount(sessionElement);

    if (cardCount === 0) {
      const sessionId = sessionElement.dataset.sessionId;
      if (sessionId) {
        collapsedSessionIds.delete(sessionId);
      }

      sessionElement.remove();
    }

    if (!dayElement) {
      ensureEmptyMessage();
      return;
    }

    const dayCount = updateDayCardCount(dayElement);
    if (dayCount > 0) {
      removeEmptyMessage();
      return;
    }

    dayElement.remove();
    ensureEmptyMessage();
  }

  function takeCardPositionSnapshot(card) {
    return {
      parent: card.parentElement,
      nextSibling: card.nextSibling,
    };
  }

  function restoreCardFromSnapshot(card, snapshot) {
    if (!collectionGrid || card.isConnected) {
      return;
    }

    removeEmptyMessage();

    const { parent, nextSibling } = snapshot;
    if (!parent || !parent.isConnected) {
      void reloadCollectionUi();
      return;
    }

    if (nextSibling && nextSibling.parentElement === parent) {
      parent.insertBefore(card, nextSibling);
    } else {
      parent.appendChild(card);
    }

    syncSessionStateFromCardContainer(parent);
  }

  return {
    ensureEmptyMessage,
    syncSessionStateFromCardContainer,
    takeCardPositionSnapshot,
    restoreCardFromSnapshot,
  };
}
