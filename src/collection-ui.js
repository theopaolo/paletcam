import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import {
  enqueueCommunityDeletionCleanupRetry,
  flushCommunityDeletionCleanupOutbox,
  initializeCommunityDeletionCleanupOutbox,
} from "./community-delete-outbox.js";
import {
  cleanupPaletteRemoteCatchForDeletion,
  getCurrentCommunitySession,
  getPalettePublicationAction,
  publishPaletteToCommunityFeed,
  syncPublishedPalettesModerationStatus,
  unpublishPaletteFromCommunityFeed,
} from "./community-service.js";
import { buildCommunityUrl } from "./config.js";
import { t } from "./i18n.js";
import { openLoginPanel } from "./login-ui.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import { createPaletteCard, createSwatchCard } from "./modules/collection/palette-card.js";
import {
  disposePalettePreviewAsset,
  exportPalettePolaroidImage,
  getPaletteViewerPreviewAsset,
  hasPaletteMasterPhoto,
  sharePalettePolaroidImage,
} from "./modules/collection/palette-preview-assets.js";
import {
  closePaletteViewerOverlay,
  openPaletteViewerOverlay,
  refreshPaletteViewerOverlay,
} from "./modules/collection/palette-viewer-overlay.js";
import {
  areAllCollectionSessionsCollapsed,
  buildCollectionPanelTitle,
  getCollectionSessionIds,
  toggleAllCollectionSessions,
} from "./modules/collection/panel-state.js";
import { createDayContentVirtualizer } from "./modules/collection/day-virtualizer.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { applySelectionModeCardClick } from "./modules/collection/selection-mode.js";
import { clientLog } from "./modules/client-log.js";
import { createErrorToastOptions, reportAppError } from "./modules/error-reporting.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosing,
} from "./modules/panels/panel-manager.js";
import { isIOSDevice } from "./modules/platform.js";
import { dismissToast, showToast, showUndoToast } from "./modules/toast-ui.js";
import { deletePalette, getSavedPaletteById, getSavedPalettes } from "./palette-storage.js";

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
let currentFilter = null;
let isSelectMode = false;
let longPressTimer = null;
let longPressStartPos = null;
let suppressNextSelectionClick = false;
let activeDayVirtualizer = null;

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: () => t("collection.empty"),
  collapsedSessionIds,
  reloadCollectionUi: () => loadCollectionUi(),
});

function getPublicationActions() {
  return {
    publish: {
      run: publishPaletteToCommunityFeed,
      authMessage: t("collection.publish.auth"),
      successMessage: t("collection.publish.success"),
      alreadyDoneCode: "ALREADY_PUBLISHED",
      alreadyDoneMessage: t("collection.publish.already"),
      failureMessage: t("collection.publish.failure"),
      shouldScheduleModerationSync: true,
      shouldReloadOnAlreadyDone: false,
    },
    unpublish: {
      run: unpublishPaletteFromCommunityFeed,
      authMessage: t("collection.unpublish.auth"),
      successMessage: t("collection.unpublish.success"),
      alreadyDoneCode: "NOT_PUBLIC",
      alreadyDoneMessage: t("collection.unpublish.already"),
      failureMessage: t("collection.unpublish.failure"),
      shouldScheduleModerationSync: false,
      shouldReloadOnAlreadyDone: true,
    },
  };
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
  return groupPalettesByDay(getDisplayPalettes());
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
  window.dispatchEvent(
    new CustomEvent(PALETTE_DELETED_EVENT, {
      detail: { paletteId },
    }),
  );
}

function createDeleteRemoteCleanupFallbackResult(palette, error) {
  return {
    attempted: true,
    error,
    remoteCatchId: String(palette?.remoteCatchId || "").trim(),
    status: "failed",
    success: false,
  };
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
      exported ? t("collection.shareUnsupportedWithExport") : t("collection.shareUnsupported"),
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
  const snapshot =
    card instanceof HTMLElement ? cardLifecycle.takeCardPositionSnapshot(card) : null;
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
      const result = await commitPaletteDeletion(palette, {
        fallbackIndex: removedIndex,
      });
      if (!result.success) {
        return;
      }

      if (card instanceof HTMLElement) {
        cardLifecycle.ensureEmptyMessage();
      } else if (shouldTrackCollectionState) {
        syncCollectionUiAfterPaletteRemoval();
      }

      if (result.remoteCleanupResult) {
        notifyDeleteRemoteCleanupIssue(result.remoteCleanupResult, {
          wasQueued: result.wasRemoteCleanupQueued,
        });
      }
    },
  });
}

