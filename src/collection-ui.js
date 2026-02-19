import { getSavedPalettes } from "./palette-storage.js";
import { formatHexColor, formatHslColor, toRgbCss } from "./modules/color-format.js";
import { groupPalettesByDay } from "./modules/collection/grouping.js";
import { createPaletteCard } from "./modules/collection/palette-card.js";
import { createDayGroup as renderDayGroup } from "./modules/collection/render-groups.js";
import { createSwipeController } from "./modules/collection/swipe-controller.js";
import {
  readStoredEnum,
  readStoredFlag,
  writeStoredFlag,
  writeStoredValue,
} from "./modules/storage.js";

const collectionPanel = document.querySelector(".collection-panel");
const collectionGrid = document.getElementById("collectionGrid");
const viewCollectionButton = document.querySelector(".btn-view-collection");
const closeCollectionButton = document.querySelector(".btn-close-collection");
const collectionCopyModeButton = document.querySelector( ".collection-copy-mode-toggle");
const QUICK_ACTION_WIDTH = 144;
const LEFT_ACTION_WIDTH = QUICK_ACTION_WIDTH;
const RIGHT_ACTION_WIDTH = QUICK_ACTION_WIDTH * 2;
const SWIPE_START_THRESHOLD = 8;
const SWIPE_OPEN_RATIO = 0.38;
const COLLECTION_COPY_MODE_STORAGE_KEY = "paletcam.collectionCopyMode";
const COLLECTION_COPY_MODES = ["rgb", "hex", "hsl"];
const COLLECTION_COPY_MODE_LABELS = { rgb: "RGB", hex: "HEX", hsl: "HSL"};
const DELETE_SWIPE_HAPTIC_MS = 11;
const SWIPE_HINT_STORAGE_KEY = "paletcam.swipeHintSeen.v2";
const SWIPE_HINT_START_DELAY_MS = 120;
const SWIPE_HINT_STAGE_DURATION_MS = 750;
const SWIPE_HINT_PAUSE_DURATION_MS = 360;
const SWIPE_HINT_EASING = "cubic-bezier(0.25, 0.85, 0.25, 1)";
const SWIPE_HINT_COPY_OFFSET = Math.round(LEFT_ACTION_WIDTH * 0.5);
const SWIPE_HINT_DELETE_OFFSET = -Math.round(RIGHT_ACTION_WIDTH * 0.2);
const EMPTY_MESSAGE_TEXT = "Aucune palette enregistree pour le moment";
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const MAGNETIC_SNAP_RESET_MS = 320;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
let hasShownSwipeHint = false;
let isSwipeHintQueued = false;
let activeSwipeController;
let collectionCopyMode = readStoredEnum(
  COLLECTION_COPY_MODE_STORAGE_KEY,
  COLLECTION_COPY_MODES,
  "rgb",
);

hasShownSwipeHint = readStoredFlag(SWIPE_HINT_STORAGE_KEY);

function getCollectionCopyTextForColor(color) {
  if (collectionCopyMode === "hex") {
    return formatHexColor(color);
  }

  if (collectionCopyMode === "hsl") {
    return formatHslColor(color);
  }

  return toRgbCss(color);
}

function getCollectionCopyModeLabel() {
  return COLLECTION_COPY_MODE_LABELS[collectionCopyMode] ??
    COLLECTION_COPY_MODE_LABELS.rgb;
}

function getCollectionCopyModeToggleLabel() {
  return `Copier ${getCollectionCopyModeLabel()}`;
}

function cycleCollectionCopyMode() {
  const currentModeIndex = COLLECTION_COPY_MODES.indexOf(collectionCopyMode);
  const nextModeIndex = (currentModeIndex + 1) % COLLECTION_COPY_MODES.length;
  collectionCopyMode = COLLECTION_COPY_MODES[nextModeIndex];
  writeStoredValue(COLLECTION_COPY_MODE_STORAGE_KEY, collectionCopyMode);
}

