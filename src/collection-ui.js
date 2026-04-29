import { buildCommunityUrl } from "./config.js";
import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import { t } from "./i18n.js";
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
import { createPaletteCard, createSwatchCard } from "./modules/collection/palette-card.js";
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
const collectionViewSwatchButton = document.getElementById("collectionViewSwatchButton");
const collectionCollapseAllButton = document.getElementById("collectionCollapseAllButton");
const collectionFilterPublishedButton = document.getElementById("collectionFilterPublishedButton");
const collectionSelectionBar = document.getElementById("collectionSelectionBar");
const collectionSelectionCount = document.getElementById("collectionSelectionCount");
const collectionSelectionCancel = document.getElementById("collectionSelectionCancel");
const collectionSelectionDelete = document.getElementById("collectionSelectionDelete");
const collectionSelectionExport = document.getElementById("collectionSelectionExport");
const collectionSelectionPublish = document.getElementById("collectionSelectionPublish");
const collectionSelectionUnpublish = document.getElementById("collectionSelectionUnpublish");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const MODERATION_SYNC_DELAY_MS = 12000;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
const selectedIds = new Set();
let moderationSyncTimeoutId = 0;
let isModerationSyncInProgress = false;
let currentPalettes = [];
let currentCollectionViewMode = getAppSettings().collectionViewMode;
let currentLocale = getAppSettings().locale;
let currentPolaroidFooterLabel = getAppSettings().polaroidFooterLabel;
let currentFilter = null;
let isSelectMode = false;
let longPressTimer = null;
let longPressStartPos = null;

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: () => t("collection.empty"),
  collapsedSessionIds,
  reloadCollectionUi: () => loadCollectionUi(),
});

function getPublicationActions() {
  return Object.freeze({
    publish: Object.freeze({
      run: publishPaletteToCommunityFeed,
      authMessage: t("collection.publish.auth"),
      successMessage: t("collection.publish.success"),
      alreadyDoneCode: "ALREADY_PUBLISHED",
      alreadyDoneMessage: t("collection.publish.already"),
      failureMessage: t("collection.publish.failure"),
      shouldScheduleModerationSync: true,
      shouldReloadOnAlreadyDone: false,
    }),
    unpublish: Object.freeze({
      run: unpublishPaletteFromCommunityFeed,
      authMessage: t("collection.unpublish.auth"),
      successMessage: t("collection.unpublish.success"),
      alreadyDoneCode: "NOT_PUBLIC",
      alreadyDoneMessage: t("collection.unpublish.already"),
      failureMessage: t("collection.unpublish.failure"),
      shouldScheduleModerationSync: false,
      shouldReloadOnAlreadyDone: true,
    }),
  });
}

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

