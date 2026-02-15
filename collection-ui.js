import { showToast, showUndoToast } from './modules/toast-ui.js';
import { deletePalette, getSavedPalettes } from './palette-storage.js';

const collectionPanel = document.querySelector('.collection-panel');
const collectionGrid = document.getElementById('collectionGrid');
const viewCollectionButton = document.querySelector('.btn-view-collection');
const closeCollectionButton = document.querySelector('.btn-close-collection');
const QUICK_ACTION_WIDTH = 144;
const LEFT_ACTION_WIDTH = QUICK_ACTION_WIDTH;
const RIGHT_ACTION_WIDTH = QUICK_ACTION_WIDTH * 2;
const SWIPE_START_THRESHOLD = 8;
const SWIPE_OPEN_RATIO = 0.38;
const DELETE_SWIPE_HAPTIC_MS = 11;
const EMPTY_MESSAGE_TEXT = 'No palettes saved yet';
const DELETE_UNDO_DURATION_MS = 5000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const SESSION_REVEAL_DURATION_MS = 280;
const SESSION_REVEAL_STAGGER_MS = 42;
const SESSION_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const DAY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const DAY_DURATION_MS = 24 * 60 * 60 * 1000;
const pendingDeletionIds = new Set();
const collapsedSessionIds = new Set();
let activeSwipeController;

function toRgbCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
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
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }

  navigator.vibrate(durationMs);
}

function removeEmptyMessage() {
  const message = collectionGrid?.querySelector('.empty-message');
  message?.remove();
}

function ensureEmptyMessage() {
  if (!collectionGrid) {
    return;
  }

  const hasCard = Boolean(collectionGrid.querySelector('.palette-card'));
  if (hasCard) {
    removeEmptyMessage();
    return;
  }

  if (collectionGrid.querySelector('.empty-message')) {
    return;
  }

  const message = document.createElement('p');
  message.className = 'empty-message';
  message.textContent = EMPTY_MESSAGE_TEXT;
  collectionGrid.appendChild(message);
}

function getPaletteTimestampDate(timestamp) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayPeriodLabel(date) {
  const hour = date.getHours();

  if (hour < 5) {
    return 'Night';
  }

  if (hour < 12) {
    return 'Morning';
  }

  if (hour < 17) {
    return 'Afternoon';
  }

  if (hour < 22) {
    return 'Evening';
  }

  return 'Night';
}

function getDayLabel(date) {
  if (!date) {
    return 'Unknown Day';
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / DAY_DURATION_MS);

  if (dayDiff === 0) {
    return 'Today';
  }

  if (dayDiff === 1) {
    return 'Yesterday';
  }

  return SESSION_WEEKDAY_FORMATTER.format(date);
}

function getDayDateLabel(date) {
  if (!date) {
    return '';
  }

  return DAY_DATE_FORMATTER.format(date);
}

