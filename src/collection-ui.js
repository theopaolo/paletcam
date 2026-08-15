import { getAppSettings, subscribeAppSettings, updateAppSettings } from "./app-settings.js";
import {
  captureDeleteOutboxAccountKey,
  flushDeleteOutbox,
  initializeDeleteOutbox,
  preparePaletteDeletionRemoteCleanup,
  reserveDeleteRetryInCurrentTransaction,
} from "./community-delete-outbox.js";
import {
  getCurrentCommunitySession,
  getPalettePublicationAction,
  isCommunityPublicationSessionCurrent,
  publishPaletteToCommunityFeed,
  syncPublishedPalettesModerationStatus,
  unpublishPaletteFromCommunityFeed,
} from "./community-service.js";
import { createCommunityAutoLoginOpener } from "./community-homepage-link.js";
import { t } from "./i18n.js";
import { openLoginPanel } from "./login-ui.js";
import { clientLog } from "./modules/client-log.js";
import { createCollectionCardLifecycle } from "./modules/collection/card-lifecycle.js";
import { runBoundedBulkDeletion } from "./modules/collection/bulk-deletion.js";
import { runBulkPublication } from "./modules/collection/bulk-publication.js";
import {
  createCollectionFilterState,
  isPaletteFavorite,
} from "./modules/collection/collection-filter.js";
import { createCollectionLifecycle } from "./modules/collection/collection-lifecycle.js";
import { PALETTE_DELETED_EVENT } from "./modules/collection/collection-events.js";
import { createCollectionLoadCoordinator } from "./modules/collection/collection-load-coordinator.js";
import {
  createCollectionView,
  hasRequiredCollectionViewElements,
} from "./modules/collection/collection-view.js";
import { createCollectionViewerCoordinator } from "./modules/collection/collection-viewer-coordinator.js";
import { createDeletionSettlementCoordinator } from "./modules/collection/deletion-settlement-coordinator.js";
import { createDayContentVirtualizer } from "./modules/collection/day-virtualizer.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import { createModerationSyncController } from "./modules/collection/moderation-sync-controller.js";
import { createPaletteOutputCommands } from "./modules/collection/palette-output-commands.js";
import {
  createPaletteCard,
  createSwatchCard,
  disposePaletteCard,
  setPaletteCardFavoriteState,
} from "./modules/collection/palette-card.js";
import { createPaletteDeletionUseCase } from "./modules/collection/palette-deletion.js";
import {
  clearPalettePreviewAssetCache,
  disposePalettePreviewAsset,
  disposePalettePreviewDownloads,
  downloadBlob,
  exportPalettePolaroidImage,
  getPaletteViewerPreviewAsset,
  hasPaletteMasterPhoto,
  sharePalettePolaroidImage,
} from "./modules/collection/palette-preview-assets.js";
import {
  areAllCollectionDaysCollapsed,
  buildCollectionPanelTitle,
  getCollectionDayIds,
  toggleAllCollectionDays,
} from "./modules/collection/panel-state.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { createCollectionSelectionState } from "./modules/collection/selection-mode.js";
import { createErrorToastOptions, reportAppError } from "./modules/error-reporting.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosing,
} from "./modules/panels/panel-manager.js";
import { dismissToast, showToast, showUndoToast } from "./modules/toast-ui.js";
import {
  deletePalette,
  getSavedPaletteById,
  getSavedPalettes,
  setPaletteFavorites,
} from "./palette-storage.js";

const collectionView = createCollectionView(document);
const {
  panel: collectionPanel,
  grid: collectionGrid,
  viewListButton: collectionViewListButton,
  viewGridButton: collectionViewGridButton,
  viewSwatchButton: collectionViewSwatchButton,
  filterPublishedButton: collectionFilterPublishedButton,
  filterFavoritesButton: collectionFilterFavoritesButton,
  selectionBar: collectionSelectionBar,
  selectionCount: collectionSelectionCount,
  selectionCancelButton: collectionSelectionCancel,
  selectionDeleteButton: collectionSelectionDelete,
  selectionFavoriteButton: collectionSelectionFavorite,
  selectionExportButton: collectionSelectionExport,
  selectionPublishButton: collectionSelectionPublish,
} = collectionView;
const collectionSelectionPublishLabel =
  collectionSelectionPublish?.querySelector(".palette-action-label") ?? null;
const DELETE_UNDO_DURATION_MS = 5000;
const CARD_REVEAL_DURATION_MS = 280;
const CARD_REVEAL_STAGGER_MS = 42;
const pendingDeletionIds = new Set();
const collapsedDayIds = new Set();
const selectionState = createCollectionSelectionState();
let currentPalettes = [];
let currentCollectionViewMode = getAppSettings().collectionViewMode;
let currentLocale = getAppSettings().locale;
const collectionFilters = createCollectionFilterState({
  published: (palette) => getPalettePublicationAction(palette) === "unpublish",
  favorites: isPaletteFavorite,
});
const collectionFilterButtons = new Map([
  ["published", collectionFilterPublishedButton],
  ["favorites", collectionFilterFavoritesButton],
]);
const collectionViewOptions = [
  { mode: "list", button: collectionViewListButton, labelKey: "collection.view.listAria" },
  { mode: "grid", button: collectionViewGridButton, labelKey: "collection.view.gridAria" },
  { mode: "swatch", button: collectionViewSwatchButton, labelKey: "collection.view.swatchAria" },
];
let longPressTimer = null;
let longPressStartPos = null;
let activeDayVirtualizer = null;
/** @type {Map<string, () => void>} */
const ownedUndoCancellations = new Map();

