import { deletePalette, getSavedPalettes } from "./palette-storage.js";
import {
  getCurrentCommunitySession,
  getPalettePublicationAction,
  publishPaletteToCommunityFeed,
  syncPublishedPalettesModerationStatus,
  unpublishPaletteFromCommunityFeed,
} from "./community-service.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import { createPaletteCard } from "./modules/collection/palette-card.js";
import {
  closePaletteViewerOverlay,
  openPaletteViewerOverlay,
  refreshPaletteViewerOverlay,
  subscribePaletteViewerOverlayClose,
} from "./modules/collection/palette-viewer-overlay.js";
import {
  disposePalettePreviewPolaroidAsset,
  exportPalettePolaroidImage,
  getPalettePreviewPolaroidAsset,
  hasPaletteMasterPhoto,
  sharePalettePolaroidImage,
} from "./modules/collection/palette-preview-assets.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { clientLog } from "./modules/client-log.js";
import { formatErrorDetails } from "./modules/error-format.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosing,
} from "./modules/panels/panel-manager.js";
import { showToast, showUndoToast } from "./modules/toast-ui.js";
import { openLoginPanel } from "./login-ui.js";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const EMPTY_MESSAGE_TEXT =
  "Aucune capture pour le moment.\nFermez ce panneau et appuyez sur le bouton central pour capturer votre premiere palette !";
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const MODERATION_SYNC_DELAY_MS = 12000;
const PUBLICATION_ACTIONS = Object.freeze({
  publish: Object.freeze({
    run: publishPaletteToCommunityFeed,
    authMessage: "Connecte ton email pour publier.",
    successMessage: "Capture publiée. Modération en cours.",
    alreadyDoneCode: "ALREADY_PUBLISHED",
    alreadyDoneMessage: "Capture déjà publiée.",
    failureMessage: "Publication échouée.",
    shouldScheduleModerationSync: true,
    shouldReloadOnAlreadyDone: false,
  }),
  unpublish: Object.freeze({
    run: unpublishPaletteFromCommunityFeed,
    authMessage: "Connecte ton email pour dépublier.",
    successMessage: "Capture retirée de la grille publique.",
    alreadyDoneCode: "NOT_PUBLIC",
    alreadyDoneMessage: "Capture déjà retirée de la grille publique.",
    failureMessage: "Dépublication échouée.",
    shouldScheduleModerationSync: false,
    shouldReloadOnAlreadyDone: true,
  }),
});
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
let shouldCloseCollectionOnViewerClose = false;
let moderationSyncTimeoutId = 0;
let isModerationSyncInProgress = false;
let currentPalettes = [];

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: EMPTY_MESSAGE_TEXT,
  collapsedSessionIds,
  reloadCollectionUi: () => loadCollectionUi(),
});

function canSharePalette(palette) {
  return hasPaletteMasterPhoto(palette);
}

function canExportPalette(palette) {
  return hasPaletteMasterPhoto(palette);
}

function canPublishPalette(palette) {
  return getPalettePublicationAction(palette) === "unpublish" || hasPaletteMasterPhoto(palette);
}

function getCurrentPalettes() {
  return [...currentPalettes];
}

function getCollectionCardByPaletteId(paletteId) {
  return /** @type {HTMLElement | null} */ (
    collectionGrid?.querySelector(`.palette-card[data-palette-id="${String(paletteId)}"]`)
  );
}

function insertPaletteAtIndex(palette, index) {
  if (currentPalettes.some((entry) => entry.id === palette.id)) {
    return;
  }

  const safeIndex = Math.max(0, Math.min(index, currentPalettes.length));
  currentPalettes = [
    ...currentPalettes.slice(0, safeIndex),
    palette,
    ...currentPalettes.slice(safeIndex),
  ];
}

async function handleExportPalette(palette) {
  const exported = await exportPalettePolaroidImage(palette);
  showToast(exported ? "Palette exportée" : "Export échoué", {
    variant: exported ? "default" : "error",
    duration: exported ? 1400 : 1800,
  });
}