async function commitPaletteDeletion(palette, { fallbackIndex = -1, silent = false } = {}) {
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
    disposePalettePreviewAsset(palette);
    dispatchPaletteDeletedEvent(palette.id);

    const resolvedRemoteCleanupResult =
      remoteCleanupResult.status === "fulfilled"
        ? remoteCleanupResult.value
        : createDeleteRemoteCleanupFallbackResult(palette, remoteCleanupResult.reason);
    const wasRemoteCleanupQueued = enqueueDeleteRemoteCleanupRetry(
      resolvedRemoteCleanupResult,
      palette,
    );

    return {
      success: true,
      remoteCleanupResult: resolvedRemoteCleanupResult,
      wasRemoteCleanupQueued,
    };
  } catch (error) {
    reportAppError(error, {
      logMessage: "Failed to delete palette.",
      context: { paletteId: palette.id },
      consoleMessage: `Failed to delete palette ${palette.id}:`,
    });
    pendingDeletionIds.delete(palette.id);

    if (!silent && (fallbackIndex >= 0 || collectionPanel?.classList.contains("visible"))) {
      await loadCollectionUi();
    }

    if (!silent) {
      showToast(
        t("collection.deleteFailed"),
        createErrorToastOptions(error, {
          variant: "error",
          duration: 1800,
        }),
      );
    }

    refreshPaletteViewerOverlay({
      preferredPaletteId: palette.id,
      fallbackIndex: fallbackIndex < 0 ? 0 : fallbackIndex,
    });

    return {
      success: false,
      error,
    };
  }
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

  let message =
    result.status === "authentication_required"
      ? t("collection.deleteRemoteCleanupAuth")
      : t("collection.deleteRemoteCleanupFailed");
  let variant = "error";

  if (wasQueued) {
    message =
      result.status === "authentication_required"
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
  if (isSelectMode) {
    return;
  }

  const displayPalettes = getDisplayPalettes();
  const initialIndex = displayPalettes.findIndex((palette) => palette.id === paletteId);
  if (initialIndex < 0) {
    return;
  }

  openPaletteViewerOverlay({
    palettes: displayPalettes,
    initialIndex,
    getPalettes: getDisplayPalettes,
    getPreviewAsset: getPaletteViewerPreviewAsset,
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
    scrollRoot: collectionPanel?.shadowRoot?.querySelector(".panel-shell") ?? null,
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

  const availablePaletteIds = new Set(currentPalettes.map((palette) => palette.id));

  selectedIds.forEach((paletteId) => {
    if (!availablePaletteIds.has(paletteId)) {
      selectedIds.delete(paletteId);
      return;
    }

    const card = getCollectionCardByPaletteId(paletteId);
    if (card) {
      card.classList.add("is-selected");
    }
  });

  syncSelectionBar();
}

function applyCardSelectionState(card) {
  if (!isSelectMode) {
    return;
  }

  const rawId = card?.dataset?.paletteId;
  const paletteId = Number(rawId);
  if (!Number.isFinite(paletteId)) {
    return;
  }

  if (selectedIds.has(paletteId)) {
    card.classList.add("is-selected");
  }
}

function renderCollectionUi(palettes) {
  currentPalettes = palettes;
  const displayPalettes = getDisplayPalettes();

  activeDayVirtualizer?.destroy();
  activeDayVirtualizer = null;

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

  const scrollRoot = collectionPanel?.shadowRoot?.querySelector(".panel-shell") ?? null;
  activeDayVirtualizer = createDayContentVirtualizer({
    scrollRoot,
    onCardMount: applyCardSelectionState,
  });

  dayGroups.forEach((dayGroup) => {
    const dayRender = createCollectionDayGroup(dayGroup);
    collectionGrid.appendChild(dayRender.element);
    activeDayVirtualizer.register({
      element: dayRender.element,
      contentContainer: dayRender.contentContainer,
      mountContent: dayRender.mountContent,
      unmountContent: dayRender.unmountContent,
      dayGroup,
      viewMode: currentCollectionViewMode,
    });
  });

  syncSelectModeAfterRender();
  refreshPaletteViewerOverlay();
}

async function loadCollectionUi() {
  const startTime = performance.now();
  try {
    const fetchStartTime = performance.now();
    const fetchedPalettes = await getSavedPalettes();
    const fetchMs = performance.now() - fetchStartTime;

    const filterStartTime = performance.now();
    const palettes = fetchedPalettes.filter((palette) => !pendingDeletionIds.has(palette.id));
    const filterMs = performance.now() - filterStartTime;

    const renderStartTime = performance.now();
    renderCollectionUi(palettes);
    const renderMs = performance.now() - renderStartTime;

    clientLog("loadCollectionUi:success", {
      totalMs: Math.round(performance.now() - startTime),
      fetchMs: Math.round(fetchMs),
      filterMs: Math.round(filterMs),
      renderMs: Math.round(renderMs),
      fetchedCount: fetchedPalettes.length,
      displayedCount: palettes.length,
    });
  } catch (error) {
    clientLog("loadCollectionUi:error", {
      totalMs: Math.round(performance.now() - startTime),
      errorName: error?.name ?? "",
      errorMessage: error?.message ?? "",
    });
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

  if (settings.locale === currentLocale) {
    return;
  }

  currentLocale = settings.locale;

  if (collectionPanel?.classList.contains("visible")) {
    renderCollectionUi(currentPalettes);
    return;
  }

  syncCollectionPanelChrome();
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

function runPublicationAction(palette, action = "publish") {
  const actionConfig = getPublicationActionConfig(action);

  return actionConfig
    .run(palette)
    .then(() => ({
      actionConfig,
      status: "success",
    }))
    .catch((error) => {
      if (error?.code === actionConfig.alreadyDoneCode) {
        return {
          actionConfig,
          error,
          status: "already_done",
        };
      }

      if (error?.code === "NOT_AUTHENTICATED" || error?.code === "AUTH_EXPIRED") {
        return {
          actionConfig,
          error,
          status: "auth_required",
        };
      }

      return {
        actionConfig,
        error,
        status: "error",
      };
    });
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
        closeSharedPanel("collection");
        openLoginPanel();
      },
    });
    return;
  }

  const result = await runPublicationAction(palette, action);

  if (result.status === "success") {
    const toastOptions = {
      duration: 1800,
    };
    if (action === "publish") {
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

    return;
  }

  if (result.status === "already_done") {
    showToast(actionConfig.alreadyDoneMessage, {
      duration: 1500,
    });

    if (actionConfig.shouldReloadOnAlreadyDone) {
      await loadCollectionUi();
    }

    return;
  }

  if (result.status === "auth_required") {
    showToast(actionConfig.authMessage, {
      variant: "error",
      duration: 2000,
    });
    openLoginPanel();
    return;
  }

  reportAppError(result.error, {
    logMessage: "Failed to update palette publication.",
    context: { action },
  });
  showToast(
    getPublicationErrorMessage(result.error, actionConfig.failureMessage),
    createErrorToastOptions(result.error, {
      variant: "error",
      duration: 4000,
    }),
  );
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
    getPreviewAsset: getPaletteViewerPreviewAsset,
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

function enterSelectMode(initialPaletteId = null, { suppressNextClick = false } = {}) {
  isSelectMode = true;
  suppressNextSelectionClick = suppressNextClick;
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
  suppressNextSelectionClick = false;
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

function syncBulkDeleteUi(stagedDeletions) {
  syncCollectionUiAfterPaletteRemoval();

  if (stagedDeletions.length > 0) {
    refreshPaletteViewerOverlay({
      preferredPaletteId: stagedDeletions[0].palette.id,
      fallbackIndex: stagedDeletions[0].removedIndex < 0 ? 0 : stagedDeletions[0].removedIndex,
    });
  }
}

async function handleSelectionDelete() {
  const toDelete = getDisplayPalettes().filter((p) => selectedIds.has(p.id));
  exitSelectMode();
  if (toDelete.length === 0) {
    return;
  }

  const stagedDeletions = [];

  for (const palette of toDelete) {
    if (pendingDeletionIds.has(palette.id)) {
      continue;
    }

    const removedIndex = currentPalettes.findIndex((entry) => entry.id === palette.id);
    if (removedIndex < 0) {
      continue;
    }

    pendingDeletionIds.add(palette.id);
    currentPalettes = currentPalettes.filter((entry) => entry.id !== palette.id);
    stagedDeletions.push({ palette, removedIndex });
  }

  if (stagedDeletions.length === 0) {
    return;
  }

  syncBulkDeleteUi(stagedDeletions);

  showUndoToast(t("collection.bulk.deletePending", { count: stagedDeletions.length }), {
    duration: DELETE_UNDO_DURATION_MS,
    actionLabel: t("collection.select.cancel"),
    onUndo: () => {
      [...stagedDeletions].reverse().forEach(({ palette, removedIndex }) => {
        pendingDeletionIds.delete(palette.id);
        insertPaletteAtIndex(palette, removedIndex);
      });
      syncBulkDeleteUi(stagedDeletions);
    },
    onExpire: async () => {
      const results = await Promise.all(
        stagedDeletions.map(({ palette, removedIndex }) =>
          commitPaletteDeletion(palette, {
            fallbackIndex: removedIndex,
            silent: true,
          }),
        ),
      );
      const failedResults = results.filter((result) => !result.success);

      if (failedResults.length > 0) {
        await loadCollectionUi();
        showToast(
          t("collection.bulk.deleteFailed", { count: failedResults.length }),
          createErrorToastOptions(failedResults[0].error, {
            variant: "error",
            duration: 2200,
          }),
        );
      }

      results.forEach((result) => {
        if (!result.success || !result.remoteCleanupResult) {
          return;
        }

        notifyDeleteRemoteCleanupIssue(result.remoteCleanupResult, {
          wasQueued: result.wasRemoteCleanupQueued,
        });
      });
    },
  });
}

async function handleSelectionExport() {
  const toExport = getDisplayPalettes().filter((p) => selectedIds.has(p.id) && canExportPalette(p));
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
    (p) =>
      selectedIds.has(p.id) &&
      canPublishPalette(p) &&
      getPalettePublicationAction(p) !== "unpublish",
  );
  exitSelectMode();
  await handleSelectionPublicationAction("publish", toPublish);
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
  await handleSelectionPublicationAction("unpublish", toUnpublish);
}

async function handleSelectionPublicationAction(action, palettes) {
  if (palettes.length === 0) {
    return;
  }

  const actionConfig = getPublicationActionConfig(action);
  const pendingMessageKey = `collection.bulk.${action}Pending`;
  const successMessageKey = `collection.bulk.${action}Success`;
  const failureMessageKey = `collection.bulk.${action}Failed`;
  let isCancelled = false;
  let successCount = 0;
  let alreadyDoneCount = 0;
  let failureCount = 0;
  let authRequired = false;
  let firstFailure = null;
  let shouldReload = false;

  const toastId = showUndoToast(t(pendingMessageKey, { count: palettes.length }), {
    duration: 0,
    actionLabel: t("collection.select.cancel"),
    onUndo: () => {
      isCancelled = true;
    },
  });

  try {
    for (const palette of palettes) {
      if (isCancelled) {
        break;
      }

      const result = await runPublicationAction(palette, action);
      if (result.status === "success") {
        successCount += 1;
        shouldReload = true;
        continue;
      }

      if (result.status === "already_done") {
        alreadyDoneCount += 1;
        shouldReload = shouldReload || result.actionConfig.shouldReloadOnAlreadyDone;
        continue;
      }

      if (result.status === "auth_required") {
        authRequired = true;
        firstFailure = result.error;
        break;
      }

      if (!firstFailure) {
        firstFailure = result.error;
      }
      failureCount += 1;
    }
  } finally {
    dismissToast(toastId);
  }

  if (shouldReload) {
    await loadCollectionUi();
  }

  if (successCount > 0 && actionConfig.shouldScheduleModerationSync) {
    scheduleModerationSync();
  }

  if (authRequired) {
    showToast(actionConfig.authMessage, {
      variant: "error",
      duration: 2000,
    });
    openLoginPanel();
    return;
  }

  if (failureCount > 0) {
    reportAppError(firstFailure, {
      logMessage: "Failed to update palette publication in bulk.",
      context: { action, failureCount },
    });
    showToast(
      t(failureMessageKey, { count: failureCount }),
      createErrorToastOptions(firstFailure, {
        variant: "error",
        duration: 4000,
      }),
    );
    return;
  }

  if (successCount > 0) {
    const toastOptions = {
      duration: 2200,
    };

    if (action === "publish") {
      toastOptions.actionLabel = t("collection.publish.cta");
      toastOptions.onAction = () => {
        window.open(buildCommunityUrl("/my/catches"));
      };
    }

    showToast(t(successMessageKey, { count: successCount }), toastOptions);
    return;
  }

  if (alreadyDoneCount > 0 && !isCancelled) {
    showToast(actionConfig.alreadyDoneMessage, {
      duration: 1500,
    });
    return;
  }

  if (isCancelled) {
    showToast(t("collection.bulk.cancelled"), {
      duration: 1400,
    });
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
        enterSelectMode(paletteId, { suppressNextClick: true });
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

  collectionGrid?.addEventListener(
    "click",
    (event) => {
      if (!isSelectMode) {
        return;
      }

      const card = /** @type {HTMLElement} */ (event.target)?.closest?.(".palette-card");
      if (!card) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const paletteId = Number(card.dataset.paletteId);
      if (Number.isNaN(paletteId)) {
        return;
      }

      const result = applySelectionModeCardClick({
        paletteId,
        selectedIds,
        suppressNextClick: suppressNextSelectionClick,
      });
      suppressNextSelectionClick = result.suppressNextClick;

      if (result.toggled) {
        card.classList.toggle("is-selected", result.isSelected);
      }

      syncSelectionBar();
    },
    true,
  );

  subscribeSharedPanelClosing("collection", () => {
    clearModerationSyncLoop();
    closePaletteViewerOverlay();
    activeDayVirtualizer?.destroy();
    activeDayVirtualizer = null;
  });

  subscribeAppSettings(handleCollectionSettingsChange);
  syncCollectionPanelChrome();
}

initializeCommunityDeletionCleanupOutbox();
bindCollectionUiEvents();
