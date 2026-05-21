import { toRgbCss } from "../color-format.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

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

function getSessionAverageColor(session) {
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let sampleCount = 0;

  session.palettes.forEach((palette) => {
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

function createSessionCaret() {
  const caret = document.createElement("span");
  caret.className = "collection-session-caret";

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

function createSessionCover(session) {
  const cover = document.createElement("div");
  cover.className = "collection-session-cover";
  cover.setAttribute("aria-hidden", "true");

  const averageColor = getSessionAverageColor(session);
  const darkColor = offsetColor(averageColor, -38);
  const lightColor = offsetColor(averageColor, 26);

  cover.style.backgroundImage = `linear-gradient(108deg, ${
    toRgbCss(darkColor)
  } 0%, ${toRgbCss(averageColor)} 52%, ${toRgbCss(lightColor)} 100%)`;

  return cover;
}

function setSessionCollapsed(sessionElement, isCollapsed) {
  const toggle = sessionElement.querySelector(".collection-session-toggle");
  if (!toggle) {
    return;
  }

  sessionElement.classList.toggle("is-collapsed", isCollapsed);
  toggle.setAttribute("aria-expanded", String(!isCollapsed));
}

function animateSessionExpansion(
  sessionElement,
  { sessionRevealDurationMs, sessionRevealStaggerMs },
) {
  const sessionBody = sessionElement.querySelector(".collection-session-body");
  if (!sessionBody) {
    return;
  }

  const shouldReduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (shouldReduceMotion) {
    return;
  }

  const cards = [...sessionBody.querySelectorAll(".palette-card")];
  if (cards.length === 0) {
    return;
  }

  cards.forEach((card, index) => {
    card.style.setProperty("--reveal-index", String(index));
    card.classList.remove("is-revealing");
  });

  void sessionBody.offsetHeight;

  cards.forEach((card) => {
    card.classList.add("is-revealing");
  });

  window.setTimeout(() => {
    cards.forEach((card) => {
      card.classList.remove("is-revealing");
    });
  }, sessionRevealDurationMs + sessionRevealStaggerMs * cards.length);
}

function createSessionGroup({
  session,
  createPaletteCard,
  isSessionCollapsed,
  onSessionCollapsedChange,
  sessionRevealDurationMs,
  sessionRevealStaggerMs,
}) {
  const section = document.createElement("section");
  section.className = "collection-session";
  section.dataset.sessionId = session.id;

  const sessionBodyId = `${session.id}-body`;

  const headerButton = document.createElement("button");
  headerButton.type = "button";
  headerButton.className = "collection-session-toggle";
  headerButton.setAttribute("aria-controls", sessionBodyId);

  const title = document.createElement("span");
  title.className = "collection-session-title";
  title.textContent = session.title;

  const meta = document.createElement("span");
  meta.className = "collection-session-meta";

  const count = document.createElement("span");
  count.className = "collection-session-count";
  count.textContent = String(session.palettes.length);

  meta.append(count, createSessionCaret());
  headerButton.append(title, meta);

  const body = document.createElement("div");
  body.className = "collection-session-body";
  body.id = sessionBodyId;
  const cover = createSessionCover(session);

  session.palettes.forEach((palette) => {
    body.appendChild(createPaletteCard(palette));
  });

  headerButton.addEventListener("click", () => {
    const currentlyCollapsed = section.classList.contains("is-collapsed");
    const nextCollapsedState = !currentlyCollapsed;
    setSessionCollapsed(section, nextCollapsedState);
    onSessionCollapsedChange?.(session.id, nextCollapsedState);

    if (nextCollapsedState) {
      return;
    }

    animateSessionExpansion(section, {
      sessionRevealDurationMs,
      sessionRevealStaggerMs,
    });
  });

  section.append(cover, headerButton, body);
  setSessionCollapsed(section, isSessionCollapsed(session.id));

  return section;
}

function createDayGrid(dayGroup, createPaletteCard) {
  const grid = document.createElement("div");
  grid.className = "collection-day-grid";

  dayGroup.sessions.forEach((session) => {
    session.palettes.forEach((palette) => {
      grid.appendChild(createPaletteCard(palette));
    });
  });

  return grid;
}

/**
 * @param {object} config
 * @param {DayGroup} config.dayGroup
 * @param {(palette: Palette) => HTMLElement} config.createPaletteCard
 * @param {(sessionId: string) => boolean} config.isSessionCollapsed
 * @param {(sessionId: string, collapsed: boolean) => void} config.onSessionCollapsedChange
 * @param {number} config.sessionRevealDurationMs
 * @param {number} config.sessionRevealStaggerMs
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
  isSessionCollapsed,
  onSessionCollapsedChange,
  sessionRevealDurationMs,
  sessionRevealStaggerMs,
  viewMode = "list",
}) {
  const daySection = document.createElement("section");
  daySection.className = "collection-day";
  daySection.dataset.dayId = dayGroup.id;
  daySection.dataset.viewMode = viewMode;
  daySection.dataset.paletteCount = String(dayGroup.paletteCount);

  const dayHeader = document.createElement("div");
  dayHeader.className = "collection-day-header dock";

  const dayTitle = document.createElement("p");
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

  const mountContent = () => {
    contentContainer.style.minHeight = "";

    if (viewMode === "grid" || viewMode === "swatch") {
      contentContainer.appendChild(createDayGrid(dayGroup, createPaletteCard));
      return;
    }

    const sessionsContainer = document.createElement("div");
    sessionsContainer.className = "collection-day-sessions";

    dayGroup.sessions.forEach((session) => {
      sessionsContainer.appendChild(
        createSessionGroup({
          session,
          createPaletteCard,
          isSessionCollapsed,
          onSessionCollapsedChange,
          sessionRevealDurationMs,
          sessionRevealStaggerMs,
        }),
      );
    });

    contentContainer.appendChild(sessionsContainer);
  };

  const unmountContent = (preMeasuredHeight) => {
    const height = preMeasuredHeight ?? contentContainer.offsetHeight;
    if (height > 0) {
      lastMeasuredHeight = height;
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
