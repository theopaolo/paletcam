import {
  COLLECTION_COLUMN_RANGES,
  getAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { t } from "../../i18n.js";
import { toRgbCss } from "../color-format.js";
import { boundaryFeedback, detentFeedback, unlockUiFeedback } from "../ui-feedback.js";
import { createCollectionRail } from "./collection-rail.js";
import { createDayContentVirtualizer } from "./day-virtualizer.js";
import { groupPalettesByDay, groupPalettesByMonth } from "./grouping.js";
import {
  createBandCard,
  createChipCard,
  createPaletteCard,
  createRingCard,
  createSwatchCard,
  disposePaletteCard,
} from "./palette-card.js";
import { createDayGroup as renderDayGroup } from "./render-groups.js";
import { getPaletteKeyColor, orderPalettesBySpectrum } from "./spectrum.js";

/** Palette-first views group by month: a day with one catch is not worth a header there. */
const MONTH_GROUPED_VIEW_MODES = new Set(["bands", "rings"]);
const CARD_CREATORS = {
  grid: createPaletteCard,
  bands: createBandCard,
  swatch: createSwatchCard,
  rings: createRingCard,
};
/** Pinch spread ratio that steps a view one zoom level. */
const PINCH_STEP_RATIO = 1.3;

/**
 * One zoom dot per step under a view's icon, the current step lit, like the
 * zoom marks on a camera. Only the active view shows them.
 * @param {CollectionViewMode} mode
 */
function createZoomDots(mode) {
  const { min, max } = COLLECTION_COLUMN_RANGES[mode];
  const dots = document.createElement("span");
  dots.className = "collection-view-zoom";
  dots.setAttribute("aria-hidden", "true");
  for (let step = min; step <= max; step += 1) {
    dots.appendChild(document.createElement("i"));
  }
  return dots;
}

/**
 * @typedef {object} GalleryPresenterOptions
 * @property {(HTMLElement & { panelTitle: string }) | null} panel The shared panel the gallery sits in.
 * @property {HTMLElement} grid Where the groups of cards are drawn.
 * @property {{ mode: CollectionViewMode, button: HTMLElement | null }[]} viewOptions
 * @property {ReturnType<typeof import("./collection-lifecycle.js").createCollectionLifecycle>} lifecycle
 * @property {() => Palette[]} getDisplayPalettes What the grid shows right now, filters applied.
 * @property {() => string} getEmptyMessage
 * @property {() => object} getCardOptions Per-gallery card options: the viewer opener, the picture source.
 * @property {(card: HTMLElement) => void} [onCardMount]
 * @property {() => void} [syncChrome] Redraws the title, tally and chips around the grid.
 * @property {(state: { isEmpty: boolean }) => void} [afterRender]
 * @property {() => void} [refreshViewer]
 * @property {() => void} [onPinchStart]
 * @property {"collectionColumns" | "communityColumns"} [columnsKey] Which setting holds this gallery's zoom.
 */

/**
 * The part of a gallery panel that does not care whose catches it shows: the
 * five views, their zoom (button and pinch), the day or month groups, the
 * virtualizer and the scrub rail. The personal collection and the community
 * feed both draw through it, so a change to one view lands in both.
 * @param {GalleryPresenterOptions} options
 */
export function createGalleryPresenter({
  panel,
  grid,
  viewOptions,
  lifecycle,
  getDisplayPalettes,
  getEmptyMessage,
  getCardOptions,
  onCardMount,
  syncChrome,
  afterRender,
  refreshViewer,
  onPinchStart,
  columnsKey = "collectionColumns",
}) {
  const initialSettings = getAppSettings();
  let viewMode = initialSettings.collectionViewMode;
  let locale = initialSettings.locale;
  let activeDayVirtualizer = null;
  let rail = null;

  const isVisible = () => Boolean(panel?.classList.contains("visible"));
  const getShellScrollRoot = () => panel?.shadowRoot?.querySelector(".panel-shell") ?? null;
  const getBodyScrollRoot = () => grid.closest(".collection-panel-body");
  const getColumns = () => getAppSettings()[columnsKey][viewMode];

  function getRail() {
    const host = grid.closest(".collection-panel-content");
    const scrollRoot = getBodyScrollRoot();
    if (!rail && host instanceof HTMLElement && scrollRoot instanceof HTMLElement) {
      rail = createCollectionRail({ host, scrollRoot });
      lifecycle.registerCleanup(() => rail?.destroy());
    }
    return rail;
  }

  function groupForCurrentView(palettes) {
    if (viewMode === "spectrum") {
      return [];
    }
    return MONTH_GROUPED_VIEW_MODES.has(viewMode)
      ? groupPalettesByMonth(palettes)
      : groupPalettesByDay(palettes);
  }

  function getCardCreator() {
    const createCard = CARD_CREATORS[viewMode] ?? createPaletteCard;
    return (palette) =>
      createCard({ palette, scrollRoot: getShellScrollRoot(), ...getCardOptions() });
  }

  function createDayGroupElement(dayGroup) {
    return renderDayGroup({
      dayGroup,
      createPaletteCard: getCardCreator(),
      onCardMount,
      onCardUnmount: disposePaletteCard,
      viewMode,
    });
  }

  /**
   * The spectrum view: one wall of chips around the hue wheel, a heading per
   * hue family. It needs no virtualizer, chips carry no image.
   * @param {Palette[]} palettes
   * @returns {import("./collection-rail.js").RailEntry[]}
   */
  function renderSpectrumWall(palettes) {
    const wall = document.createElement("div");
    wall.className = "collection-spectrum";
    const ordered = orderPalettesBySpectrum(palettes);
    const familyCounts = new Map();
    ordered.forEach(({ family }) => {
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    });

    const railEntries = [];
    let currentFamily = "";
    ordered.forEach((entry) => {
      const familyName = t(`collection.hue.${entry.family}`);
      const familyCount = familyCounts.get(entry.family);
      if (entry.family !== currentFamily) {
        currentFamily = entry.family;
        const heading = document.createElement("p");
        heading.className = "collection-spectrum-heading";
        const name = document.createElement("span");
        name.className = "collection-day-title";
        name.textContent = familyName;
        const count = document.createElement("span");
        count.className = "collection-day-count";
        count.textContent = String(familyCount);
        heading.append(name, count);
        wall.appendChild(heading);
      }

      const card = createChipCard({
        palette: entry.palette,
        colors: entry.colors,
        onOpenViewer: getCardOptions().onOpenViewer,
      });
      onCardMount?.(card);
      wall.appendChild(card);
      railEntries.push({
        color: toRgbCss(entry.color),
        label: `${familyName} · ${familyCount}`,
        target: card,
      });
    });

    grid.appendChild(wall);
    return railEntries;
  }

  function destroyVirtualizer() {
    activeDayVirtualizer?.destroy();
    activeDayVirtualizer = null;
  }

  /** Draws the display palettes in the current view. */
  function render() {
    if (lifecycle.isDestroyed()) {
      return false;
    }

    const displayPalettes = getDisplayPalettes();
    destroyVirtualizer();

    grid.innerHTML = "";
    grid.dataset.viewMode = viewMode;
    grid.style.setProperty("--collection-grid-columns", String(getColumns()));

    if (displayPalettes.length === 0) {
      getRail()?.setEntries([]);
      grid.innerHTML = `
        <div class="collection-empty">
          <div class="collection-empty-bloom" aria-hidden="true"></div>
          <p class="empty-message">${getEmptyMessage()}</p>
        </div>
      `;
      syncChrome?.();
      afterRender?.({ isEmpty: true });
      return true;
    }

    if (viewMode === "spectrum") {
      syncChrome?.();
      getRail()?.setEntries(renderSpectrumWall(displayPalettes));
      afterRender?.({ isEmpty: false });
      return true;
    }

    const dayGroups = groupForCurrentView(displayPalettes);
    syncChrome?.();

    activeDayVirtualizer = createDayContentVirtualizer({
      scrollRoot: getShellScrollRoot(),
      onCardMount,
    });

    const railEntries = [];
    // The mosaic's days are separate grids: each one starts at the column where
    // the previous day stopped and tucks into its last row, so no row has holes.
    let mosaicCells = 0;
    dayGroups.forEach((dayGroup) => {
      const dayRender = createDayGroupElement(dayGroup);
      if (viewMode === "swatch") {
        dayRender.element.style.setProperty("--mosaic-offset", String(mosaicCells));
        mosaicCells += dayGroup.palettes.reduce(
          (cells, palette) => cells + 1 + (palette.colors?.length ?? 0),
          0,
        );
      }
      grid.appendChild(dayRender.element);
      activeDayVirtualizer.register({
        element: dayRender.element,
        contentContainer: dayRender.contentContainer,
        mountContent: dayRender.mountContent,
        unmountContent: dayRender.unmountContent,
        dayGroup,
        viewMode,
        columns: getColumns(),
      });
      const label = `${dayGroup.dateLabel || dayGroup.title} · ${dayGroup.paletteCount}`;
      dayGroup.palettes.forEach((palette) => {
        railEntries.push({
          color: toRgbCss(getPaletteKeyColor(palette).color),
          label,
          target: dayRender.element,
        });
      });
    });
    getRail()?.setEntries(railEntries);

    afterRender?.({ isEmpty: false });
    return true;
  }

  /** Same draw, with the scroll position kept: the feed grows at its far end. */
  function renderKeepingScroll() {
    const scrollRoot = getBodyScrollRoot();
    const top = scrollRoot?.scrollTop ?? 0;
    const height = grid.offsetHeight;
    grid.style.minHeight = `${height}px`;
    const didRender = render();
    if (scrollRoot) {
      scrollRoot.scrollTop = top;
    }
    grid.style.removeProperty("min-height");
    return didRender;
  }

  /** The palettes the viewer swipes through, in the order the current view shows them. */
  function getViewerPalettes() {
    return viewMode === "spectrum"
      ? orderPalettesBySpectrum(getDisplayPalettes()).map((entry) => entry.palette)
      : getDisplayPalettes();
  }

  function syncHeader() {
    const columnsByMode = getAppSettings()[columnsKey];
    viewOptions.forEach(({ mode, button }) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      const isActive = viewMode === mode;
      button.setAttribute("aria-pressed", String(isActive));
      button.classList.toggle("is-active", isActive);
      const level = columnsByMode[mode] - COLLECTION_COLUMN_RANGES[mode].min;
      button.querySelectorAll(".collection-view-zoom i").forEach((dot, index) => {
        dot.classList.toggle("is-lit", index === level);
      });
    });
  }

  /**
   * One zoom step of the current view, keeping the row under the fingers where
   * it was: the first card reaching that line is found before the columns change
   * and scrolled back to the same height after.
   * @param {number} columns
   * @param {number} anchorClientY
   */
  function stepZoom(columns, anchorClientY) {
    const scrollRoot = getBodyScrollRoot();
    const { min, max } = COLLECTION_COLUMN_RANGES[viewMode];
    if (!(scrollRoot instanceof HTMLElement)) {
      return;
    }
    if (columns < min || columns > max) {
      boundaryFeedback();
      return;
    }

    const anchor = [...grid.querySelectorAll(".palette-card")].find(
      (card) => card.getBoundingClientRect().bottom > anchorClientY,
    );
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;

    updateAppSettings({ [columnsKey]: { [viewMode]: columns } });
    detentFeedback("density");

    if (anchor) {
      scrollRoot.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
  }

  /**
   * Tapping the view already in use steps its zoom, one more card per row each
   * time, back to the largest cards after the densest step.
   * @param {CollectionViewMode} mode
   */
  function handleViewOptionClick(mode) {
    if (viewMode !== mode) {
      updateAppSettings({ collectionViewMode: mode });
      return;
    }

    const { min, max } = COLLECTION_COLUMN_RANGES[mode];
    const columns = getColumns();
    const scrollRoot = getBodyScrollRoot();
    unlockUiFeedback();
    stepZoom(columns >= max ? min : columns + 1, scrollRoot?.getBoundingClientRect().top ?? 0);
  }

  /**
   * Pinching zooms the current view like a photo library: spread for bigger
   * cards, squeeze for more per row. Touch events, not pointer events, so a
   * two-finger move can be kept from scrolling or zooming the page.
   */
  function bindPinch() {
    const scrollRoot = getBodyScrollRoot();
    if (!scrollRoot) {
      return;
    }
    let startSpread = 0;
    const getSpread = (touches) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const listen = (eventName, listener, options = {}) =>
      scrollRoot.addEventListener(eventName, listener, { ...options, signal: lifecycle.signal });

    listen(
      "touchstart",
      (event) => {
        const touches = /** @type {TouchEvent} */ (event).touches;
        if (touches.length === 2) {
          unlockUiFeedback();
          onPinchStart?.();
          startSpread = getSpread(touches);
        }
      },
      { passive: true },
    );
    listen(
      "touchmove",
      (event) => {
        const touches = /** @type {TouchEvent} */ (event).touches;
        if (touches.length !== 2 || !startSpread) {
          return;
        }
        event.preventDefault();
        const ratio = getSpread(touches) / startSpread;
        if (ratio < PINCH_STEP_RATIO && ratio > 1 / PINCH_STEP_RATIO) {
          return;
        }
        startSpread = getSpread(touches);
        stepZoom(
          getColumns() + (ratio > 1 ? -1 : 1),
          (touches[0].clientY + touches[1].clientY) / 2,
        );
      },
      { passive: false },
    );
    const endPinch = (event) => {
      if (/** @type {TouchEvent} */ (event).touches.length < 2) {
        startSpread = 0;
      }
    };
    listen("touchend", endPinch);
    listen("touchcancel", endPinch);
    // iOS Safari zooms the page on its own gesture events unless they are cancelled.
    listen("gesturestart", (event) => event.preventDefault());
  }

  function handleSettingsChange(settings) {
    if (settings.collectionViewMode !== viewMode) {
      viewMode = settings.collectionViewMode;
      grid.dataset.viewMode = viewMode;
      if (isVisible()) {
        render();
      } else {
        syncChrome?.();
      }
    } else {
      syncHeader();
    }

    const columns = settings[columnsKey][viewMode];
    if (grid.style.getPropertyValue("--collection-grid-columns") !== String(columns)) {
      grid.style.setProperty("--collection-grid-columns", String(columns));
      activeDayVirtualizer?.relayout(columns);
    }

    if (settings.locale === locale) {
      return;
    }

    locale = settings.locale;
    if (isVisible()) {
      render();
      return;
    }

    syncChrome?.();
    refreshViewer?.();
  }

  /** Wires the view buttons, the pinch and the settings the views follow. */
  function bind() {
    viewOptions.forEach(({ mode, button }) => {
      button?.appendChild(createZoomDots(mode));
      button?.addEventListener("click", () => handleViewOptionClick(mode), {
        signal: lifecycle.signal,
      });
    });
    bindPinch();
    lifecycle.registerCleanup(subscribeAppSettings(handleSettingsChange));
  }

  return {
    bind,
    destroyVirtualizer,
    findCard: (paletteId) =>
      /** @type {HTMLElement | null} */ (
        grid.querySelector(`.palette-card[data-palette-id="${String(paletteId)}"]`)
      ),
    getColumns,
    getLocale: () => locale,
    getViewMode: () => viewMode,
    getViewerPalettes,
    isSpectrum: () => viewMode === "spectrum",
    render,
    renderKeepingScroll,
    syncHeader,
  };
}
