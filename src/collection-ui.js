import { buildCommunityUrl } from "./config.js";
import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import {
  enqueueCommunityDeletionCleanupRetry,
  flushCommunityDeletionCleanupOutbox,
  initializeCommunityDeletionCleanupOutbox,
} from "./community-delete-outbox.js";
import { deletePalette, getSavedPaletteById, getSavedPalettes } from "./palette-storage.js";
import {
  cleanupPaletteRemoteCatchForDeletion,
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
import {
  areAllCollectionSessionsCollapsed,
  buildCollectionPanelTitle,
  getCollectionSessionIds,
  toggleAllCollectionSessions,
} from "./modules/collection/panel-state.js";
import { createErrorToastOptions, reportAppError } from "./modules/error-reporting.js";
import { isIOSDevice } from "./modules/platform.js";
import {
  openSharedPanel,
  subscribeSharedPanelClosing,
} from "./modules/panels/panel-manager.js";
import { showToast, showUndoToast } from "./modules/toast-ui.js";
import { openLoginPanel } from "./login-ui.js";

export const PALETTE_DELETED_EVENT = "paletcam:palette-deleted";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const collectionViewListButton = document.getElementById("collectionViewListButton");
const collectionViewGridButton = document.getElementById("collectionViewGridButton");
const collectionCollapseAllButton = document.getElementById("collectionCollapseAllButton");
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
let moderationSyncTimeoutId = 0;
let isModerationSyncInProgress = false;
let currentPalettes = [];
let currentCollectionViewMode = getAppSettings().collectionViewMode;

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
  return hasPaletteMasterPhoto(palette) && !isIOSDevice();
}

function isRalCapture(palette) {
  return palette?.captureMode === "ral";
}

function canPublishPalette(palette) {
  if (isRalCapture(palette)) {
    return false;
  }

  return getPalettePublicationAction(palette) === "unpublish" || hasPaletteMasterPhoto(palette);
}

function getCurrentPalettes() {
  return [...currentPalettes];
}

function isPalettePendingDeletion(paletteId) {
  return pendingDeletionIds.has(Number(paletteId));
}

function getCurrentDayGroups() {
  return groupPalettesByDay(currentPalettes);
}

function setCollectionPanelTitle(title) {
  if (!collectionPanel) {
    return;
  }

  collectionPanel.panelTitle = title;
  collectionPanel.setAttribute("panel-title", title);
}

function syncCollectionHeaderControls(dayGroups = getCurrentDayGroups()) {
  const isListView = currentCollectionViewMode === "list";
  const sessionIds = getCollectionSessionIds(dayGroups);
  const hasSessions = isListView && sessionIds.length > 0;
  const areAllSessionsCollapsed = areAllCollectionSessionsCollapsed(dayGroups, collapsedSessionIds);
  const collapseAllLabel = areAllSessionsCollapsed ? "déplier" : "collapser";

  if (collectionViewListButton instanceof HTMLButtonElement) {
    const isActive = isListView;
    collectionViewListButton.setAttribute("aria-pressed", String(isActive));
    collectionViewListButton.classList.toggle("is-active", isActive);
  }

  if (collectionViewGridButton instanceof HTMLButtonElement) {
    const isActive = !isListView;
    collectionViewGridButton.setAttribute("aria-pressed", String(isActive));
    collectionViewGridButton.classList.toggle("is-active", isActive);
  }

  if (collectionCollapseAllButton instanceof HTMLButtonElement) {
    collectionCollapseAllButton.hidden = !isListView;
    collectionCollapseAllButton.disabled = !hasSessions;
    collectionCollapseAllButton.textContent = collapseAllLabel;
    collectionCollapseAllButton.setAttribute("aria-label", collapseAllLabel);
  }
}

function syncCollectionPanelChrome(dayGroups = getCurrentDayGroups()) {
  setCollectionPanelTitle(buildCollectionPanelTitle(currentPalettes.length));
  syncCollectionHeaderControls(dayGroups);
}