function getDisplayPalettes() {
  if (currentFilter === "published") {
    return currentPalettes.filter((p) => getPalettePublicationAction(p) === "unpublish");
  }
  return currentPalettes;
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
  const isSwatchView = currentCollectionViewMode === "swatch";
  const sessionIds = getCollectionSessionIds(dayGroups);
  const hasSessions = isListView && sessionIds.length > 0;
  const areAllSessionsCollapsed = areAllCollectionSessionsCollapsed(dayGroups, collapsedSessionIds);
  const collapseAllLabel = areAllSessionsCollapsed
    ? t("collection.expandAll")
    : t("collection.collapseAll");

  if (collectionViewListButton instanceof HTMLButtonElement) {
    collectionViewListButton.setAttribute("aria-pressed", String(isListView));
    collectionViewListButton.classList.toggle("is-active", isListView);
  }

  if (collectionViewGridButton instanceof HTMLButtonElement) {
    const isActive = currentCollectionViewMode === "grid";
    collectionViewGridButton.setAttribute("aria-pressed", String(isActive));
    collectionViewGridButton.classList.toggle("is-active", isActive);
  }

  if (collectionViewSwatchButton instanceof HTMLButtonElement) {
    collectionViewSwatchButton.setAttribute("aria-pressed", String(isSwatchView));
    collectionViewSwatchButton.classList.toggle("is-active", isSwatchView);
  }

  if (collectionCollapseAllButton instanceof HTMLButtonElement) {
    collectionCollapseAllButton.hidden = !isListView;
    collectionCollapseAllButton.disabled = !hasSessions;
    collectionCollapseAllButton.textContent = collapseAllLabel;
    collectionCollapseAllButton.setAttribute("aria-label", collapseAllLabel);
  }

  if (collectionFilterPublishedButton instanceof HTMLButtonElement) {
    const publishedCount = currentPalettes.filter(
      (p) => getPalettePublicationAction(p) === "unpublish",
    ).length;
    const isFilterActive = currentFilter === "published";
    collectionFilterPublishedButton.hidden = publishedCount === 0 && !isFilterActive;
    collectionFilterPublishedButton.classList.toggle("is-active", isFilterActive);
    collectionFilterPublishedButton.dataset.count = String(publishedCount);
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
  showToast(exported ? t("collection.exportSuccess") : t("collection.exportFailed"), {
    variant: exported ? "default" : "error",
    duration: exported ? 1400 : 1800,
  });
}

async function handleSharePalette(palette) {
  const result = await sharePalettePolaroidImage(palette);

  if (result.status === "shared") {
    showToast(t("collection.shareSuccess"), {
      duration: 1400,
    });
    return;
  }

  if (result.status === "cancelled") {
    return;
  }

  if (result.status === "unsupported") {
    const exported = await exportPalettePolaroidImage(palette);
    showToast(
      exported
        ? t("collection.shareUnsupportedWithExport")
        : t("collection.shareUnsupported"),
      {
        variant: exported ? "default" : "error",
        duration: exported ? 1800 : 2000,
      },
    );
    return;
  }

  showToast(t("collection.shareFailed"), {
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

  showUndoToast(t("collection.deleteUndo"), {
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
          t("collection.deleteFailed"),
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
    ? t("collection.deleteRemoteCleanupAuth")
    : t("collection.deleteRemoteCleanupFailed");
  let variant = "error";

  if (wasQueued) {
    message = result.status === "authentication_required"
      ? t("collection.deleteRemoteCleanupAuthQueued")
      : t("collection.deleteRemoteCleanupFailedQueued");
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
  const displayPalettes = getDisplayPalettes();
  const initialIndex = displayPalettes.findIndex((palette) => palette.id === paletteId);
  if (initialIndex < 0) {
    return;
  }

  openPaletteViewerOverlay({
    palettes: displayPalettes,
    initialIndex,
    getPalettes: getDisplayPalettes,
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

function createCollectionSwatchCard(palette) {
  return createSwatchCard({
    palette,
    onOpenViewer: openCollectionPaletteViewer,
  });
}

function getCardCreator() {
  return currentCollectionViewMode === "swatch"
    ? createCollectionSwatchCard
    : createCollectionPaletteCard;
}

function createCollectionDayGroup(dayGroup) {
  return renderDayGroup({
    dayGroup,
    createPaletteCard: getCardCreator(),
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

function syncSelectModeAfterRender() {
  if (!isSelectMode) {
    return;
  }

  collectionGrid.classList.add("is-select-mode");

  selectedIds.forEach((paletteId) => {
    const card = getCollectionCardByPaletteId(paletteId);
    if (card) {
      card.classList.add("is-selected");
    } else {
      selectedIds.delete(paletteId);
    }
  });

  syncSelectionBar();
}

function renderCollectionUi(palettes) {
  currentPalettes = palettes;
  const displayPalettes = getDisplayPalettes();
  collectionGrid.innerHTML = "";
  collectionGrid.dataset.viewMode = currentCollectionViewMode;

  if (displayPalettes.length === 0) {
    collectionGrid.innerHTML = `<p class="empty-message">${t("collection.empty")}</p>`;
    syncCollectionPanelChrome([]);
    refreshPaletteViewerOverlay();
    return;
  }

  const dayGroups = groupPalettesByDay(displayPalettes);
  pruneUnavailableCollapsedSessions(dayGroups);
  syncCollectionPanelChrome(dayGroups);

  dayGroups.forEach((dayGroup) => {
    collectionGrid.appendChild(createCollectionDayGroup(dayGroup));
  });

  syncSelectModeAfterRender();
  refreshPaletteViewerOverlay();
}

async function loadCollectionUi() {
  try {
    const palettes = (await getSavedPalettes()).filter((palette) => !pendingDeletionIds.has(palette.id));
    renderCollectionUi(palettes);
  } catch (error) {
    currentPalettes = [];
    collectionGrid.innerHTML = `<p class="empty-message">${t("collection.loadErrorInline")}</p>`;
    collectionGrid.dataset.viewMode = currentCollectionViewMode;
    syncCollectionPanelChrome([]);
    reportAppError(error, {
      logMessage: "Failed to load palette collection.",
    });
    showToast(
      t("collection.loadErrorToast"),
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
  const localeChanged = settings.locale !== currentLocale;
  currentLocale = settings.locale;

  if (settings.polaroidFooterLabel === currentPolaroidFooterLabel) {
    if (localeChanged) {
      if (collectionPanel?.classList.contains("visible")) {
        renderCollectionUi(currentPalettes);
        return;
      }

      syncCollectionPanelChrome();
      refreshPaletteViewerOverlay();
    }
    return;
  }

  currentPolaroidFooterLabel = settings.polaroidFooterLabel;
  currentPalettes.forEach((palette) => {
    disposePalettePreviewPolaroidAsset(palette);
  });

  if (collectionPanel?.classList.contains("visible")) {
    renderCollectionUi(currentPalettes);
    return;
  }

  refreshPaletteViewerOverlay();
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
  const publicationActions = getPublicationActions();
  return publicationActions[action] ?? publicationActions.publish;
}

async function handlePublishPalette(palette, action = "publish") {
  const actionConfig = getPublicationActionConfig(action);

  if (!getCurrentCommunitySession()?.token) {
    showToast(actionConfig.authMessage, {
      variant: "error",
      duration: 3500,
      actionLabel: t("login.verifyCode"),
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
      toastOptions.actionLabel = t("collection.publish.cta");
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

function syncSelectionBar() {
  if (!collectionSelectionBar) {
    return;
  }

  collectionSelectionBar.hidden = !isSelectMode;

  if (!isSelectMode) {
    return;
  }

  const count = selectedIds.size;

  if (collectionSelectionCount) {
    collectionSelectionCount.textContent = String(count);
  }

  const displayPalettes = getDisplayPalettes();
  const selected = displayPalettes.filter((p) => selectedIds.has(p.id));

  if (collectionSelectionDelete instanceof HTMLButtonElement) {
    collectionSelectionDelete.disabled = count === 0;
  }

  if (collectionSelectionExport instanceof HTMLButtonElement) {
    collectionSelectionExport.hidden = isIOSDevice();
    collectionSelectionExport.disabled = !selected.some(canExportPalette);
  }

  if (collectionSelectionPublish instanceof HTMLButtonElement) {
    collectionSelectionPublish.disabled = !selected.some(
      (p) => canPublishPalette(p) && getPalettePublicationAction(p) !== "unpublish",
    );
  }

  if (collectionSelectionUnpublish instanceof HTMLButtonElement) {
    collectionSelectionUnpublish.disabled = !selected.some(
      (p) => getPalettePublicationAction(p) === "unpublish",
    );
  }
}

function enterSelectMode(initialPaletteId = null) {
  isSelectMode = true;
  selectedIds.clear();

  collectionGrid?.classList.add("is-select-mode");

  if (initialPaletteId !== null) {
    selectedIds.add(initialPaletteId);
    const card = getCollectionCardByPaletteId(initialPaletteId);
    card?.classList.add("is-selected");
  }

  syncSelectionBar();
}

function exitSelectMode() {
  isSelectMode = false;
  selectedIds.clear();

  collectionGrid?.classList.remove("is-select-mode");
  collectionGrid?.querySelectorAll(".palette-card.is-selected").forEach((card) => {
    card.classList.remove("is-selected");
  });

  syncSelectionBar();
}

function clearLongPress() {
  if (longPressTimer) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressStartPos = null;
}

async function handleSelectionDelete() {
  const toDelete = getDisplayPalettes().filter((p) => selectedIds.has(p.id));
  exitSelectMode();
  for (const palette of toDelete) {
    await handleDeletePalette(palette);
  }
}

async function handleSelectionExport() {
  const toExport = getDisplayPalettes().filter(
    (p) => selectedIds.has(p.id) && canExportPalette(p),
  );
  exitSelectMode();
  for (const palette of toExport) {
    await handleExportPalette(palette);
  }
}

async function handleSelectionPublish() {
  if (!getCurrentCommunitySession()?.token) {
    showToast(t("collection.publish.auth"), {
      variant: "error",
      duration: 3500,
      actionLabel: t("login.verifyCode"),
      onAction: () => openLoginPanel(),
    });
    return;
  }

  const toPublish = getDisplayPalettes().filter(
    (p) => selectedIds.has(p.id) && canPublishPalette(p) && getPalettePublicationAction(p) !== "unpublish",
  );
  exitSelectMode();
  for (const palette of toPublish) {
    await handlePublishPalette(palette, "publish");
  }
}

async function handleSelectionUnpublish() {
  if (!getCurrentCommunitySession()?.token) {
    showToast(t("collection.unpublish.auth"), {
      variant: "error",
      duration: 3500,
      actionLabel: t("login.verifyCode"),
      onAction: () => openLoginPanel(),
    });
    return;
  }

  const toUnpublish = getDisplayPalettes().filter(
    (p) => selectedIds.has(p.id) && getPalettePublicationAction(p) === "unpublish",
  );
  exitSelectMode();
  for (const palette of toUnpublish) {
    await handlePublishPalette(palette, "unpublish");
  }
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

  collectionViewSwatchButton?.addEventListener("click", () => {
    updateAppSettings({ collectionViewMode: "swatch" });
  });

  collectionCollapseAllButton?.addEventListener("click", () => {
    handleCollapseAllSessions();
  });

  collectionFilterPublishedButton?.addEventListener("click", () => {
    currentFilter = currentFilter === "published" ? null : "published";
    if (isSelectMode) {
      exitSelectMode();
    }
    renderCollectionUi(currentPalettes);
  });

  collectionSelectionCancel?.addEventListener("click", () => {
    exitSelectMode();
  });

  collectionSelectionDelete?.addEventListener("click", () => {
    void handleSelectionDelete();
  });

  collectionSelectionExport?.addEventListener("click", () => {
    void handleSelectionExport();
  });

  collectionSelectionPublish?.addEventListener("click", () => {
    void handleSelectionPublish();
  });

  collectionSelectionUnpublish?.addEventListener("click", () => {
    void handleSelectionUnpublish();
  });

  collectionGrid?.addEventListener("pointerdown", (event) => {
    if (isSelectMode) {
      return;
    }

    const card = /** @type {HTMLElement} */ (event.target)?.closest?.(".palette-card");
    if (!card) {
      return;
    }

    longPressStartPos = { x: event.clientX, y: event.clientY };
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      longPressStartPos = null;
      const paletteId = Number(card.dataset.paletteId);
      if (!Number.isNaN(paletteId)) {
        enterSelectMode(paletteId);
      }
    }, 500);
  });

  collectionGrid?.addEventListener("pointermove", (event) => {
    if (!longPressTimer || !longPressStartPos) {
      return;
    }

    const dx = event.clientX - longPressStartPos.x;
    const dy = event.clientY - longPressStartPos.y;
    if (dx * dx + dy * dy > 64) {
      clearLongPress();
    }
  });

  collectionGrid?.addEventListener("pointerup", clearLongPress);
  collectionGrid?.addEventListener("pointercancel", clearLongPress);

  collectionGrid?.addEventListener("contextmenu", (event) => {
    if (isSelectMode || longPressTimer !== null) {
      event.preventDefault();
    }
  });

  collectionGrid?.addEventListener("click", (event) => {
    if (!isSelectMode) {
      return;
    }

    const card = /** @type {HTMLElement} */ (event.target)?.closest?.(".palette-card");
    if (!card) {
      return;
    }

    const paletteId = Number(card.dataset.paletteId);
    if (Number.isNaN(paletteId)) {
      return;
    }

    if (selectedIds.has(paletteId)) {
      selectedIds.delete(paletteId);
      card.classList.remove("is-selected");
    } else {
      selectedIds.add(paletteId);
      card.classList.add("is-selected");
    }

    syncSelectionBar();
  }, true);

  subscribeSharedPanelClosing("collection", () => {
    clearModerationSyncLoop();
    closePaletteViewerOverlay();
    exitSelectMode();
    currentFilter = null;
  });

  subscribeAppSettings(handleCollectionSettingsChange);
  syncCollectionPanelChrome();
}

initializeCommunityDeletionCleanupOutbox();
bindCollectionUiEvents();