function getDayKey(date) {
  if (!date) {
    return 'unknown';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSessionTitle(date) {
  if (!date) {
    return 'Session';
  }

  return getDayPeriodLabel(date);
}

function groupPalettesByDay(palettes) {
  const dayGroups = [];
  let currentDay;
  let currentSession;
  let previousDate;

  palettes.forEach((palette) => {
    const paletteDate = getPaletteTimestampDate(palette.timestamp);
    const paletteDayKey = getDayKey(paletteDate);
    const shouldStartNewDay = !currentDay || currentDay.key !== paletteDayKey;

    if (shouldStartNewDay) {
      currentDay = {
        key: paletteDayKey,
        id: `day-${paletteDayKey}`,
        title: getDayLabel(paletteDate),
        dateLabel: getDayDateLabel(paletteDate),
        paletteCount: 0,
        sessions: [],
      };
      dayGroups.push(currentDay);
      currentSession = undefined;
      previousDate = undefined;
    }

    const shouldStartNewSession =
      !currentSession ||
      !paletteDate ||
      !previousDate ||
      previousDate.getTime() - paletteDate.getTime() > SESSION_GAP_MS;

    if (shouldStartNewSession) {
      currentSession = {
        id: `session-${palette.id}`,
        title: getSessionTitle(paletteDate),
        palettes: [],
      };
      currentDay.sessions.push(currentSession);
    }

    currentSession.palettes.push(palette);
    currentDay.paletteCount += 1;
    previousDate = paletteDate;
  });

  return dayGroups;
}

function setSessionCollapsed(sessionElement, isCollapsed) {
  const toggle = sessionElement.querySelector('.collection-session-toggle');
  if (!toggle) {
    return;
  }

  sessionElement.classList.toggle('is-collapsed', isCollapsed);
  toggle.setAttribute('aria-expanded', String(!isCollapsed));
}

function animateSessionExpansion(sessionElement) {
  const sessionBody = sessionElement.querySelector('.collection-session-body');
  if (!sessionBody) {
    return;
  }

  const shouldReduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (shouldReduceMotion) {
    return;
  }

  const cards = [...sessionBody.querySelectorAll('.palette-card')];
  if (cards.length === 0) {
    return;
  }

  cards.forEach((card, index) => {
    card.style.setProperty('--reveal-index', String(index));
    card.classList.remove('is-revealing');
  });

  void sessionBody.offsetHeight;

  cards.forEach((card) => {
    card.classList.add('is-revealing');
  });

  window.setTimeout(() => {
    cards.forEach((card) => {
      card.classList.remove('is-revealing');
    });
  }, SESSION_REVEAL_DURATION_MS + SESSION_REVEAL_STAGGER_MS * cards.length);
}

function updateSessionCardCount(sessionElement) {
  if (!sessionElement) {
    return 0;
  }

  const sessionBody = sessionElement.querySelector('.collection-session-body');
  const countElement = sessionElement.querySelector('.collection-session-count');

  if (!sessionBody || !countElement) {
    return 0;
  }

  const cardCount = sessionBody.querySelectorAll('.palette-card').length;
  countElement.textContent = String(cardCount);
  return cardCount;
}

function updateDayCardCount(dayElement) {
  if (!dayElement) {
    return 0;
  }

  const countElement = dayElement.querySelector('.collection-day-count');
  if (!countElement) {
    return 0;
  }

  const cardCount = dayElement.querySelectorAll('.palette-card').length;
  countElement.textContent = String(cardCount);
  return cardCount;
}

function syncSessionStateFromCardContainer(cardContainer) {
  const sessionElement = cardContainer?.closest('.collection-session');

  if (!sessionElement) {
    ensureEmptyMessage();
    return;
  }

  const dayElement = sessionElement.closest('.collection-day');
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

function getSessionCaretMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 5.5L8 10.3l4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function createSessionGroup(session) {
  const section = document.createElement('section');
  section.className = 'collection-session';
  section.dataset.sessionId = session.id;

  const sessionBodyId = `${session.id}-body`;

  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.className = 'collection-session-toggle';
  headerButton.setAttribute('aria-controls', sessionBodyId);
  headerButton.innerHTML = `
    <span class="collection-session-title">${session.title}</span>
    <span class="collection-session-meta">
      <span class="collection-session-count">${session.palettes.length}</span>
      <span class="collection-session-caret">${getSessionCaretMarkup()}</span>
    </span>
  `;

  const body = document.createElement('div');
  body.className = 'collection-session-body';
  body.id = sessionBodyId;

  session.palettes.forEach((palette) => {
    body.appendChild(createPaletteCard(palette));
  });

  headerButton.addEventListener('click', () => {
    closeActiveSwipeController();

    const isCollapsed = section.classList.contains('is-collapsed');
    const nextCollapsedState = !isCollapsed;
    setSessionCollapsed(section, nextCollapsedState);

    if (nextCollapsedState) {
      collapsedSessionIds.add(session.id);
      return;
    }

    collapsedSessionIds.delete(session.id);
    animateSessionExpansion(section);
  });

  section.append(headerButton, body);
  setSessionCollapsed(section, collapsedSessionIds.has(session.id));

  return section;
}

function createDayGroup(dayGroup) {
  const daySection = document.createElement('section');
  daySection.className = 'collection-day';
  daySection.dataset.dayId = dayGroup.id;

  const dayHeader = document.createElement('header');
  dayHeader.className = 'collection-day-header';

  const dayTitle = document.createElement('p');
  dayTitle.className = 'collection-day-title';
  dayTitle.textContent = dayGroup.dateLabel
    ? `${dayGroup.title} — ${dayGroup.dateLabel}`
    : dayGroup.title;

  const dayCount = document.createElement('span');
  dayCount.className = 'collection-day-count';
  dayCount.textContent = String(dayGroup.paletteCount);

  const sessionsContainer = document.createElement('div');
  sessionsContainer.className = 'collection-day-sessions';

  dayGroup.sessions.forEach((session) => {
    sessionsContainer.appendChild(createSessionGroup(session));
  });

  dayHeader.append(dayTitle, dayCount);
  daySection.append(dayHeader, sessionsContainer);
  return daySection;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Clipboard write failed:', error);
    return false;
  }
}

async function exportPaletteAsImage(palette) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context || !palette.photoBlob) {
    return false;
  }

  return new Promise((resolve) => {
    const image = new Image();
    const photoUrl = URL.createObjectURL(palette.photoBlob);

    image.onload = () => {
      const photoWidth = image.width;
      const photoHeight = image.height;
      const swatchHeight = 100;

      canvas.width = photoWidth;
      canvas.height = photoHeight + swatchHeight;

      context.drawImage(image, 0, 0, photoWidth, photoHeight);

      const swatchWidth = photoWidth / palette.colors.length;
      palette.colors.forEach((color, index) => {
        context.fillStyle = toRgbCss(color);
        context.fillRect(index * swatchWidth, photoHeight, swatchWidth, swatchHeight);
      });

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(photoUrl);

        if (!blob) {
          resolve(false);
          return;
        }

        const link = document.createElement('a');
        link.download = `palette-${palette.id}.webp`;
        link.href = URL.createObjectURL(blob);
        link.click();

        URL.revokeObjectURL(link.href);
        resolve(true);
      }, 'image/webp', 0.95);
    };

    image.onerror = () => {
      URL.revokeObjectURL(photoUrl);
      resolve(false);
    };

    image.src = photoUrl;
  });
}

