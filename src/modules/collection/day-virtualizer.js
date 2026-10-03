const DAY_MOUNT_ROOT_MARGIN = "1500px 0px";
const EAGER_MOUNT_COUNT = 3;
/** A phone's content width, enough to size placeholders before a day mounts. */
const ESTIMATED_CONTENT_WIDTH_PX = 340;
/** Row height of each view from its cell width, gaps included. */
const ESTIMATED_ROW_HEIGHTS = Object.freeze({
  grid: (cellWidth) => cellWidth * 1.22 + 8,
  bands: () => 36,
  swatch: (cellWidth) => cellWidth,
  rings: (cellWidth) => cellWidth + 8,
});

function estimateDayContentHeight(dayGroup, viewMode, columns) {
  // A mosaic cell is the photo or one color, so a catch fills several.
  const total = Math.max(
    1,
    viewMode === "swatch"
      ? (dayGroup?.palettes ?? []).reduce(
          (cells, palette) => cells + 1 + (palette.colors?.length ?? 0),
          0,
        )
      : (dayGroup?.paletteCount ?? 0),
  );
  const rowHeight = (ESTIMATED_ROW_HEIGHTS[viewMode] ?? ESTIMATED_ROW_HEIGHTS.grid)(
    ESTIMATED_CONTENT_WIDTH_PX / columns,
  );
  return Math.ceil(total / columns) * rowHeight;
}

/**
 * Manages mount/unmount of day-section content based on viewport intersection.
 * A single IntersectionObserver drives all registered days; outside the buffer
 * each day's content is replaced with a sized placeholder so scroll stays stable.
 *
 * @param {object} config
 * @param {Element | null} [config.scrollRoot]
 * @param {(card: HTMLElement) => void} [config.onCardMount]
 *   Called for each card after a day mounts. Skipped entirely when omitted.
 */
export function createDayContentVirtualizer({ scrollRoot, onCardMount } = {}) {
  const handlers = new Map();
  let destroyed = false;
  const shouldNotifyCardMount = typeof onCardMount === "function";

  const notifyCardsMounted = (handler) => {
    if (!shouldNotifyCardMount) {
      return;
    }
    handler.contentContainer.querySelectorAll(".palette-card").forEach(onCardMount);
  };

  const handleMount = (handler) => {
    if (handler.isMounted) {
      return;
    }
    handler.mountContent();
    handler.isMounted = true;
    notifyCardsMounted(handler);
  };

  const flushBatchedUnmounts = (handlersToUnmount) => {
    if (handlersToUnmount.length === 0) {
      return;
    }
    const measurements = handlersToUnmount.map((handler) => handler.contentContainer.offsetHeight);
    handlersToUnmount.forEach((handler, index) => {
      handler.unmountContent(measurements[index]);
      handler.isMounted = false;
    });
  };

  const observer =
    typeof window !== "undefined" && typeof window.IntersectionObserver === "function"
      ? new window.IntersectionObserver(
          (intersectionEntries) => {
            if (destroyed) {
              return;
            }
            const leaving = [];
            intersectionEntries.forEach((intersectionEntry) => {
              const handler = handlers.get(intersectionEntry.target);
              if (!handler) {
                return;
              }
              if (intersectionEntry.isIntersecting) {
                handleMount(handler);
              } else if (handler.isMounted) {
                leaving.push(handler);
              }
            });
            flushBatchedUnmounts(leaving);
          },
          { root: scrollRoot ?? null, rootMargin: DAY_MOUNT_ROOT_MARGIN },
        )
      : null;

  return {
    register({
      element,
      contentContainer,
      mountContent,
      unmountContent,
      dayGroup,
      viewMode,
      columns = 2,
    }) {
      if (destroyed) {
        return;
      }

      const handler = {
        contentContainer,
        mountContent,
        unmountContent,
        dayGroup,
        viewMode,
        isMounted: false,
      };

      handlers.set(element, handler);

      const placeholderHeight = estimateDayContentHeight(dayGroup, viewMode, columns);
      if (placeholderHeight > 0) {
        contentContainer.style.minHeight = `${placeholderHeight}px`;
      }

      if (handlers.size <= EAGER_MOUNT_COUNT) {
        handleMount(handler);
        return;
      }

      if (observer) {
        observer.observe(element);
        return;
      }

      handleMount(handler);
    },
    /** Re-sizes the placeholders of unmounted days after the view zooms. */
    relayout(columns) {
      handlers.forEach((handler) => {
        if (!handler.isMounted) {
          const height = estimateDayContentHeight(handler.dayGroup, handler.viewMode, columns);
          handler.contentContainer.style.minHeight = `${height}px`;
        }
      });
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      flushBatchedUnmounts([...handlers.values()].filter((handler) => handler.isMounted));
      handlers.clear();
    },
  };
}
