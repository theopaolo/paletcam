import { detentFeedback, unlockUiFeedback } from "../ui-feedback.js";

/** Keeps the group heading in view when the rail scrolls to a group. */
const SCROLL_HEADROOM_PX = 8;

/**
 * @typedef {object} RailEntry
 * @property {string} color CSS color of the catch's strongest color.
 * @property {string} label What the loupe shows over this catch.
 * @property {Element} target The element to scroll to: its day, its month, or the chip itself.
 */

/**
 * The scrub rail down the collection's right edge, painted with every catch's
 * strongest color in display order. Dragging it scrolls the collection, a loupe
 * follows the finger with the color and the group, and each new group clicks.
 * @param {object} config
 * @param {HTMLElement} config.host Positioned element the rail and loupe sit in.
 * @param {HTMLElement} config.scrollRoot The element that scrolls the cards.
 */
export function createCollectionRail({ host, scrollRoot }) {
  const rail = document.createElement("div");
  rail.className = "collection-rail";
  rail.hidden = true;
  const bar = document.createElement("div");
  bar.className = "collection-rail-bar";
  const notch = document.createElement("span");
  notch.className = "collection-rail-notch";
  bar.appendChild(notch);
  rail.appendChild(bar);

  const loupe = document.createElement("div");
  loupe.className = "collection-rail-loupe";
  loupe.setAttribute("aria-hidden", "true");
  const loupeLabel = document.createElement("span");
  loupeLabel.className = "collection-rail-loupe-label";
  const loupeDisc = document.createElement("span");
  loupeDisc.className = "collection-rail-loupe-disc";
  loupe.append(loupeLabel, loupeDisc);
  host.append(rail, loupe);

  /** @type {RailEntry[]} */
  let entries = [];
  /** Consecutive entries sharing a scroll target. @type {{ target: Element, start: number, count: number }[]} */
  let runs = [];
  let isScrubbing = false;
  let lastLabel = "";
  let notchFrame = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const topOf = (element) =>
    element.getBoundingClientRect().top -
    scrollRoot.getBoundingClientRect().top +
    scrollRoot.scrollTop;

  const setNotch = (index) => {
    notch.style.top = `${((index + 0.5) / entries.length) * 100}%`;
  };

  /** The catch at the top of the view, read off its group's position. */
  const getIndexAtScroll = () => {
    if (scrollRoot.scrollTop >= scrollRoot.scrollHeight - scrollRoot.clientHeight - 1) {
      return entries.length - 1;
    }
    const y = scrollRoot.scrollTop + SCROLL_HEADROOM_PX + 1;
    let low = 0;
    let high = runs.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (topOf(runs[middle].target) <= y) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const run = runs[found];
    const within = (y - topOf(run.target)) / Math.max(1, run.target.offsetHeight);
    return run.start + Math.floor(clamp(within, 0, 0.9999) * run.count);
  };

  const scrubTo = (clientY) => {
    const barRect = bar.getBoundingClientRect();
    const fraction = clamp((clientY - barRect.top) / barRect.height, 0, 0.9999);
    const index = Math.floor(fraction * entries.length);
    const run = runs.findLast((candidate) => candidate.start <= index) ?? runs[0];
    scrollRoot.scrollTop =
      topOf(run.target) +
      ((index - run.start) / run.count) * run.target.offsetHeight -
      SCROLL_HEADROOM_PX;

    const entry = entries[index];
    setNotch(index);
    loupe.style.top = `${clientY - host.getBoundingClientRect().top}px`;
    loupeDisc.style.backgroundColor = entry.color;
    loupeLabel.textContent = entry.label;
    if (entry.label !== lastLabel) {
      if (lastLabel) {
        detentFeedback("analyze");
      }
      lastLabel = entry.label;
    }
  };

  const endScrub = () => {
    isScrubbing = false;
    lastLabel = "";
    host.classList.remove("is-scrubbing");
  };

  const handlePointerDown = (event) => {
    unlockUiFeedback();
    rail.setPointerCapture?.(event.pointerId);
    isScrubbing = true;
    host.classList.add("is-scrubbing");
    scrubTo(event.clientY);
  };
  const handlePointerMove = (event) => {
    if (isScrubbing) {
      scrubTo(event.clientY);
    }
  };
  const handleScroll = () => {
    if (isScrubbing || notchFrame || runs.length === 0) {
      return;
    }
    notchFrame = requestAnimationFrame(() => {
      notchFrame = 0;
      setNotch(getIndexAtScroll());
    });
  };

  rail.addEventListener("pointerdown", handlePointerDown);
  rail.addEventListener("pointermove", handlePointerMove);
  rail.addEventListener("pointerup", endScrub);
  rail.addEventListener("pointercancel", endScrub);
  scrollRoot.addEventListener("scroll", handleScroll, { passive: true });

  return {
    /** @param {RailEntry[]} nextEntries */
    setEntries(nextEntries) {
      entries = nextEntries;
      runs = [];
      entries.forEach((entry, index) => {
        const run = runs.at(-1);
        if (run?.target === entry.target) {
          run.count += 1;
        } else {
          runs.push({ target: entry.target, start: index, count: 1 });
        }
      });
      rail.hidden = entries.length < 2;
      bar.style.backgroundImage =
        entries.length < 2
          ? ""
          : `linear-gradient(${entries
              .map(
                (entry, index) =>
                  `${entry.color} ${(((index + 0.5) / entries.length) * 100).toFixed(2)}%`,
              )
              .join(", ")})`;
      if (entries.length > 1) {
        setNotch(getIndexAtScroll());
      }
    },
    destroy() {
      cancelAnimationFrame(notchFrame);
      scrollRoot.removeEventListener("scroll", handleScroll);
      rail.remove();
      loupe.remove();
    },
  };
}