const collectionLifecycle = createCollectionLifecycle({
  onCleanupError: (error) => {
    reportAppError(error, {
      logMessage: "Failed to release a collection resource.",
      includeClientLog: false,
    });
  },
});
const paletteViewerCoordinator = createCollectionViewerCoordinator({
  loadModule: () => import("./modules/collection/palette-viewer-overlay.js"),
});
const paletteOutputCommands = createPaletteOutputCommands({
  exportPolaroid: exportPalettePolaroidImage,
  sharePolaroid: sharePalettePolaroidImage,
  download: downloadBlob,
  loadVersoTools: async () => {
    const [{ getColorNames }, { renderPaletteVersoBlob }] = await Promise.all([
      import("./modules/color-name-api.js"),
      import("./modules/collection/palette-verso.js"),
    ]);
    return { getColorNames, renderVersoBlob: renderPaletteVersoBlob };
  },
});

const cardLifecycle = createCollectionCardLifecycle({
  collectionGrid,
  emptyMessageText: () => t("collection.empty"),
  collapsedDayIds,
  reloadCollectionUi: async () => {
    await loadCollectionUi();
  },
});
const deletePaletteWithCleanup = createPaletteDeletionUseCase({
  commitLocalPaletteDeletion: (paletteId) =>
    deletePalette(paletteId, {
      accountKey: captureDeleteOutboxAccountKey(),
      prepareRemoteCleanup: () => preparePaletteDeletionRemoteCleanup(paletteId),
      reserveRemoteCleanup: reserveDeleteRetryInCurrentTransaction,
    }),
  disposePreviewAsset: disposePalettePreviewAsset,
  flushRemoteCleanup: flushDeleteOutbox,
  notifyDeleted: dispatchPaletteDeletedEvent,
});
const moderationSyncController = createModerationSyncController({
  isActive: () => Boolean(collectionPanel?.classList.contains("visible")),
  runSync: (signal) => syncPublishedPalettesModerationStatus({ signal }),
  onUpdated: loadCollectionUi,
  onError: (error) => {
    reportAppError(error, {
      logMessage: "Failed to sync moderation statuses.",
      includeClientLog: false,
    });
  },
});
const collectionLoadCoordinator = createCollectionLoadCoordinator({
  loadPalettes: getSavedPalettes,
  selectPalettes: (palettes) => palettes.filter((palette) => !pendingDeletionIds.has(palette.id)),
  applyPalettes: renderCollectionUi,
  handleFailure: renderCollectionLoadFailure,
  recordMetric: clientLog,
  now: () => performance.now(),
});
const deletionSettlementCoordinator = createDeletionSettlementCoordinator({
  onSettlementError: (error, { settlement, trigger }) => {
    reportAppError(error, {
      consoleMessage: "Failed to settle a staged palette deletion.",
      includeClientLog: false,
      context: { settlement, trigger },
    });
  },
});

/** @param {string} toastId @param {() => void} cancel */
function trackOwnedUndo(toastId, cancel) {
  if (toastId) {
    ownedUndoCancellations.set(toastId, cancel);
  }
  return toastId;
}

/** @param {string} toastId */
function releaseOwnedUndo(toastId) {
  if (toastId) {
    ownedUndoCancellations.delete(toastId);
  }
}

function cancelOwnedUndoWork() {
  for (const [toastId, cancel] of ownedUndoCancellations) {
    try {
      cancel();
    } finally {
      dismissToast(toastId);
    }
  }
  ownedUndoCancellations.clear();
}

/**
 * Binds all terminal toast paths to one exact-once deletion operation. User
 * close/swipe accepts deletion; programmatic teardown preserves local data.
 * @param {string} message
 * @param {{
 *   operation: {
 *     undo(): Promise<unknown>,
 *     expire(): Promise<unknown>,
 *     dismiss(reason: string): Promise<unknown>,
 *     cancel(): Promise<unknown>,
 *   },
 *   actionLabel?: string,
 * }} options
 */
function showDeletionUndoToast(message, { operation, actionLabel }) {
  let toastId = "";
  toastId = showUndoToast(message, {
    duration: DELETE_UNDO_DURATION_MS,
    actionLabel,
    onUndo: () => {
      releaseOwnedUndo(toastId);
      void operation.undo();
    },
    onExpire: () => {
      releaseOwnedUndo(toastId);
      void operation.expire();
    },
    onDismiss: (reason) => {
      releaseOwnedUndo(toastId);
      void operation.dismiss(reason);
    },
  });

  if (!toastId) {
    void operation.expire();
    return "";
  }

  return trackOwnedUndo(toastId, () => {
    void operation.cancel();
  });
}

function releaseCollectionResources() {
  collectionLoadCoordinator.destroy();
  moderationSyncController.destroy();
  clearLongPress();
  cancelOwnedUndoWork();
  void deletionSettlementCoordinator.destroy();
  paletteViewerCoordinator.destroy();
  activeDayVirtualizer?.destroy();
  activeDayVirtualizer = null;
  collectionGrid?.querySelectorAll(".palette-card").forEach(disposePaletteCard);
  collectionGrid?.replaceChildren();
  clearPalettePreviewAssetCache();
  disposePalettePreviewDownloads();
  currentPalettes = [];
  pendingDeletionIds.clear();
  collapsedDayIds.clear();
  selectionState.exit();
  collectionFilters.clear();
}

