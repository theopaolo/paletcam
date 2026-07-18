const DAY_MOUNT_ROOT_MARGIN = "1500px 0px";
const EAGER_MOUNT_COUNT = 3;
const ESTIMATED_LIST_CARD_HEIGHT_PX = 420;
const ESTIMATED_GRID_CARD_HEIGHT_PX = 132;
const ESTIMATED_GRID_COLUMNS = 3;
const ESTIMATED_SWATCH_CARD_HEIGHT_PX = 96;
const ESTIMATED_SWATCH_COLUMNS = 4;

function estimateDayContentHeight(dayGroup, viewMode) {
  const total = Math.max(1, dayGroup?.paletteCount ?? 0);

  if (viewMode === "swatch") {
    const rows = Math.ceil(total / ESTIMATED_SWATCH_COLUMNS);
    return rows * ESTIMATED_SWATCH_CARD_HEIGHT_PX;
  }

  if (viewMode === "grid") {
    const rows = Math.ceil(total / ESTIMATED_GRID_COLUMNS);
    return rows * ESTIMATED_GRID_CARD_HEIGHT_PX;
  }

  return total * ESTIMATED_LIST_CARD_HEIGHT_PX;
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
    register({ element, contentContainer, mountContent, unmountContent, dayGroup, viewMode }) {
      if (destroyed) {
        return;
      }

      const handler = {
        contentContainer,
        mountContent,
        unmountContent,
        isMounted: false,
      };

      handlers.set(element, handler);

      const placeholderHeight = estimateDayContentHeight(dayGroup, viewMode);
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
    destroy() {
      destroyed = true;
      observer?.disconnect();
      flushBatchedUnmounts([...handlers.values()].filter((handler) => handler.isMounted));
      handlers.clear();
    },
  };
}