function getCollectionCardByPaletteId(paletteId) {
  return /** @type {HTMLElement | null} */ (
    collectionGrid?.querySelector(`.palette-card[data-palette-id="${String(paletteId)}"]`)
  );
}

function syncCollectionUiAfterPaletteRemoval() {
  if (collectionPanel?.classList.contains("visible")) {
    renderCollectionUi(currentPalettes);
    return;
  }

  syncCollectionPanelChrome();
}

function dispatchPaletteDeletedEvent(paletteId) {
  window.dispatchEvent(new CustomEvent(PALETTE_DELETED_EVENT, {
    detail: { paletteId },
  }));
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
  const snapshot = card instanceof HTMLElement
    ? cardLifecycle.takeCardPositionSnapshot(card)
    : null;
  const removedIndex = currentPalettes.findIndex((entry) => entry.id === palette.id);
  const shouldTrackCollectionState = removedIndex >= 0;

  pendingDeletionIds.add(palette.id);

  if (card instanceof HTMLElement && snapshot) {
    card.remove();
    cardLifecycle.syncSessionStateFromCardContainer(snapshot.parent);
  }

  if (shouldTrackCollectionState) {
    currentPalettes = currentPalettes.filter((entry) => entry.id !== palette.id);
    syncCollectionUiAfterPaletteRemoval();
  }

  showUndoToast("Palette supprimee", {
    duration: DELETE_UNDO_DURATION_MS,
    onUndo: () => {
      pendingDeletionIds.delete(palette.id);

      if (shouldTrackCollectionState) {
        insertPaletteAtIndex(palette, removedIndex < 0 ? currentPalettes.length : removedIndex);
      }

      if (card instanceof HTMLElement && snapshot) {
        cardLifecycle.restoreCardFromSnapshot(card, snapshot);
      } else if (shouldTrackCollectionState) {
        syncCollectionUiAfterPaletteRemoval();
      }

      if (shouldTrackCollectionState) {
        syncCollectionPanelChrome();
      }

      refreshPaletteViewerOverlay({
        preferredPaletteId: palette.id,
        fallbackIndex: removedIndex < 0 ? 0 : removedIndex,
      });
    },
    onExpire: async () => {
      const remoteCleanupPromise = cleanupPaletteRemoteCatchForDeletion(palette);

      try {
        const [deleteResult, remoteCleanupResult] = await Promise.allSettled([
          deletePalette(palette.id),
          remoteCleanupPromise,
        ]);

        if (deleteResult.status === "rejected") {
          throw deleteResult.reason;
        }

        pendingDeletionIds.delete(palette.id);
        disposePalettePreviewPolaroidAsset(palette);
        if (card instanceof HTMLElement) {
          cardLifecycle.ensureEmptyMessage();
        } else if (shouldTrackCollectionState) {
          syncCollectionUiAfterPaletteRemoval();
        }
        dispatchPaletteDeletedEvent(palette.id);

        if (remoteCleanupResult.status === "fulfilled") {
          const wasQueued = enqueueDeleteRemoteCleanupRetry(remoteCleanupResult.value, palette);
          notifyDeleteRemoteCleanupIssue(remoteCleanupResult.value, { wasQueued });
        } else {
          const fallbackResult = {
            attempted: true,
            error: remoteCleanupResult.reason,
            remoteCatchId: String(palette?.remoteCatchId || "").trim(),
            status: "failed",
            success: false,
          };
          const wasQueued = enqueueDeleteRemoteCleanupRetry(fallbackResult, palette);
          notifyDeleteRemoteCleanupIssue(fallbackResult, { wasQueued });
        }
      } catch (error) {
        reportAppError(error, {
          logMessage: "Failed to delete palette.",
          context: { paletteId: palette.id },
          consoleMessage: `Failed to delete palette ${palette.id}:`,
        });
        pendingDeletionIds.delete(palette.id);
        if (shouldTrackCollectionState || collectionPanel?.classList.contains("visible")) {
          await loadCollectionUi();
        }
        showToast(
          "Suppression échouée",
          createErrorToastOptions(error, {
            variant: "error",
            duration: 1800,
          }),
        );
        refreshPaletteViewerOverlay({
          preferredPaletteId: palette.id,
          fallbackIndex: removedIndex < 0 ? 0 : removedIndex,
        });
      }
    },
  });
}