collectionLifecycle.registerCleanup(releaseCollectionResources);

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
  return hasPaletteMasterPhoto(palette);
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
  return collectionFilters.apply(currentPalettes);
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
  const hasCollapsibleDays =
    currentCollectionViewMode !== "swatch" && getCollectionDayIds(dayGroups).length > 0;
  const collapseAllLabel = areAllCollectionDaysCollapsed(dayGroups, collapsedDayIds)
    ? t("collection.expandAll")
    : t("collection.collapseAll");

  collectionViewOptions.forEach(({ mode, button, labelKey }) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const isActive = currentCollectionViewMode === mode;
    button.setAttribute("aria-pressed", String(isActive));
    button.classList.toggle("is-active", isActive);

    // Pressing the option already in use folds or unfolds the day groups, so
    // that is what it announces; the labels are recomputed here rather than
    // read back from the markup, which lets a locale change refresh them.
    const label =
      isActive && hasCollapsibleDays ? `${t(labelKey)} — ${collapseAllLabel}` : t(labelKey);
    button.setAttribute("aria-label", label);
    button.title = label;
  });

  syncCollectionFilterChips();
}

function syncCollectionFilterChips() {
  collectionFilterButtons.forEach((button, filterName) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const matchCount = collectionFilters.count(currentPalettes, filterName);
    const isFilterActive = collectionFilters.isActive(filterName);
    // An active chip stays visible even at zero so the empty list is explained
    // by a control the reader can still switch off.
    button.hidden = matchCount === 0 && !isFilterActive;
    button.classList.toggle("is-active", isFilterActive);
    button.setAttribute("aria-pressed", String(isFilterActive));
    button.dataset.count = String(matchCount);
  });
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
  const result = await paletteOutputCommands.exportPalette(palette);
  const exported = result.status === "exported";
  if (result.status === "failed" && result.error !== undefined) {
    reportAppError(result.error, {
      consoleMessage: "Failed to export palette.",
      includeClientLog: false,
    });
  }
  showToast(exported ? t("collection.exportSuccess") : t("collection.exportFailed"), {
    variant: exported ? "default" : "error",
    duration: exported ? 1400 : 1800,
  });
}

async function handleExportPaletteVerso(palette) {
  const result = await paletteOutputCommands.exportPaletteVerso(palette);
  const exported = result.status === "exported";
  if (result.status === "failed" && result.error !== undefined) {
    reportAppError(result.error, {
      logMessage: "Failed to export palette verso.",
    });
  }

  showToast(exported ? t("collection.exportSuccess") : t("collection.exportFailed"), {
    variant: exported ? "default" : "error",
    duration: exported ? 1400 : 1800,
  });
}

function closePaletteViewerOverlay() {
  paletteViewerCoordinator.close();
}

function refreshPaletteViewerOverlay(options) {
  paletteViewerCoordinator.refresh(options);
}