function createPhotoSwatch(palette) {
  if (!palette.photoBlob) {
    return null;
  }

  const photoSwatch = document.createElement('div');
  const photoUrl = URL.createObjectURL(palette.photoBlob);

  photoSwatch.className = 'color-swatch photo-swatch';
  photoSwatch.style.backgroundImage = `url(${photoUrl})`;
  photoSwatch.style.backgroundSize = 'cover';
  photoSwatch.style.backgroundPosition = 'center';
  photoSwatch.title = 'Click to copy photo';

  photoSwatch.addEventListener('click', async () => {
    try {
      const image = new Image();
      const imageUrl = URL.createObjectURL(palette.photoBlob);

      image.onload = async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(imageUrl);
          return;
        }

        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0);

        canvas.toBlob(async (pngBlob) => {
          try {
            if (!pngBlob) {
              return;
            }

            await navigator.clipboard.write([
              new ClipboardItem({
                'image/png': pngBlob,
              }),
            ]);
            showToast('Photo copied');
          } catch (error) {
            console.error('Failed to copy photo, downloading fallback:', error);
            if (!pngBlob) {
              showToast('Copy failed', { variant: 'error', duration: 1800 });
              return;
            }

            const link = document.createElement('a');
            link.download = `photo-${palette.id}.png`;
            link.href = URL.createObjectURL(pngBlob);
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('Photo downloaded', { duration: 1500 });
          } finally {
            URL.revokeObjectURL(imageUrl);
          }
        }, 'image/png');
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
      };

      image.src = imageUrl;
    } catch (error) {
      console.error('Failed to process photo:', error);
      showToast('Copy failed', { variant: 'error', duration: 1800 });
    }
  });

  return photoSwatch;
}

function createColorSwatch(color) {
  const swatch = document.createElement('div');
  const rgbText = toRgbCss(color);

  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = rgbText;
  swatch.title = rgbText;

  swatch.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(rgbText);
    showToast(copied ? 'RGB copied' : 'Copy failed', {
      variant: copied ? 'default' : 'error',
      duration: copied ? 1000 : 1800,
    });
  });

  return swatch;
}

function getIconMarkup(iconName) {
  if (iconName === 'copy') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M184,64H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H184a8,8,0,0,0,8-8V72A8,8,0,0,0,184,64Zm-8,144H48V80H176ZM224,40V184a8,8,0,0,1-16,0V48H72a8,8,0,0,1,0-16H216A8,8,0,0,1,224,40Z"></path>
      </svg>
    `;
  }

  if (iconName === 'export') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"></path>
    </svg>
  `;
}

