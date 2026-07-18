import { toRgbCss } from "../color-format.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CARD_MOUNT_BATCH_SIZE = Object.freeze({
  grid: Object.freeze({ initial: 12, subsequent: 48 }),
  list: Object.freeze({ initial: 3, subsequent: 24 }),
  swatch: Object.freeze({ initial: 24, subsequent: 72 }),
});

function clampColorChannel(channel) {
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function offsetColor(color, delta) {
  return {
    r: clampColorChannel(color.r + delta),
    g: clampColorChannel(color.g + delta),
    b: clampColorChannel(color.b + delta),
  };
}

function getDayAverageColor(dayGroup) {
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let sampleCount = 0;

  dayGroup.palettes.forEach((palette) => {
    palette.colors.forEach((color) => {
      totalR += color.r;
      totalG += color.g;
      totalB += color.b;
      sampleCount += 1;
    });
  });

  if (sampleCount === 0) {
    return { r: 74, g: 74, b: 74 };
  }

  return {
    r: Math.round(totalR / sampleCount),
    g: Math.round(totalG / sampleCount),
    b: Math.round(totalB / sampleCount),
  };
}

function createDayCaret() {
  const caret = document.createElement("span");
  caret.className = "collection-day-caret";

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", "M3.2 5.5L8 10.3l4.8-4.8");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.appendChild(path);
  caret.appendChild(svg);
  return caret;
}

function createDayCover(dayGroup) {
  const cover = document.createElement("div");
  cover.className = "collection-day-cover";
  cover.setAttribute("aria-hidden", "true");

  const averageColor = getDayAverageColor(dayGroup);
  const darkColor = offsetColor(averageColor, -38);
  const lightColor = offsetColor(averageColor, 26);

  cover.style.backgroundImage = `linear-gradient(108deg, ${toRgbCss(
    darkColor,
  )} 0%, ${toRgbCss(averageColor)} 52%, ${toRgbCss(lightColor)} 100%)`;

  return cover;
}

function setDayCollapsed(daySection, toggleButton, isCollapsed) {
  daySection.classList.toggle("is-collapsed", isCollapsed);
  toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
}

function animateDayExpansion(daySection, { revealDurationMs, revealStaggerMs }) {
  const shouldReduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (shouldReduceMotion) {
    return () => {};
  }

  const cards = [...daySection.querySelectorAll(".palette-card")];
  if (cards.length === 0) {
    return () => {};
  }

  cards.forEach((card, index) => {
    card.style.setProperty("--reveal-index", String(index));
    card.classList.remove("is-revealing");
  });

  void daySection.offsetHeight;

  cards.forEach((card) => {
    card.classList.add("is-revealing");
  });

  const timeoutId = window.setTimeout(
    () => {
      cards.forEach((card) => {
        card.classList.remove("is-revealing");
      });
    },
    revealDurationMs + revealStaggerMs * cards.length,
  );
  return () => {
    window.clearTimeout(timeoutId);
    cards.forEach((card) => {
      card.classList.remove("is-revealing");
    });
  };
}

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
  container.className = viewMode === "list" ? "collection-day-cards" : "collection-day-grid";
  const batchSizes = CARD_MOUNT_BATCH_SIZE[viewMode] ?? CARD_MOUNT_BATCH_SIZE.list;
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
 * @param {(dayId: string) => boolean} config.isDayCollapsed
 * @param {(dayId: string, collapsed: boolean) => void} config.onDayCollapsedChange
 * @param {number} config.revealDurationMs
 * @param {number} config.revealStaggerMs
 * @param {(card: HTMLElement) => void} [config.onCardMount]
 * @param {(card: HTMLElement) => void} [config.onCardUnmount]
 * @param {"list" | "grid" | "swatch"} [config.viewMode]
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
  isDayCollapsed,
  onDayCollapsedChange,
  revealDurationMs,
  revealStaggerMs,
  onCardMount,
  onCardUnmount,
  viewMode = "list",
}) {
  const isCollapsible = viewMode !== "swatch";

  const daySection = document.createElement("section");
  daySection.className = "collection-day";
  daySection.dataset.dayId = dayGroup.id;
  daySection.dataset.viewMode = viewMode;
  daySection.dataset.paletteCount = String(dayGroup.paletteCount);

  const contentId = `${dayGroup.id}-content`;

  const dayToggle = document.createElement("button");
  dayToggle.type = "button";
  dayToggle.className = "collection-day-toggle";
  dayToggle.setAttribute("aria-controls", contentId);

  const dayTitle = document.createElement("span");
  dayTitle.className = "collection-day-title";
  dayTitle.textContent = dayGroup.dateLabel
    ? `${dayGroup.title} — ${dayGroup.dateLabel}`
    : dayGroup.title;

  const dayMeta = document.createElement("span");
  dayMeta.className = "collection-day-meta";

  const dayCount = document.createElement("span");
  dayCount.className = "collection-day-count";
  dayCount.textContent = String(dayGroup.paletteCount);

  dayMeta.append(dayCount, createDayCaret());
  dayToggle.append(dayTitle, dayMeta);

  const cover = createDayCover(dayGroup);

  const contentContainer = document.createElement("div");
  contentContainer.className = "collection-day-content";
  contentContainer.id = contentId;

  daySection.append(dayToggle, cover, contentContainer);
  let cancelDayExpansion = () => {};

  if (isCollapsible) {
    dayToggle.addEventListener("click", () => {
      cancelDayExpansion();
      cancelDayExpansion = () => {};
      const nextCollapsedState = !daySection.classList.contains("is-collapsed");
      setDayCollapsed(daySection, dayToggle, nextCollapsedState);
      onDayCollapsedChange?.(dayGroup.id, nextCollapsedState);

      if (nextCollapsedState) {
        return;
      }

      cancelDayExpansion = animateDayExpansion(daySection, {
        revealDurationMs,
        revealStaggerMs,
      });
    });

    setDayCollapsed(daySection, dayToggle, isDayCollapsed(dayGroup.id));
  } else {
    dayToggle.setAttribute("aria-expanded", "true");
    dayToggle.disabled = true;
  }

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
    cancelDayExpansion();
    cancelDayExpansion = () => {};
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