async function handleSharePalette(palette) {
  const result = await paletteOutputCommands.sharePalette(palette);

  if (result.status === "shared") {
    showToast(t("collection.shareSuccess"), {
      duration: 1400,
    });
    return;
  }

  if (result.status === "cancelled") {
    return;
  }

  if (result.status === "fallback_exported" || result.status === "unsupported") {
    const exported = result.status === "fallback_exported";
    if (!exported && result.error !== undefined) {
      reportAppError(result.error, {
        consoleMessage: "Failed to export palette after sharing was unavailable.",
        includeClientLog: false,
      });
    }
    showToast(
      exported ? t("collection.shareUnsupportedWithExport") : t("collection.shareUnsupported"),
      {
        variant: exported ? "default" : "error",
        duration: exported ? 1800 : 2000,
      },
    );
    return;
  }

  if (result.error !== undefined) {
    reportAppError(result.error, {
      consoleMessage: "Failed to share palette.",
      includeClientLog: false,
    });
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
    cardLifecycle.syncDayStateFromCardContainer(snapshot.parent);
  }

  if (shouldTrackCollectionState) {
    currentPalettes = currentPalettes.filter((entry) => entry.id !== palette.id);
    syncCollectionUiAfterPaletteRemoval();
  }

  const deletionOperation = deletionSettlementCoordinator.stage({
    undo: () => {
      pendingDeletionIds.delete(palette.id);

      if (shouldTrackCollectionState) {
        insertPaletteAtIndex(palette, removedIndex < 0 ? currentPalettes.length : removedIndex);
      }

      if (card instanceof HTMLElement && snapshot) {
        const restored = cardLifecycle.restoreCardFromSnapshot(card, snapshot);
        if (!restored) {
          disposePaletteCard(card);
        }
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
    commit: async () => {
      const result = await commitPaletteDeletion(palette, {
        fallbackIndex: removedIndex,
      });
      if (card instanceof HTMLElement && !card.isConnected) {
        disposePaletteCard(card);
      }
      if (!result.success) {
        return;
      }

      if (card instanceof HTMLElement) {
        cardLifecycle.ensureEmptyMessage();
      } else if (shouldTrackCollectionState) {
        syncCollectionUiAfterPaletteRemoval();
      }
    },
    cancel: () => {
      pendingDeletionIds.delete(palette.id);
      if (card instanceof HTMLElement && !card.isConnected) {
        disposePaletteCard(card);
      }
    },
  });

  showDeletionUndoToast(t("collection.deleteUndo"), {
    operation: deletionOperation,
  });
}

async function commitPaletteDeletion(palette, { fallbackIndex = -1, silent = false } = {}) {
  try {
    const result = await deletePaletteWithCleanup(palette);
    if (!result.success) throw result.error;

    pendingDeletionIds.delete(palette.id);
    if (result.remoteFlushError) {
      reportAppError(result.remoteFlushError, {
        logMessage: "Failed to process the remote deletion outbox.",
      });
    }
    return result;
  } catch (error) {
    reportAppError(error, {
      logMessage: "Failed to delete palette.",
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

/**
 * Mutates the loaded records in place on purpose: the open viewer session and the
 * day virtualizer hold these same objects, so one write keeps every reader
 * coherent without rebuilding the list.
 * @param {number[]} paletteIds @param {string | null} favoritedAt
 */
function applyFavoriteToLoadedPalettes(paletteIds, favoritedAt) {
  const updatedIds = new Set(paletteIds);
  currentPalettes.forEach((palette) => {
    if (updatedIds.has(palette.id)) {
      palette.favoritedAt = favoritedAt;
    }
  });
}

/**
 * Cards show the state as a hairline frame, never as a control, so a change only
 * has to retint the affected cards and the filter chip.
 * @param {number[]} updatedIds @param {boolean} isFavorite
 */
function syncCollectionUiAfterFavoriteChange(updatedIds, isFavorite) {
  // Unstarring under an active favourites filter drops the card out of view, so
  // the list has to be rebuilt rather than patched in place.
  if (!isFavorite && collectionFilters.isActive("favorites")) {
    renderCollectionUi(currentPalettes);
    return;
  }

  updatedIds.forEach((paletteId) => {
    setPaletteCardFavoriteState(getCollectionCardByPaletteId(paletteId), isFavorite);
  });
  syncCollectionFilterChips();
}

/** @param {Array<number>} paletteIds @param {boolean} isFavorite */
async function commitPaletteFavorites(paletteIds, isFavorite) {
  if (paletteIds.length === 0) {
    return false;
  }

  try {
    const { favoritedAt, updatedIds } = await setPaletteFavorites(paletteIds, isFavorite);
    if (updatedIds.length === 0) {
      return false;
    }

    applyFavoriteToLoadedPalettes(updatedIds, favoritedAt);
    syncCollectionUiAfterFavoriteChange(updatedIds, isFavorite);
    return true;
  } catch (error) {
    reportAppError(error, { logMessage: "Failed to update palette favorites." });
    showToast(
      t("collection.favorite.failed"),
      createErrorToastOptions(error, { variant: "error", duration: 1800 }),
    );
    return false;
  }
}

/** @param {number} paletteId @param {boolean} isFavorite */
async function handleToggleFavorite(paletteId, isFavorite) {
  const numericPaletteId = Number(paletteId);
  if (!Number.isFinite(numericPaletteId)) {
    return false;
  }

  return commitPaletteFavorites([numericPaletteId], isFavorite);
}

async function openCollectionPaletteViewer(paletteId, returnFocusTarget = null) {
  if (selectionState.isActive()) {
    return;
  }

  const displayPalettes = getDisplayPalettes();
  const initialIndex = displayPalettes.findIndex((palette) => palette.id === paletteId);
  if (initialIndex < 0) {
    return;
  }

  const canApplyViewerOpen = collectionLoadCoordinator.captureGuard();
  try {
    await paletteViewerCoordinator.open(
      {
        palettes: displayPalettes,
        initialIndex,
        getPalettes: getDisplayPalettes,
        getPreviewAsset: getPaletteViewerPreviewAsset,
        getPublishAction: getPalettePublicationAction,
        canShare: canSharePalette,
        canExport: canExportPalette,
        canPublish: canPublishPalette,
        canDelete: () => true,
        returnFocusTarget,
        onShare: handleSharePalette,
        onExport: handleExportPalette,
        onExportVerso: handleExportPaletteVerso,
        onPublish: (palette) => handlePublishPalette(palette, getPalettePublicationAction(palette)),
        onDelete: handleDeletePalette,
        onToggleFavorite: (palette) =>
          handleToggleFavorite(palette.id, !isPaletteFavorite(palette)),
      },
      {
        canOpen: () =>
          canApplyViewerOpen() && Boolean(collectionPanel?.classList.contains("visible")),
      },
    );
  } catch (error) {
    if (!canApplyViewerOpen() || error?.name === "AbortError") {
      return;
    }
    reportAppError(error, { logMessage: "Failed to load palette viewer." });
    showToast(t("collection.loadErrorToast"), { variant: "error", duration: 1800 });
  }
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
    isDayCollapsed: (dayId) => collapsedDayIds.has(dayId),
    onDayCollapsedChange: (dayId, isCollapsed) => {
      if (isCollapsed) {
        collapsedDayIds.add(dayId);
      } else {
        collapsedDayIds.delete(dayId);
      }

      syncCollectionHeaderControls();
    },
    onCardMount: applyCardSelectionState,
    onCardUnmount: disposePaletteCard,
    revealDurationMs: CARD_REVEAL_DURATION_MS,
    revealStaggerMs: CARD_REVEAL_STAGGER_MS,
    viewMode: currentCollectionViewMode,
  });
}

function pruneUnavailableCollapsedDays(dayGroups) {
  const availableDayIds = new Set(getCollectionDayIds(dayGroups));

  [...collapsedDayIds].forEach((dayId) => {
    if (!availableDayIds.has(dayId)) {
      collapsedDayIds.delete(dayId);
    }
  });
}

function syncSelectModeAfterRender() {
  if (!selectionState.isActive()) {
    return;
  }

  collectionGrid.classList.add("is-select-mode");

  selectionState.pruneUnavailable(currentPalettes);
  selectionState.getSelectedIds().forEach((paletteId) => {
    const card = getCollectionCardByPaletteId(paletteId);
    if (card) {
      card.classList.add("is-selected");
    }
  });

  syncSelectionBar();
}

function applyCardSelectionState(card) {
  if (!selectionState.isActive()) {
    return;
  }

  const rawId = card?.dataset?.paletteId;
  const paletteId = Number(rawId);
  if (!Number.isFinite(paletteId)) {
    return;
  }

  if (selectionState.isSelected(paletteId)) {
    card.classList.add("is-selected");
  }
}

function renderCollectionUi(palettes) {
  if (collectionLifecycle.isDestroyed()) {
    return false;
  }

  currentPalettes = palettes;
  const displayPalettes = getDisplayPalettes();

  activeDayVirtualizer?.destroy();
  activeDayVirtualizer = null;

  collectionGrid.innerHTML = "";
  collectionGrid.dataset.viewMode = currentCollectionViewMode;

  if (displayPalettes.length === 0) {
    const emptyMessage = collectionFilters.hasActive()
      ? t("collection.emptyFiltered")
      : t("collection.empty");
    collectionGrid.innerHTML = `
      <div class="collection-empty">
        <div class="collection-empty-bloom" aria-hidden="true"></div>
        <p class="empty-message">${emptyMessage}</p>
      </div>
    `;
    syncCollectionPanelChrome([]);
    refreshPaletteViewerOverlay();
    return true;
  }

  const dayGroups = groupPalettesByDay(displayPalettes);
  pruneUnavailableCollapsedDays(dayGroups);
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
  return true;
}

async function loadCollectionUi() {
  return (await collectionLoadCoordinator.load()) === "applied";
}

function renderCollectionLoadFailure(error) {
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

/**
 * The view switch is the toolbar's only icon control, so the option already in
 * use carries the collapse-all a separate chevron used to own: tapping it folds
 * every day group, tapping again unfolds. Swatch view has no day groups, so a
 * repeat tap there does nothing.
 * @param {string} viewMode
 */
function handleCollectionViewOptionClick(viewMode) {
  if (currentCollectionViewMode !== viewMode) {
    updateAppSettings({ collectionViewMode: viewMode });
    return;
  }

  if (viewMode === "swatch") {
    return;
  }

  handleCollapseAllDays();
}

function handleCollapseAllDays() {
  const dayGroups = getCurrentDayGroups();

  if (!toggleAllCollectionDays(dayGroups, collapsedDayIds)) {
    syncCollectionHeaderControls(dayGroups);
    return;
  }

  renderCollectionUi(currentPalettes);
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

/**
 * @param {Palette} palette
 * @param {string} [action]
 * @param {{session?: CommunitySession | null}} [options]
 */
function runPublicationAction(palette, action = "publish", { session } = {}) {
  const actionConfig = getPublicationActionConfig(action);

  return actionConfig
    .run(palette, { session })
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

      if (error?.code === "SESSION_CHANGED") {
        return {
          actionConfig,
          error,
          status: "session_changed",
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
  const publicationSession = getCurrentCommunitySession();

  if (!publicationSession?.token) {
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

  const result = await runPublicationAction(palette, action, { session: publicationSession });

  if (result.status === "success") {
    const toastOptions = {
      duration: 1800,
    };
    if (action === "publish") {
      toastOptions.actionLabel = t("collection.publish.cta");
      toastOptions.onAction = createCommunityAutoLoginOpener({ path: "/my/catches" });
    }
    showToast(actionConfig.successMessage, toastOptions);

    await loadCollectionUi();

    if (actionConfig.shouldScheduleModerationSync) {
      moderationSyncController.schedule();
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

  if (result.status === "session_changed") {
    showToast(t("collection.publication.sessionChanged"), {
      variant: "error",
      duration: 2500,
    });
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

export async function openCollectionPanel() {
  if (collectionLifecycle.isDestroyed() || !hasRequiredCollectionViewElements(collectionView)) {
    return false;
  }

  // Collection actions own the deletion outbox. Initialize it immediately on
  // entry even when the app's startup-friendly idle initialization has not run.
  initializeDeleteOutbox();
  const didOpen = openSharedPanel("collection");
  if (!didOpen) {
    return false;
  }

  const didLoad = await loadCollectionUi();
  if (
    didLoad &&
    !collectionLifecycle.isDestroyed() &&
    collectionPanel.classList.contains("visible")
  ) {
    void flushDeleteOutbox();
    void moderationSyncController.runNow();
  }

  return true;
}

/**
 * Opens the palette viewer overlay directly for a single palette,
 * without opening the collection panel first.
 * @param {number | string} paletteId
 * @returns {Promise<"opened" | "missing" | "pending-delete">}
 */
export async function openDirectPaletteViewer(paletteId) {
  if (collectionLifecycle.isDestroyed()) {
    return "missing";
  }
  const isCurrentOpenIntent = paletteViewerCoordinator.beginOpenIntent();

  if (isPalettePendingDeletion(paletteId)) {
    return "pending-delete";
  }

  const palette = await getSavedPaletteById(paletteId);
  if (collectionLifecycle.isDestroyed() || !isCurrentOpenIntent()) {
    return "missing";
  }
  if (!palette) {
    return "missing";
  }

  if (isPalettePendingDeletion(palette.id)) {
    return "pending-delete";
  }

  const didOpen = await paletteViewerCoordinator.open(
    {
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
      onExportVerso: handleExportPaletteVerso,
      onPublish: (p) => handlePublishPalette(p, getPalettePublicationAction(p)),
      onDelete: handleDeletePalette,
    },
    {
      canOpen: () =>
        isCurrentOpenIntent() &&
        !collectionLifecycle.isDestroyed() &&
        !isPalettePendingDeletion(palette.id),
    },
  );
  return didOpen ? "opened" : isPalettePendingDeletion(palette.id) ? "pending-delete" : "missing";
}

function syncSelectionBar() {
  if (!collectionSelectionBar) {
    return;
  }

  collectionSelectionBar.hidden = !selectionState.isActive();

  if (!selectionState.isActive()) {
    return;
  }

  const count = selectionState.getCount();

  if (collectionSelectionCount) {
    collectionSelectionCount.textContent = String(count);
  }

  const displayPalettes = getDisplayPalettes();
  const selected = selectionState.getSelected(displayPalettes);

  if (collectionSelectionDelete instanceof HTMLButtonElement) {
    collectionSelectionDelete.disabled = count === 0;
  }

  if (collectionSelectionFavorite instanceof HTMLButtonElement) {
    // One button, two meanings: it unstars only when every selected capture is
    // already starred, so a mixed selection always resolves to "star them all".
    const shouldUnfavorite = selected.length > 0 && selected.every(isPaletteFavorite);
    collectionSelectionFavorite.disabled = selected.length === 0;
    collectionSelectionFavorite.dataset.favoriteAction = shouldUnfavorite
      ? "unfavorite"
      : "favorite";
    // Filled star = the tap will unstar; the cross-fade rides aria-pressed.
    collectionSelectionFavorite.setAttribute("aria-pressed", String(shouldUnfavorite));
    collectionSelectionFavorite.setAttribute(
      "aria-label",
      shouldUnfavorite ? t("collection.select.unfavorite") : t("collection.select.favorite"),
    );
  }

  if (collectionSelectionExport instanceof HTMLButtonElement) {
    collectionSelectionExport.disabled = !selected.some(canExportPalette);
  }

  if (collectionSelectionPublish instanceof HTMLButtonElement) {
    // One button, two meanings, mirroring the favorite toggle: it unpublishes
    // only when nothing in the selection can still be published.
    const canPublishAny = selected.some(
      (p) => canPublishPalette(p) && getPalettePublicationAction(p) !== "unpublish",
    );
    const canUnpublishAny = selected.some((p) => getPalettePublicationAction(p) === "unpublish");
    const publicationAction = !canPublishAny && canUnpublishAny ? "unpublish" : "publish";
    collectionSelectionPublish.disabled = !canPublishAny && !canUnpublishAny;
    collectionSelectionPublish.dataset.publicationAction = publicationAction;
    // The viewer pill's quiet style keys off data-publish-state.
    collectionSelectionPublish.dataset.publishState = publicationAction;
    const publicationLabel = t(`collection.select.${publicationAction}`);
    collectionSelectionPublish.setAttribute("aria-label", publicationLabel);
    if (collectionSelectionPublishLabel) {
      collectionSelectionPublishLabel.textContent = publicationLabel;
    }
  }
}

function enterSelectMode(initialPaletteId = null, { suppressNextClick = false } = {}) {
  selectionState.enter(initialPaletteId, { suppressNextClick });

  collectionGrid?.classList.add("is-select-mode");

  if (initialPaletteId !== null) {
    const card = getCollectionCardByPaletteId(initialPaletteId);
    card?.classList.add("is-selected");
  }

  syncSelectionBar();
}

function exitSelectMode() {
  selectionState.exit();

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
  const toDelete = selectionState.getSelected(getDisplayPalettes());
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

  const deletionOperation = deletionSettlementCoordinator.stage({
    undo: () => {
      [...stagedDeletions].reverse().forEach(({ palette, removedIndex }) => {
        pendingDeletionIds.delete(palette.id);
        insertPaletteAtIndex(palette, removedIndex);
      });
      syncBulkDeleteUi(stagedDeletions);
    },
    commit: async () => {
      let isCancelled = false;
      const progressToastId = showUndoToast(
        t("collection.bulk.deleteRunning", { count: stagedDeletions.length }),
        {
          duration: 0,
          actionLabel: t("collection.select.cancel"),
          onUndo: () => {
            isCancelled = true;
          },
          onDismiss: () => {
            isCancelled = true;
          },
        },
      );
      trackOwnedUndo(progressToastId, () => {
        isCancelled = true;
      });

      let bulkResult;
      try {
        bulkResult = await runBoundedBulkDeletion({
          deletions: stagedDeletions,
          isCancelled: () => isCancelled || collectionLifecycle.signal.aborted,
          runDelete: ({ palette, removedIndex }) =>
            commitPaletteDeletion(palette, {
              fallbackIndex: removedIndex,
              silent: true,
            }),
        });
      } finally {
        releaseOwnedUndo(progressToastId);
        dismissToast(progressToastId);
      }

      if (collectionLifecycle.signal.aborted) {
        return;
      }

      if (bulkResult.cancelledCount > 0) {
        stagedDeletions.slice(bulkResult.completedCount).forEach(({ palette }) => {
          pendingDeletionIds.delete(palette.id);
        });
      }

      if (bulkResult.failedResults.length > 0 || bulkResult.cancelledCount > 0) {
        await loadCollectionUi();
      }

      if (bulkResult.failedResults.length > 0) {
        showToast(
          t("collection.bulk.deleteFailed", { count: bulkResult.failedResults.length }),
          createErrorToastOptions(bulkResult.failedResults[0].error, {
            variant: "error",
            duration: 2200,
          }),
        );
      } else if (bulkResult.cancelled) {
        showToast(t("collection.bulk.cancelled"), { duration: 1400 });
      }
    },
    cancel: () => {
      stagedDeletions.forEach(({ palette }) => {
        pendingDeletionIds.delete(palette.id);
      });
    },
  });

  showDeletionUndoToast(t("collection.bulk.deletePending", { count: stagedDeletions.length }), {
    operation: deletionOperation,
    actionLabel: t("collection.select.cancel"),
  });
}

async function handleSelectionFavorite() {
  const selected = selectionState.getSelected(getDisplayPalettes());
  const shouldUnfavorite = selected.length > 0 && selected.every(isPaletteFavorite);
  const paletteIds = selected.map((palette) => palette.id);
  exitSelectMode();
  await commitPaletteFavorites(paletteIds, !shouldUnfavorite);
}

async function handleSelectionExport() {
  const toExport = selectionState.getSelected(getDisplayPalettes(), canExportPalette);
  exitSelectMode();
  for (const palette of toExport) {
    await handleExportPalette(palette);
  }
}

async function handleSelectionPublish() {
  const publicationSession = getCurrentCommunitySession();
  if (!publicationSession?.token) {
    showToast(t("collection.publish.auth"), {
      variant: "error",
      duration: 3500,
      actionLabel: t("login.verifyCode"),
      onAction: () => openLoginPanel(),
    });
    return;
  }

  const toPublish = selectionState.getSelected(
    getDisplayPalettes(),
    (p) => canPublishPalette(p) && getPalettePublicationAction(p) !== "unpublish",
  );
  exitSelectMode();
  await handleSelectionPublicationAction("publish", toPublish, publicationSession);
}

async function handleSelectionUnpublish() {
  const publicationSession = getCurrentCommunitySession();
  if (!publicationSession?.token) {
    showToast(t("collection.unpublish.auth"), {
      variant: "error",
      duration: 3500,
      actionLabel: t("login.verifyCode"),
      onAction: () => openLoginPanel(),
    });
    return;
  }

  const toUnpublish = selectionState.getSelected(
    getDisplayPalettes(),
    (p) => getPalettePublicationAction(p) === "unpublish",
  );
  exitSelectMode();
  await handleSelectionPublicationAction("unpublish", toUnpublish, publicationSession);
}

async function handleSelectionPublicationAction(action, palettes, publicationSession) {
  if (palettes.length === 0) {
    return;
  }

  const actionConfig = getPublicationActionConfig(action);
  const pendingMessageKey = `collection.bulk.${action}Pending`;
  const successMessageKey = `collection.bulk.${action}Success`;
  const failureMessageKey = `collection.bulk.${action}Failed`;
  let isCancelled = false;

  const toastId = showUndoToast(t(pendingMessageKey, { count: palettes.length }), {
    duration: 0,
    actionLabel: t("collection.select.cancel"),
    onUndo: () => {
      isCancelled = true;
    },
    onDismiss: () => {
      isCancelled = true;
    },
  });
  trackOwnedUndo(toastId, () => {
    isCancelled = true;
  });

  let bulkResult;
  try {
    bulkResult = await runBulkPublication({
      palettes,
      runAction: (palette) =>
        runPublicationAction(palette, action, { session: publicationSession }),
      isCancelled: () => isCancelled,
      isSessionCurrent: () => isCommunityPublicationSessionCurrent(publicationSession),
    });
  } finally {
    releaseOwnedUndo(toastId);
    dismissToast(toastId);
  }

  const {
    alreadyDoneCount,
    authRequired,
    cancelled,
    failureCount,
    firstFailure,
    sessionChanged,
    shouldReload,
    successCount,
  } = bulkResult;

  if (shouldReload) {
    await loadCollectionUi();
  }

  if (successCount > 0 && actionConfig.shouldScheduleModerationSync) {
    moderationSyncController.schedule();
  }

  if (authRequired) {
    showToast(actionConfig.authMessage, {
      variant: "error",
      duration: 2000,
    });
    openLoginPanel();
    return;
  }

  if (sessionChanged) {
    showToast(t("collection.publication.sessionChanged"), {
      variant: "error",
      duration: 2500,
    });
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
      toastOptions.onAction = createCommunityAutoLoginOpener({ path: "/my/catches" });
    }

    showToast(t(successMessageKey, { count: successCount }), toastOptions);
    return;
  }

  if (alreadyDoneCount > 0 && !cancelled) {
    showToast(actionConfig.alreadyDoneMessage, {
      duration: 1500,
    });
    return;
  }

  if (cancelled) {
    showToast(t("collection.bulk.cancelled"), {
      duration: 1400,
    });
  }
}

/**
 * @param {EventTarget | null | undefined} target
 * @param {string} eventName
 * @param {EventListenerOrEventListenerObject} listener
 * @param {AddEventListenerOptions} [options]
 */
function bindCollectionEventListener(target, eventName, listener, options = {}) {
  target?.addEventListener(eventName, listener, {
    ...options,
    signal: collectionLifecycle.signal,
  });
}

function handleCollectionPanelClosing() {
  collectionLoadCoordinator.invalidate();
  moderationSyncController.stop();
  clearLongPress();
  closePaletteViewerOverlay();
  activeDayVirtualizer?.destroy();
  activeDayVirtualizer = null;
}

function bindCollectionUiEvents() {
  if (!hasRequiredCollectionViewElements(collectionView)) {
    return;
  }

  collectionViewOptions.forEach(({ mode, button }) => {
    bindCollectionEventListener(button, "click", () => {
      handleCollectionViewOptionClick(mode);
    });
  });

  collectionFilterButtons.forEach((filterButton, filterName) => {
    bindCollectionEventListener(filterButton, "click", () => {
      collectionFilters.toggle(filterName);
      if (selectionState.isActive()) {
        exitSelectMode();
      }
      renderCollectionUi(currentPalettes);
    });
  });

  bindCollectionEventListener(collectionSelectionCancel, "click", () => {
    exitSelectMode();
  });

  bindCollectionEventListener(collectionSelectionDelete, "click", () => {
    void handleSelectionDelete();
  });

  bindCollectionEventListener(collectionSelectionFavorite, "click", () => {
    void handleSelectionFavorite();
  });

  bindCollectionEventListener(collectionSelectionExport, "click", () => {
    void handleSelectionExport();
  });

  bindCollectionEventListener(collectionSelectionPublish, "click", () => {
    if (collectionSelectionPublish?.dataset.publicationAction === "unpublish") {
      void handleSelectionUnpublish();
      return;
    }
    void handleSelectionPublish();
  });

  bindCollectionEventListener(collectionGrid, "pointerdown", (event) => {
    const pointerEvent = /** @type {PointerEvent} */ (event);
    if (selectionState.isActive()) {
      return;
    }

    if (!(pointerEvent.target instanceof Element)) {
      return;
    }

    const card = /** @type {HTMLElement | null} */ (pointerEvent.target.closest(".palette-card"));
    if (!card) {
      return;
    }

    longPressStartPos = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      longPressStartPos = null;
      const paletteId = Number(card.dataset.paletteId);
      if (!Number.isNaN(paletteId)) {
        enterSelectMode(paletteId, { suppressNextClick: true });
      }
    }, 500);
  });

  bindCollectionEventListener(collectionGrid, "pointermove", (event) => {
    const pointerEvent = /** @type {PointerEvent} */ (event);
    if (!longPressTimer || !longPressStartPos) {
      return;
    }

    const dx = pointerEvent.clientX - longPressStartPos.x;
    const dy = pointerEvent.clientY - longPressStartPos.y;
    if (dx * dx + dy * dy > 64) {
      clearLongPress();
    }
  });

  bindCollectionEventListener(collectionGrid, "pointerup", clearLongPress);
  bindCollectionEventListener(collectionGrid, "pointercancel", clearLongPress);

  bindCollectionEventListener(collectionGrid, "contextmenu", (event) => {
    if (selectionState.isActive() || longPressTimer !== null) {
      event.preventDefault();
    }
  });

  bindCollectionEventListener(
    collectionGrid,
    "click",
    (event) => {
      if (!selectionState.isActive()) {
        return;
      }

      const card =
        event.target instanceof Element
          ? /** @type {HTMLElement | null} */ (event.target.closest(".palette-card"))
          : null;
      if (!card) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const paletteId = Number(card.dataset.paletteId);
      if (Number.isNaN(paletteId)) {
        return;
      }

      const result = selectionState.applyCardClick(paletteId);

      if (result.toggled) {
        card.classList.toggle("is-selected", result.isSelected);
      }

      syncSelectionBar();
    },
    { capture: true },
  );

  collectionLifecycle.registerCleanup(
    subscribeSharedPanelClosing("collection", handleCollectionPanelClosing),
  );
  collectionLifecycle.registerCleanup(subscribeAppSettings(handleCollectionSettingsChange));
  syncCollectionPanelChrome();
}

bindCollectionUiEvents();

export function destroyCollectionUi() {
  if (collectionLifecycle.isDestroyed()) {
    return false;
  }

  closeSharedPanel("collection");
  return collectionLifecycle.destroy();
}
