import { getSavedPalettes } from "./palette-storage.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import {
  closePaletteViewerOverlay,
  createPaletteCard,
} from "./modules/collection/palette-card.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const closeCollectionButton = document.querySelector(".btn-close-collection");
const EMPTY_MESSAGE_TEXT = "Aucune palette enregistree pour le moment";
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: EMPTY_MESSAGE_TEXT,
  collapsedSessionIds,
  reloadCollectionUi: () => loadCollectionUi(),
});

function createCollectionPaletteCard(palette) {
  return createPaletteCard({
    palette,
    pendingDeletionIds,
    deleteUndoDurationMs: DELETE_UNDO_DURATION_MS,
    takeCardPositionSnapshot: cardLifecycle.takeCardPositionSnapshot,
    restoreCardFromSnapshot: cardLifecycle.restoreCardFromSnapshot,
    syncSessionStateFromCardContainer:
      cardLifecycle.syncSessionStateFromCardContainer,
    ensureEmptyMessage: cardLifecycle.ensureEmptyMessage,
  });
}

function createCollectionDayGroup(dayGroup) {
  return renderDayGroup({
    dayGroup,
    createPaletteCard: createCollectionPaletteCard,
    isSessionCollapsed: (sessionId) => collapsedSessionIds.has(sessionId),
    onSessionCollapsedChange: (sessionId, isCollapsed) => {
      if (isCollapsed) {
        collapsedSessionIds.add(sessionId);
        return;
      }

      collapsedSessionIds.delete(sessionId);
    },
    sessionRevealDurationMs: SESSION_REVEAL_DURATION_MS,
    sessionRevealStaggerMs: SESSION_REVEAL_STAGGER_MS,
  });
}

async function loadCollectionUi() {
  closePaletteViewerOverlay();
  const palettes = (await getSavedPalettes()).filter((palette) =>
    !pendingDeletionIds.has(palette.id)
  );
  collectionGrid.innerHTML = "";

  if (palettes.length === 0) {
    collectionGrid.innerHTML =
      `<p class="empty-message">${EMPTY_MESSAGE_TEXT}</p>`;
    return;
  }

  const dayGroups = groupPalettesByDay(palettes);
  const availableSessionIds = new Set();

  dayGroups.forEach((dayGroup) => {
    dayGroup.sessions.forEach((session) => {
      availableSessionIds.add(session.id);
    });
  });

  [...collapsedSessionIds].forEach((sessionId) => {
    if (!availableSessionIds.has(sessionId)) {
      collapsedSessionIds.delete(sessionId);
    }
  });

  dayGroups.forEach((dayGroup) => {
    collectionGrid.appendChild(createCollectionDayGroup(dayGroup));
  });
}

export async function openCollectionPanel({
  paletteId,
  openPaletteViewer = false,
} = {}) {
  if (!collectionPanel || !collectionGrid) {
    return false;
  }

  closePaletteViewerOverlay();
  const settingsPanel = document.querySelector(".settings-panel");
  settingsPanel?.classList.remove("visible");
  settingsPanel?.setAttribute("aria-hidden", "true");
  if (settingsPanel) {
    settingsPanel.hidden = true;
  }
  collectionPanel.classList.add("visible");
  await loadCollectionUi();

  if (paletteId === undefined || paletteId === null) {
    return true;
  }

  const paletteIdString = String(paletteId);
  const targetCard = [...collectionGrid.querySelectorAll(".palette-card")]
    .find((card) => card.dataset.paletteId === paletteIdString);

  if (!targetCard) {
    return false;
  }

  targetCard.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });

  if (openPaletteViewer) {
    const trigger = targetCard.querySelector(".palette-card-trigger");
    if (trigger instanceof HTMLButtonElement) {
      trigger.click();
    }
  }

  return true;
}

function bindCollectionUiEvents() {
  if (
    !collectionPanel || !collectionGrid || !viewCollectionButton ||
    !closeCollectionButton
  ) {
    return;
  }

  viewCollectionButton.addEventListener("click", async () => {
    await openCollectionPanel();
  });

  closeCollectionButton.addEventListener("click", () => {
    closePaletteViewerOverlay();
    collectionPanel.classList.remove("visible");
  });
}

bindCollectionUiEvents();
