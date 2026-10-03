const CARD_MOUNT_BATCH_SIZE = Object.freeze({
  grid: Object.freeze({ initial: 12, subsequent: 48 }),
  bands: Object.freeze({ initial: 24, subsequent: 72 }),
  swatch: Object.freeze({ initial: 24, subsequent: 72 }),
  rings: Object.freeze({ initial: 24, subsequent: 72 }),
});

function scheduleCardBatch(callback) {
  if (typeof window.requestIdleCallback === "function") {
    const requestId = window.requestIdleCallback(callback, { timeout: 200 });
    return () => window.cancelIdleCallback?.(requestId);
  }

  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
}

function createDayCards(dayGroup, createPaletteCard, viewMode, onCardMount) {
  const container = document.createElement("div");
  container.className = "collection-day-grid";
  const batchSizes = CARD_MOUNT_BATCH_SIZE[viewMode] ?? CARD_MOUNT_BATCH_SIZE.grid;
  let nextPaletteIndex = 0;
  let cancelScheduledBatch = null;

  const appendNextBatch = () => {
    cancelScheduledBatch = null;
    const batchSize = nextPaletteIndex === 0 ? batchSizes.initial : batchSizes.subsequent;
    const batch = dayGroup.palettes
      .slice(nextPaletteIndex, nextPaletteIndex + batchSize)
      .map((palette) => createPaletteCard(palette));
    nextPaletteIndex += batch.length;
    container.append(...batch);
    batch.forEach((card) => {
      onCardMount?.(card);
    });

    if (nextPaletteIndex < dayGroup.palettes.length) {
      cancelScheduledBatch = scheduleCardBatch(appendNextBatch);
    }
  };

  appendNextBatch();

  return {
    cancel() {
      cancelScheduledBatch?.();
      cancelScheduledBatch = null;
    },
    container,
  };
}

/**
 * @param {object} config
 * @param {DayGroup} config.dayGroup
 * @param {(palette: Palette) => HTMLElement} config.createPaletteCard
 * @param {(card: HTMLElement) => void} [config.onCardMount]
 * @param {(card: HTMLElement) => void} [config.onCardUnmount]
 * @param {"grid" | "bands" | "swatch" | "rings"} [config.viewMode]
 * @returns {{
 *   element: HTMLElement,
 *   contentContainer: HTMLElement,
 *   mountContent: () => void,
 *   unmountContent: (preMeasuredHeight?: number) => void,
 * }}
 */
export function createDayGroup({
  dayGroup,
  createPaletteCard,
  onCardMount,
  onCardUnmount,
  viewMode = "grid",
}) {
  const daySection = document.createElement("section");
  daySection.className = "collection-day";
  daySection.dataset.dayId = dayGroup.id;
  daySection.dataset.viewMode = viewMode;
  daySection.dataset.paletteCount = String(dayGroup.paletteCount);

  const dayHeader = document.createElement("h3");
  dayHeader.className = "collection-day-header";

  const dayTitle = document.createElement("span");
  dayTitle.className = "collection-day-title";
  dayTitle.textContent = dayGroup.dateLabel
    ? `${dayGroup.title} — ${dayGroup.dateLabel}`
    : dayGroup.title;

  const dayCount = document.createElement("span");
  dayCount.className = "collection-day-count";
  dayCount.textContent = String(dayGroup.paletteCount);

  dayHeader.append(dayTitle, dayCount);

  const contentContainer = document.createElement("div");
  contentContainer.className = "collection-day-content";

  daySection.append(dayHeader, contentContainer);

  let lastMeasuredHeight = 0;
  let cancelCardMount = null;

  const mountContent = () => {
    cancelCardMount?.();
    contentContainer.style.minHeight = "";
    const dayCards = createDayCards(dayGroup, createPaletteCard, viewMode, onCardMount);
    cancelCardMount = dayCards.cancel;
    contentContainer.appendChild(dayCards.container);
  };

  const unmountContent = (preMeasuredHeight) => {
    cancelCardMount?.();
    cancelCardMount = null;
    const height = preMeasuredHeight ?? contentContainer.offsetHeight;
    if (height > 0) {
      lastMeasuredHeight = height;
    }
    if (typeof onCardUnmount === "function") {
      contentContainer.querySelectorAll(".palette-card").forEach(onCardUnmount);
    }
    contentContainer.replaceChildren();
    if (lastMeasuredHeight > 0) {
      contentContainer.style.minHeight = `${lastMeasuredHeight}px`;
    }
  };

  return {
    element: daySection,
    contentContainer,
    mountContent,
    unmountContent,
  };
}
