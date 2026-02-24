import { getSavedPalettes } from "./palette-storage.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import { createPaletteCard } from "./modules/collection/palette-card.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { createSwipeController } from "./modules/collection/swipe-controller.js";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const closeCollectionButton = document.querySelector(".btn-close-collection");
const QUICK_ACTION_WIDTH = 144;
const LEFT_ACTION_WIDTH = 0;
const RIGHT_ACTION_WIDTH = QUICK_ACTION_WIDTH * 2;
const SWIPE_START_THRESHOLD = 8;
const SWIPE_OPEN_RATIO = 0.38;
const EMPTY_MESSAGE_TEXT = "Aucune palette enregistree pour le moment";
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const MAGNETIC_SNAP_RESET_MS = 320;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
let activeSwipeController;

function setActiveSwipeController(controller) {
  if (activeSwipeController && activeSwipeController !== controller) {
    activeSwipeController.close();
  }

  activeSwipeController = controller;
}

function clearActiveSwipeController(controller) {
  if (activeSwipeController === controller) {
    activeSwipeController = undefined;
  }
}

function closeActiveSwipeController() {
  if (!activeSwipeController) {
    return;
  }

  activeSwipeController.close();
}

function createCollectionSwipeController({ card, track }) {
  return createSwipeController({
    card,
    track,
    leftActionWidth: LEFT_ACTION_WIDTH,
    rightActionWidth: RIGHT_ACTION_WIDTH,
    swipeStartThreshold: SWIPE_START_THRESHOLD,
    swipeOpenRatio: SWIPE_OPEN_RATIO,
    magneticSnapResetMs: MAGNETIC_SNAP_RESET_MS,
    getActiveController: () => activeSwipeController,
    closeActiveController: closeActiveSwipeController,
    setActiveController: setActiveSwipeController,
    clearActiveController: clearActiveSwipeController,
  });
}

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: EMPTY_MESSAGE_TEXT,
  collapsedSessionIds,
  reloadCollectionUi: () => loadCollectionUi(),
});

function createCollectionPaletteCard(palette) {
  return createPaletteCard({
    palette,
    createSwipeController: createCollectionSwipeController,
    pendingDeletionIds,
    deleteUndoDurationMs: DELETE_UNDO_DURATION_MS,
    takeCardPositionSnapshot: cardLifecycle.takeCardPositionSnapshot,
    restoreCardFromSnapshot: cardLifecycle.restoreCardFromSnapshot,
    syncSessionStateFromCardContainer:
      cardLifecycle.syncSessionStateFromCardContainer,
    clearActiveSwipeController,
    ensureEmptyMessage: cardLifecycle.ensureEmptyMessage,
  });
}

function createCollectionDayGroup(dayGroup) {
  return renderDayGroup({
    dayGroup,
    createPaletteCard: createCollectionPaletteCard,
    isSessionCollapsed: (sessionId) => collapsedSessionIds.has(sessionId),
    onBeforeSessionToggle: closeActiveSwipeController,
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
  closeActiveSwipeController();
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

function bindCollectionUiEvents() {
  if (
    !collectionPanel || !collectionGrid || !viewCollectionButton ||
    !closeCollectionButton
  ) {
    return;
  }

  viewCollectionButton.addEventListener("click", async () => {
    const settingsPanel = document.querySelector(".settings-panel");
    settingsPanel?.classList.remove("visible");
    settingsPanel?.setAttribute("aria-hidden", "true");
    if (settingsPanel) {
      settingsPanel.hidden = true;
    }
    collectionPanel.classList.add("visible");
    await loadCollectionUi();
  });

  closeCollectionButton.addEventListener("click", () => {
    closeActiveSwipeController();
    collectionPanel.classList.remove("visible");
  });

  collectionPanel.addEventListener("scroll", () => {
    closeActiveSwipeController();
  }, { passive: true });

  document.addEventListener("pointerdown", (event) => {
    if (
      !activeSwipeController || !collectionPanel.classList.contains("visible")
    ) {
      return;
    }

    if (activeSwipeController.card.contains(event.target)) {
      return;
    }

    closeActiveSwipeController();
  });
}

bindCollectionUiEvents();