function enqueueDeleteRemoteCleanupRetry(result, palette) {
  if (!result || result.success) {
    return false;
  }

  const remoteCatchId = String(result?.remoteCatchId || palette?.remoteCatchId || "").trim();
  if (!remoteCatchId) {
    return false;
  }

  return enqueueCommunityDeletionCleanupRetry({ remoteCatchId });
}

function notifyDeleteRemoteCleanupIssue(result, { wasQueued = false } = {}) {
  if (!result || result.success) {
    return;
  }

  reportAppError(result?.error, {
    logMessage: "Failed to clean up palette publication during delete.",
    includeConsole: false,
    context: {
      remoteCatchId: result?.remoteCatchId,
      status: result?.status,
    },
  });

  let message = result.status === "authentication_required"
    ? "Capture supprimée localement, mais la publication n'a pas pu être retirée de la communauté."
    : "Capture supprimée localement, mais le retrait de la communauté a échoué.";
  let variant = "error";

  if (wasQueued) {
    message = result.status === "authentication_required"
      ? "Capture supprimée localement. La dépublication sera réessayée automatiquement après reconnexion."
      : "Capture supprimée localement. Le retrait de la communauté sera réessayé automatiquement.";
    variant = "default";
  }

  showToast(
    message,
    createErrorToastOptions(result.error, {
      variant,
      duration: 4200,
    }),
  );
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
    scrollRoot: collectionPanel?.shadowRoot?.querySelector(".panel-shell") ?? null,
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
      } else {
        collapsedSessionIds.delete(sessionId);
      }

      syncCollectionHeaderControls();
    },
    sessionRevealDurationMs: SESSION_REVEAL_DURATION_MS,
    sessionRevealStaggerMs: SESSION_REVEAL_STAGGER_MS,
    viewMode: currentCollectionViewMode,
  });
}

function pruneUnavailableCollapsedSessions(dayGroups) {
  const availableSessionIds = new Set(getCollectionSessionIds(dayGroups));

  [...collapsedSessionIds].forEach((sessionId) => {
    if (!availableSessionIds.has(sessionId)) {
      collapsedSessionIds.delete(sessionId);
    }
  });
}

function renderCollectionUi(palettes) {
  currentPalettes = palettes;
  collectionGrid.innerHTML = "";
  collectionGrid.dataset.viewMode = currentCollectionViewMode;

  if (palettes.length === 0) {
    collectionGrid.innerHTML = `<p class="empty-message">${EMPTY_MESSAGE_TEXT}</p>`;
    syncCollectionPanelChrome([]);
    refreshPaletteViewerOverlay();
    return;
  }

  const dayGroups = groupPalettesByDay(palettes);
  pruneUnavailableCollapsedSessions(dayGroups);
  syncCollectionPanelChrome(dayGroups);

  dayGroups.forEach((dayGroup) => {
    collectionGrid.appendChild(createCollectionDayGroup(dayGroup));
  });

  refreshPaletteViewerOverlay();
}

async function loadCollectionUi() {
  try {
    const palettes = (await getSavedPalettes()).filter((palette) => !pendingDeletionIds.has(palette.id));
    renderCollectionUi(palettes);
  } catch (error) {
    currentPalettes = [];
    collectionGrid.innerHTML = `<p class="empty-message">Erreur de chargement des palettes.</p>`;
    collectionGrid.dataset.viewMode = currentCollectionViewMode;
    syncCollectionPanelChrome([]);
    reportAppError(error, {
      logMessage: "Failed to load palette collection.",
    });
    showToast(
      "Impossible de charger la collection.",
      createErrorToastOptions(error, {
        variant: "error",
        duration: 3000,
      }),
    );
    refreshPaletteViewerOverlay();
  }
}