async function handleSharePalette(palette) {
  const result = await sharePalettePolaroidImage(palette);

  if (result.status === "shared") {
    showToast("Palette partagee", {
      duration: 1400,
    });
    return;
  }

  if (result.status === "cancelled") {
    return;
  }

  if (result.status === "unsupported") {
    const exported = await exportPalettePolaroidImage(palette);
    showToast(exported ? "Partage indisponible, export lance" : "Partage indisponible", {
      variant: exported ? "default" : "error",
      duration: exported ? 1800 : 2000,
    });
    return;
  }

  showToast("Partage échoué", {
    variant: "error",
    duration: 1800,
  });
}

async function handleDeletePalette(palette) {
  if (pendingDeletionIds.has(palette.id)) {
    return;
  }

  const card = getCollectionCardByPaletteId(palette.id);
  if (!(card instanceof HTMLElement)) {
    return;
  }

  pendingDeletionIds.add(palette.id);
  const snapshot = cardLifecycle.takeCardPositionSnapshot(card);
  const removedIndex = currentPalettes.findIndex((entry) => entry.id === palette.id);

  card.remove();
  cardLifecycle.syncSessionStateFromCardContainer(snapshot.parent);
  currentPalettes = currentPalettes.filter((entry) => entry.id !== palette.id);

  showUndoToast("Palette supprimee", {
    duration: DELETE_UNDO_DURATION_MS,
    onUndo: () => {
      pendingDeletionIds.delete(palette.id);
      insertPaletteAtIndex(palette, removedIndex < 0 ? currentPalettes.length : removedIndex);
      cardLifecycle.restoreCardFromSnapshot(card, snapshot);
      refreshPaletteViewerOverlay({
        preferredPaletteId: palette.id,
        fallbackIndex: removedIndex < 0 ? 0 : removedIndex,
      });
    },
    onExpire: async () => {
      try {
        await deletePalette(palette.id);
        pendingDeletionIds.delete(palette.id);
        disposePalettePreviewPolaroidAsset(palette);
        cardLifecycle.ensureEmptyMessage();
      } catch (error) {
        console.error(`Failed to delete palette ${palette.id}:`, error);
        pendingDeletionIds.delete(palette.id);
        insertPaletteAtIndex(palette, removedIndex < 0 ? currentPalettes.length : removedIndex);
        cardLifecycle.restoreCardFromSnapshot(card, snapshot);
        showToast("Suppression échouée", {
          variant: "error",
          duration: 1800,
        });
        refreshPaletteViewerOverlay({
          preferredPaletteId: palette.id,
          fallbackIndex: removedIndex < 0 ? 0 : removedIndex,
        });
      }
    },
  });
}

function openCollectionPaletteViewer(paletteId) {
  const initialIndex = currentPalettes.findIndex((palette) => palette.id === paletteId);
  if (initialIndex < 0) {
    return;
  }

  openPaletteViewerOverlay({
    palettes: currentPalettes,
    initialIndex,
    getPalettes: getCurrentPalettes,
    getPreviewAsset: getPalettePreviewPolaroidAsset,
    getPublishAction: getPalettePublicationAction,
    canShare: canSharePalette,
    canExport: canExportPalette,
    canPublish: canPublishPalette,
    canDelete: () => true,
    onShare: handleSharePalette,
    onExport: handleExportPalette,
    onPublish: (palette) => handlePublishPalette(palette, getPalettePublicationAction(palette)),
    onDelete: handleDeletePalette,
  });
}

