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
const collectionHeader = collectionPanel?.querySelector(".collection-header");
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

function formatBytes(byteCount) {
  const bytes = Number(byteCount);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function ensureCollectionStorageSummary() {
  if (!collectionPanel || !collectionHeader) {
    return null;
  }

  let summary = collectionPanel.querySelector(".collection-storage-summary");

  if (!summary) {
    summary = document.createElement("section");
    summary.className = "collection-storage-summary";
    summary.setAttribute("aria-live", "polite");
    summary.innerHTML = `
      <div class="storage-summary-header">
        <p class="storage-summary-title">Storage</p>
        <p class="storage-summary-badge" data-storage-status>Checking...</p>
      </div>
      <div class="storage-meter" role="img" aria-label="Storage usage">
        <span class="storage-meter-fill" data-storage-meter></span>
      </div>
      <details class="storage-summary-details">
        <summary class="storage-summary-disclosure">
          <span>Details</span>
          <span class="storage-summary-disclosure-caret" aria-hidden="true">▾</span>
        </summary>
        <div class="storage-summary-details-body">
          <div class="storage-summary-grid">
            <p class="storage-summary-item">
              <span class="storage-summary-label">Used</span>
              <strong data-storage-used>--</strong>
            </p>
            <p class="storage-summary-item">
              <span class="storage-summary-label">Available</span>
              <strong data-storage-available>--</strong>
            </p>
            <p class="storage-summary-item">
              <span class="storage-summary-label">Quota</span>
              <strong data-storage-quota>--</strong>
            </p>
            <p class="storage-summary-item">
              <span class="storage-summary-label">Paletcam photos</span>
              <strong data-storage-app>--</strong>
            </p>
          </div>
          <p class="storage-summary-footnote" data-storage-note>
            Estimation du navigateur pour ce site (IndexedDB + cache + autres donnees).
          </p>
        </div>
      </details>
    `;

    collectionHeader.insertAdjacentElement("afterend", summary);
  }

  return {
    root: summary,
    meter: summary.querySelector("[data-storage-meter]"),
    status: summary.querySelector("[data-storage-status]"),
    used: summary.querySelector("[data-storage-used]"),
    available: summary.querySelector("[data-storage-available]"),
    quota: summary.querySelector("[data-storage-quota]"),
    app: summary.querySelector("[data-storage-app]"),
    note: summary.querySelector("[data-storage-note]"),
  };
}

function sumPalettePhotoBytes(palettes) {
  if (!Array.isArray(palettes)) {
    return 0;
  }

  return palettes.reduce((total, palette) => {
    const photoSize = palette?.photoBlob?.size;
    return total + (Number.isFinite(photoSize) ? photoSize : 0);
  }, 0);
}

async function getStorageEstimate() {
  if (!navigator.storage?.estimate) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = Number(estimate?.usage);
    const quota = Number(estimate?.quota);

    return {
      usage: Number.isFinite(usage) ? usage : 0,
      quota: Number.isFinite(quota) ? quota : 0,
    };
  } catch (error) {
    console.warn("Storage estimate unavailable:", error);
    return null;
  }
}

async function updateCollectionStorageSummary(palettes) {
  const storageUi = ensureCollectionStorageSummary();

  if (!storageUi) {
    return;
  }

  const appPhotoBytes = sumPalettePhotoBytes(palettes);
  storageUi.app.textContent = formatBytes(appPhotoBytes);

  storageUi.status.textContent = "Loading";
  storageUi.root.classList.remove("is-warning");
  storageUi.meter.style.width = "0%";

  const estimate = await getStorageEstimate();

  if (!estimate || estimate.quota <= 0) {
    storageUi.status.textContent = "Unavailable";
    storageUi.used.textContent = "--";
    storageUi.available.textContent = "--";
    storageUi.quota.textContent = "--";
    storageUi.note.textContent =
      "Quota estimate unavailable in this browser. Paletcam photos shows app image storage only.";
    return;
  }

  const usedBytes = estimate.usage;
  const quotaBytes = estimate.quota;
  const availableBytes = Math.max(0, quotaBytes - usedBytes);
  const usageRatio = Math.max(0, Math.min(1, usedBytes / quotaBytes));
  const usagePercent = Math.round(usageRatio * 100);

  storageUi.used.textContent = formatBytes(usedBytes);
  storageUi.available.textContent = formatBytes(availableBytes);
  storageUi.quota.textContent = formatBytes(quotaBytes);
  storageUi.status.textContent = `${usagePercent}%`;
  storageUi.meter.style.width = `${usagePercent}%`;
  storageUi.note.textContent =
    "Browser estimate for this site (IndexedDB + cache + other origin data). Paletcam photos is app image data only.";

  if (usageRatio >= 0.85) {
    storageUi.root.classList.add("is-warning");
  }
}

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
  const allPalettes = await getSavedPalettes();
  await updateCollectionStorageSummary(allPalettes);

  const palettes = allPalettes.filter((palette) =>
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
