import { getSavedPalettes } from "./palette-storage.js";
import {
  publishPaletteToCommunityFeed,
  syncPublishedPalettesModerationStatus,
} from "./community-service.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import {
  closePaletteViewerOverlay,
  createPaletteCard,
  subscribePaletteViewerOverlayClose,
} from "./modules/collection/palette-card.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { showToast } from "./modules/toast-ui.js";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const closeCollectionButton = document.querySelector(".btn-close-collection");
const EMPTY_MESSAGE_TEXT = "Aucune palette enregistree pour le moment";
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const MODERATION_SYNC_DELAY_MS = 12000;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
let shouldCloseCollectionOnViewerClose = false;
let moderationSyncTimeoutId = 0;
let isModerationSyncInProgress = false;

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
    onPublish: handlePublishPalette,
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

function clearModerationSyncLoop() {
  if (!moderationSyncTimeoutId) {
    return;
  }

  window.clearTimeout(moderationSyncTimeoutId);
  moderationSyncTimeoutId = 0;
}

function scheduleModerationSync() {
  clearModerationSyncLoop();

  if (!collectionPanel?.classList.contains("visible")) {
    return;
  }

  moderationSyncTimeoutId = window.setTimeout(() => {
    moderationSyncTimeoutId = 0;
    void syncModerationStatuses();
  }, MODERATION_SYNC_DELAY_MS);
}

function getPublishErrorMessage(error) {
  const apiMessage = error?.cause?.payload?.message;
  if (typeof apiMessage === "string" && apiMessage.trim()) {
    return apiMessage.trim();
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return "Publication echouee.";
}

function openAccountSettingsPanel() {
  document.querySelector(".btn-open-settings")?.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
  }));
}

async function handlePublishPalette(palette) {
  try {
    await publishPaletteToCommunityFeed(palette);
    showToast("Capture publiee. Moderation en cours.", {
      duration: 1800,
    });
    await loadCollectionUi();
    scheduleModerationSync();
  } catch (error) {
    if (error?.code === "ALREADY_PUBLISHED") {
      showToast("Capture deja publiee.", {
        duration: 1500,
      });
      return;
    }

    if (error?.code === "NOT_AUTHENTICATED" || error?.code === "AUTH_EXPIRED") {
      showToast("Connecte ton email dans Reglages > Compte.", {
        variant: "error",
        duration: 2000,
      });
      openAccountSettingsPanel();
      return;
    }

    showToast(getPublishErrorMessage(error), {
      variant: "error",
      duration: 2000,
    });
    console.error("Failed to publish palette:", error);
  }
}

async function syncModerationStatuses() {
  if (isModerationSyncInProgress) {
    return;
  }

  if (!collectionPanel?.classList.contains("visible")) {
    return;
  }

  isModerationSyncInProgress = true;

  try {
    const { updatedCount, pendingCount } = await syncPublishedPalettesModerationStatus();

    if (updatedCount > 0) {
      await loadCollectionUi();
    }

    if (pendingCount > 0) {
      scheduleModerationSync();
    }
  } catch (error) {
    console.error("Failed to sync moderation statuses:", error);
  } finally {
    isModerationSyncInProgress = false;
  }
}

export async function openCollectionPanel({
  paletteId,
  openPaletteViewer = false,
  closeCollectionOnViewerClose = false,
} = {}) {
  if (!collectionPanel || !collectionGrid) {
    return false;
  }

  shouldCloseCollectionOnViewerClose = false;
  closePaletteViewerOverlay();
  const settingsPanel = document.querySelector(".settings-panel");
  settingsPanel?.classList.remove("visible");
  settingsPanel?.setAttribute("aria-hidden", "true");
  if (settingsPanel) {
    settingsPanel.hidden = true;
  }
  collectionPanel.classList.add("visible");
  await loadCollectionUi();
  void syncModerationStatuses();

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
      shouldCloseCollectionOnViewerClose = Boolean(closeCollectionOnViewerClose);
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

  subscribePaletteViewerOverlayClose(() => {
    if (!shouldCloseCollectionOnViewerClose) {
      return;
    }

    shouldCloseCollectionOnViewerClose = false;
    clearModerationSyncLoop();
    collectionPanel.classList.remove("visible");
  });

  closeCollectionButton.addEventListener("click", () => {
    shouldCloseCollectionOnViewerClose = false;
    clearModerationSyncLoop();
    closePaletteViewerOverlay();
    collectionPanel.classList.remove("visible");
  });
}

bindCollectionUiEvents();