function createCollectionPaletteCard(palette) {
  return createPaletteCard({
    palette,
    onOpenViewer: openCollectionPaletteViewer,
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
  let palettes;
  try {
    palettes = (await getSavedPalettes()).filter((palette) => !pendingDeletionIds.has(palette.id));
  } catch (error) {
    currentPalettes = [];
    clientLog("Failed to load palette collection.", {
      error: error?.name,
      message: error?.message,
    });
    collectionGrid.innerHTML = `<p class="empty-message">Erreur de chargement des palettes.</p>`;
    showToast("Impossible de charger la collection.", {
      variant: "error",
      duration: 3000,
      details: formatErrorDetails(error),
    });
    refreshPaletteViewerOverlay();
    return;
  }

  currentPalettes = palettes;
  collectionGrid.innerHTML = "";

  if (palettes.length === 0) {
    collectionGrid.innerHTML = `<p class="empty-message">${EMPTY_MESSAGE_TEXT}</p>`;
    refreshPaletteViewerOverlay();
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

  refreshPaletteViewerOverlay();
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

function getPublicationErrorMessage(error, fallbackMessage) {
  const apiMessage = error?.cause?.payload?.message;
  if (typeof apiMessage === "string" && apiMessage.trim()) {
    return apiMessage.trim();
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function getPublicationActionConfig(action) {
  return PUBLICATION_ACTIONS[action] ?? PUBLICATION_ACTIONS.publish;
}

async function handlePublishPalette(palette, action = "publish") {
  const actionConfig = getPublicationActionConfig(action);

  if (!getCurrentCommunitySession()?.token) {
    showToast(actionConfig.authMessage, {
      variant: "error",
      duration: 3500,
      actionLabel: "Connexion",
      onAction: () => {
        closePaletteViewerOverlay();
        openLoginPanel();
      },
    });
    return;
  }

  try {
    await actionConfig.run(palette);
    showToast(actionConfig.successMessage, {
      duration: 1800,
    });

    await loadCollectionUi();

    if (actionConfig.shouldScheduleModerationSync) {
      scheduleModerationSync();
    }
  } catch (error) {
    if (error?.code === actionConfig.alreadyDoneCode) {
      showToast(actionConfig.alreadyDoneMessage, {
        duration: 1500,
      });

      if (actionConfig.shouldReloadOnAlreadyDone) {
        await loadCollectionUi();
      }

      return;
    }

    if (error?.code === "NOT_AUTHENTICATED" || error?.code === "AUTH_EXPIRED") {
      showToast(actionConfig.authMessage, {
        variant: "error",
        duration: 2000,
      });
      openLoginPanel();
      return;
    }

    clientLog("Failed to update palette publication.", {
      action,
      code: error?.code,
      message: error?.message,
      status: error?.status,
    });
    showToast(getPublicationErrorMessage(error, actionConfig.failureMessage), {
      variant: "error",
      duration: 4000,
      details: formatErrorDetails(error),
    });
    console.error("Failed to update palette publication:", error);
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

/**
 * @param {object} [options]
 * @param {number | string | null} [options.paletteId]
 * @param {boolean} [options.openPaletteViewer]
 * @param {boolean} [options.closeCollectionOnViewerClose]
 */
export async function openCollectionPanel({
  paletteId,
  openPaletteViewer = false,
  closeCollectionOnViewerClose = false,
} = {}) {
  if (!collectionPanel || !collectionGrid) {
    return false;
  }

  shouldCloseCollectionOnViewerClose = false;
  openSharedPanel("collection");
  await loadCollectionUi();
  void syncModerationStatuses();

  if (paletteId === undefined || paletteId === null) {
    return true;
  }

  const paletteIdString = String(paletteId);
  const targetCard = /** @type {HTMLElement[]} */ ([
    ...collectionGrid.querySelectorAll(".palette-card"),
  ]).find((card) => card.dataset.paletteId === paletteIdString);

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
  if (!collectionPanel || !collectionGrid || !viewCollectionButton) {
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
    closeSharedPanel("collection");
  });

  subscribeSharedPanelClosing("collection", () => {
    shouldCloseCollectionOnViewerClose = false;
    clearModerationSyncLoop();
    closePaletteViewerOverlay();
  });
}

bindCollectionUiEvents();