function createQuickActionButton({ className, label, iconName, visibleLabel }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `palette-quick-action ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `
    ${getIconMarkup(iconName)}
    ${visibleLabel ? `<span class="palette-quick-action-label">${visibleLabel}</span>` : ''}
  `;
  return button;
}

function createSwipeHandle() {
  const handle = document.createElement('span');
  handle.className = 'palette-swipe-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = `
    <svg viewBox="0 0 14 18" focusable="false">
      <circle cx="4" cy="4" r="1.1"></circle>
      <circle cx="10" cy="4" r="1.1"></circle>
      <circle cx="4" cy="9" r="1.1"></circle>
      <circle cx="10" cy="9" r="1.1"></circle>
      <circle cx="4" cy="14" r="1.1"></circle>
      <circle cx="10" cy="14" r="1.1"></circle>
    </svg>
  `;
  return handle;
}

function createSwipeController({ card, track }) {
  let currentOffset = 0;
  let pointerId;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let gestureAxis;
  let movedHorizontally = false;
  let hasTickedDeleteThreshold = false;
  let controller;

  function applyOffset(nextOffset, shouldAnimate) {
    const clampedOffset = Math.min(LEFT_ACTION_WIDTH, Math.max(-RIGHT_ACTION_WIDTH, nextOffset));
    currentOffset = clampedOffset;

    track.style.transform = `translateX(${clampedOffset}px)`;
    card.classList.toggle('is-open-left', clampedOffset > 0);
    card.classList.toggle('is-open-right', clampedOffset < 0);
    card.classList.toggle('is-dragging', !shouldAnimate);
  }

  function snapTo(nextOffset) {
    applyOffset(nextOffset, true);

    if (nextOffset === 0) {
      clearActiveSwipeController(controller);
      return;
    }

    setActiveSwipeController(controller);
  }

  controller = {
    card,
    close() {
      snapTo(0);
    },
    isOpen() {
      return currentOffset !== 0;
    },
  };

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (activeSwipeController && activeSwipeController !== controller) {
      closeActiveSwipeController();
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = currentOffset;
    gestureAxis = undefined;
    movedHorizontally = false;
    hasTickedDeleteThreshold = false;
    track.setPointerCapture(pointerId);
  });

  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!gestureAxis) {
      const totalX = Math.abs(deltaX);
      const totalY = Math.abs(deltaY);

      if (totalX < SWIPE_START_THRESHOLD && totalY < SWIPE_START_THRESHOLD) {
        return;
      }

      gestureAxis = totalX > totalY ? 'x' : 'y';
    }

    if (gestureAxis !== 'x') {
      return;
    }

    movedHorizontally = true;
    event.preventDefault();
    applyOffset(startOffset + deltaX, false);

    const openRightThreshold = -RIGHT_ACTION_WIDTH * SWIPE_OPEN_RATIO;
    if (currentOffset <= openRightThreshold && !hasTickedDeleteThreshold) {
      triggerHapticTick();
      hasTickedDeleteThreshold = true;
    }
  });

  function releasePointer(event) {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (track.hasPointerCapture(pointerId)) {
      track.releasePointerCapture(pointerId);
    }

    pointerId = undefined;

    if (gestureAxis !== 'x' || !movedHorizontally) {
      card.classList.remove('is-dragging');
      return;
    }

    const openLeftThreshold = LEFT_ACTION_WIDTH * SWIPE_OPEN_RATIO;
    const openRightThreshold = -RIGHT_ACTION_WIDTH * SWIPE_OPEN_RATIO;

    if (currentOffset >= openLeftThreshold) {
      snapTo(LEFT_ACTION_WIDTH);
      return;
    }

    if (currentOffset <= openRightThreshold) {
      if (!hasTickedDeleteThreshold) {
        triggerHapticTick();
      }
      snapTo(-RIGHT_ACTION_WIDTH);
      return;
    }

    snapTo(0);
  }

  track.addEventListener('pointerup', releasePointer);
  track.addEventListener('pointercancel', releasePointer);
  track.addEventListener(
    'click',
    (event) => {
      if (!controller.isOpen()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      controller.close();
    },
    true
  );

  return controller;
}

function createPaletteCard(palette) {
  const card = document.createElement('div');
  card.className = 'palette-card';
  card.dataset.paletteId = String(palette.id);

  const swatchesContainer = document.createElement('div');
  swatchesContainer.className = 'palette-swatches';

  const photoSwatch = createPhotoSwatch(palette);
  if (photoSwatch) {
    swatchesContainer.appendChild(photoSwatch);
  }

  palette.colors.forEach((color) => {
    swatchesContainer.appendChild(createColorSwatch(color));
  });

  const leftActions = document.createElement('div');
  leftActions.className = 'palette-action-lane palette-action-lane-left';

  const rightActions = document.createElement('div');
  rightActions.className = 'palette-action-lane palette-action-lane-right';

  const track = document.createElement('div');
  track.className = 'palette-track';
  const swipeHandle = createSwipeHandle();
  track.append(swatchesContainer, swipeHandle);

  const copyAllButton = createQuickActionButton({
    className: 'palette-action-copy',
    label: 'Copy palette',
    iconName: 'copy',
    visibleLabel: 'copy',
  });
  const exportButton = createQuickActionButton({
    className: 'palette-action-export',
    label: 'Export palette',
    iconName: 'export',
    visibleLabel: 'export',
  });
  const deleteButton = createQuickActionButton({
    className: 'palette-action-delete',
    label: 'Delete palette',
    iconName: 'delete',
    visibleLabel: 'delete',
  });

  const swipeController = createSwipeController({ card, track });

  copyAllButton.addEventListener('click', async () => {
    const colorsText = palette.colors.map((color) => toRgbCss(color)).join('\n');
    const copied = await copyTextToClipboard(colorsText);
    showToast(copied ? 'Palette copied' : 'Copy failed', {
      variant: copied ? 'default' : 'error',
      duration: copied ? 1300 : 1800,
    });
    swipeController.close();
  });

  exportButton.addEventListener('click', async () => {
    const exported = await exportPaletteAsImage(palette);
    showToast(exported ? 'Palette exported' : 'Export failed', {
      variant: exported ? 'default' : 'error',
      duration: exported ? 1400 : 1800,
    });
    swipeController.close();
  });

  deleteButton.addEventListener('click', () => {
    if (pendingDeletionIds.has(palette.id)) {
      return;
    }

    pendingDeletionIds.add(palette.id);
    const snapshot = takeCardPositionSnapshot(card);

    clearActiveSwipeController(swipeController);
    card.remove();
    syncSessionStateFromCardContainer(snapshot.parent);

    showUndoToast('Palette deleted', {
      duration: DELETE_UNDO_DURATION_MS,
      onUndo: () => {
        pendingDeletionIds.delete(palette.id);
        restoreCardFromSnapshot(card, snapshot);
      },
      onExpire: async () => {
        try {
          await deletePalette(palette.id);
          pendingDeletionIds.delete(palette.id);
          ensureEmptyMessage();
        } catch (error) {
          console.error(`Failed to delete palette ${palette.id}:`, error);
          pendingDeletionIds.delete(palette.id);
          restoreCardFromSnapshot(card, snapshot);
          showToast('Delete failed', { variant: 'error', duration: 1800 });
        }
      },
    });
  });

  leftActions.appendChild(copyAllButton);
  rightActions.append(exportButton, deleteButton);
  card.append(leftActions, rightActions, track);

  return card;
}

async function loadCollectionUi() {
  closeActiveSwipeController();
  const palettes = (await getSavedPalettes()).filter((palette) => !pendingDeletionIds.has(palette.id));
  collectionGrid.innerHTML = '';

  if (palettes.length === 0) {
    collectionGrid.innerHTML = `<p class="empty-message">${EMPTY_MESSAGE_TEXT}</p>`;
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
    collectionGrid.appendChild(createDayGroup(dayGroup));
  });
}

function bindCollectionUiEvents() {
  if (!collectionPanel || !collectionGrid || !viewCollectionButton || !closeCollectionButton) {
    return;
  }

  viewCollectionButton.addEventListener('click', async () => {
    collectionPanel.classList.add('visible');
    await loadCollectionUi();
  });

  closeCollectionButton.addEventListener('click', () => {
    closeActiveSwipeController();
    collectionPanel.classList.remove('visible');
  });

  collectionPanel.addEventListener('scroll', () => {
    closeActiveSwipeController();
  }, { passive: true });

  document.addEventListener('pointerdown', (event) => {
    if (!activeSwipeController || !collectionPanel.classList.contains('visible')) {
      return;
    }

    if (activeSwipeController.card.contains(event.target)) {
      return;
    }

    closeActiveSwipeController();
  });
}

bindCollectionUiEvents();