function handleCollectionViewModeChange(nextViewMode) {
  if (nextViewMode === currentCollectionViewMode) {
    syncCollectionHeaderControls();
    return;
  }

  currentCollectionViewMode = nextViewMode;

  if (collectionGrid) {
    collectionGrid.dataset.viewMode = currentCollectionViewMode;
  }

  if (!collectionPanel?.classList.contains("visible")) {
    syncCollectionPanelChrome();
    return;
  }

  renderCollectionUi(currentPalettes);
}

function handleCollectionSettingsChange(settings) {
  handleCollectionViewModeChange(settings.collectionViewMode);
}

function handleCollapseAllSessions() {
  const dayGroups = getCurrentDayGroups();

  if (!toggleAllCollectionSessions(dayGroups, collapsedSessionIds)) {
    syncCollectionHeaderControls(dayGroups);
    return;
  }

  renderCollectionUi(currentPalettes);
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
    const toastOptions = {
      duration: 1800,
    };
    if (action === 'publish') {
      toastOptions.actionLabel = 'my catches';
      toastOptions.onAction = () => {
        window.open(buildCommunityUrl("/my/catches"));
      };
    }
    showToast(actionConfig.successMessage, toastOptions);

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

    reportAppError(error, {
      logMessage: "Failed to update palette publication.",
      context: { action },
    });
    showToast(
      getPublicationErrorMessage(error, actionConfig.failureMessage),
      createErrorToastOptions(error, {
        variant: "error",
        duration: 4000,
      }),
    );
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
    reportAppError(error, {
      logMessage: "Failed to sync moderation statuses.",
      includeClientLog: false,
    });
  } finally {
    isModerationSyncInProgress = false;
  }
}

export async function openCollectionPanel() {
  if (!collectionPanel || !collectionGrid) {
    return false;
  }

  openSharedPanel("collection");
  await loadCollectionUi();
  void flushCommunityDeletionCleanupOutbox();
  void syncModerationStatuses();
  return true;
}

/**
 * Opens the palette viewer overlay directly for a single palette,
 * without opening the collection panel first.
 * @param {number | string} paletteId
 * @returns {Promise<"opened" | "missing" | "pending-delete">}
 */
export async function openDirectPaletteViewer(paletteId) {
  if (isPalettePendingDeletion(paletteId)) {
    return "pending-delete";
  }

  const palette = await getSavedPaletteById(paletteId);
  if (!palette) {
    return "missing";
  }

  if (isPalettePendingDeletion(palette.id)) {
    return "pending-delete";
  }

  openPaletteViewerOverlay({
    palettes: [palette],
    initialIndex: 0,
    getPalettes: () => (isPalettePendingDeletion(palette.id) ? [] : [palette]),
    getPreviewAsset: getPalettePreviewPolaroidAsset,
    getPublishAction: getPalettePublicationAction,
    canShare: canSharePalette,
    canExport: canExportPalette,
    canPublish: canPublishPalette,
    canDelete: () => true,
    onShare: handleSharePalette,
    onExport: handleExportPalette,
    onPublish: (p) => handlePublishPalette(p, getPalettePublicationAction(p)),
    onDelete: handleDeletePalette,
  });
  return "opened";
}

function bindCollectionUiEvents() {
  if (!collectionPanel || !collectionGrid) {
    return;
  }

  viewCollectionButton?.addEventListener("click", async () => {
    await openCollectionPanel();
  });

  collectionViewListButton?.addEventListener("click", () => {
    updateAppSettings({ collectionViewMode: "list" });
  });

  collectionViewGridButton?.addEventListener("click", () => {
    updateAppSettings({ collectionViewMode: "grid" });
  });

  collectionCollapseAllButton?.addEventListener("click", () => {
    handleCollapseAllSessions();
  });

  subscribeSharedPanelClosing("collection", () => {
    clearModerationSyncLoop();
    closePaletteViewerOverlay();
  });

  subscribeAppSettings(handleCollectionSettingsChange);
  syncCollectionPanelChrome();
}

initializeCommunityDeletionCleanupOutbox();
bindCollectionUiEvents();