function syncCollectionCopyModeButton() {
  if (!collectionCopyModeButton) {
    return;
  }

  const label = getCollectionCopyModeToggleLabel();
  collectionCopyModeButton.textContent = label;
  collectionCopyModeButton.setAttribute(
    "aria-label",
    `${label}. Touchez pour changer le format.`,
  );
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

function triggerHapticTick(durationMs = DELETE_SWIPE_HAPTIC_MS) {
  if (
    typeof navigator === "undefined" || typeof navigator.vibrate !== "function"
  ) {
    return;
  }

  navigator.vibrate(durationMs);
}

function maybeRunFirstSwipeHint() {
  if (!collectionGrid || hasShownSwipeHint || isSwipeHintQueued) {
    return;
  }

  const shouldReduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (shouldReduceMotion) {
    hasShownSwipeHint = true;
    writeStoredFlag(SWIPE_HINT_STORAGE_KEY, true);
    return;
  }

  const cards = [...collectionGrid.querySelectorAll(".palette-card")];
  const card = cards.find((candidate) => candidate.offsetParent !== null);
  if (!card) {
    return;
  }

  isSwipeHintQueued = true;

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (
        !card.isConnected || !collectionPanel?.classList.contains("visible")
      ) {
        isSwipeHintQueued = false;
        return;
      }

      hasShownSwipeHint = true;
      isSwipeHintQueued = false;
      writeStoredFlag(SWIPE_HINT_STORAGE_KEY, true);
      runSwipeTrackHint(card);
    }, SWIPE_HINT_START_DELAY_MS);
  });
}

function runSwipeTrackHint(card) {
  const track = card.querySelector(".palette-track");
  if (!track) {
    return;
  }

  const previousTransition = track.style.transition;
  const previousTransform = track.style.transform;
  const hintToDeleteAt = SWIPE_HINT_STAGE_DURATION_MS +
    SWIPE_HINT_PAUSE_DURATION_MS;
  const hintToCenterAt = (SWIPE_HINT_STAGE_DURATION_MS * 2) +
    (SWIPE_HINT_PAUSE_DURATION_MS * 2);
  const hintCleanupAt = hintToCenterAt + SWIPE_HINT_STAGE_DURATION_MS;

  card.classList.add("is-hinting");
  card.classList.remove("is-open-left", "is-open-right");
  track.style.transition =
    `transform ${SWIPE_HINT_STAGE_DURATION_MS}ms ${SWIPE_HINT_EASING}`;
  track.style.transform = "translateX(0px)";

  window.setTimeout(() => {
    if (!card.isConnected) {
      return;
    }

    card.classList.add("is-open-left");
    card.classList.remove("is-open-right");
    track.style.transform = `translateX(${SWIPE_HINT_COPY_OFFSET}px)`;
  }, 0);

  window.setTimeout(() => {
    if (!card.isConnected) {
      return;
    }

    card.classList.remove("is-open-left");
    card.classList.add("is-open-right");
    track.style.transform = `translateX(${SWIPE_HINT_DELETE_OFFSET}px)`;
  }, hintToDeleteAt);

  window.setTimeout(() => {
    if (!card.isConnected) {
      return;
    }

    card.classList.remove("is-open-left", "is-open-right");
    track.style.transform = "translateX(0px)";
  }, hintToCenterAt);

  window.setTimeout(() => {
    if (!card.isConnected) {
      return;
    }

    card.classList.remove("is-hinting");
    track.style.transition = previousTransition;
    track.style.transform = previousTransform;
  }, hintCleanupAt);
}

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
  message.textContent = EMPTY_MESSAGE_TEXT;
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
    void loadCollectionUi();
    return;
  }

  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(card, nextSibling);
  } else {
    parent.appendChild(card);
  }

  syncSessionStateFromCardContainer(parent);
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
    triggerHapticTick,
    getActiveController: () => activeSwipeController,
    closeActiveController: closeActiveSwipeController,
    setActiveController: setActiveSwipeController,
    clearActiveController: clearActiveSwipeController,
  });
}

function createCollectionPaletteCard(palette) {
  return createPaletteCard({
    palette,
    getCopyTextForColor: getCollectionCopyTextForColor,
    getCopyModeLabel: getCollectionCopyModeLabel,
    createSwipeController: createCollectionSwipeController,
    pendingDeletionIds,
    deleteUndoDurationMs: DELETE_UNDO_DURATION_MS,
    takeCardPositionSnapshot,
    restoreCardFromSnapshot,
    syncSessionStateFromCardContainer,
    clearActiveSwipeController,
    ensureEmptyMessage,
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
    onSessionExpanded: () => {
      maybeRunFirstSwipeHint();
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
  syncCollectionCopyModeButton();

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

  maybeRunFirstSwipeHint();
}

function bindCollectionUiEvents() {
  if (
    !collectionPanel || !collectionGrid || !viewCollectionButton ||
    !closeCollectionButton
  ) {
    return;
  }

  syncCollectionCopyModeButton();

  viewCollectionButton.addEventListener("click", async () => {
    collectionPanel.classList.add("visible");
    await loadCollectionUi();
  });

  collectionCopyModeButton?.addEventListener("click", async () => {
    cycleCollectionCopyMode();
    syncCollectionCopyModeButton();

    if (!collectionPanel.classList.contains("visible")) {
      return;
    }

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
