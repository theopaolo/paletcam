import { toRgbCss } from "../color-format.js";

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

function getSessionCaretMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 5.5L8 10.3l4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
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
  onBeforeSessionToggle,
  onSessionCollapsedChange,
  onSessionExpanded,
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
  headerButton.innerHTML = `
    <span class="collection-session-title">${session.title}</span>
    <span class="collection-session-meta">
      <span class="collection-session-count">${session.palettes.length}</span>
      <span class="collection-session-caret">${getSessionCaretMarkup()}</span>
    </span>
  `;

  const body = document.createElement("div");
  body.className = "collection-session-body";
  body.id = sessionBodyId;
  const cover = createSessionCover(session);

  session.palettes.forEach((palette) => {
    body.appendChild(createPaletteCard(palette));
  });

  headerButton.addEventListener("click", () => {
    onBeforeSessionToggle?.(session.id);

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
    onSessionExpanded?.(session.id);
  });

  section.append(cover, headerButton, body);
  setSessionCollapsed(section, isSessionCollapsed(session.id));

  return section;
}

export function createDayGroup({
  dayGroup,
  createPaletteCard,
  isSessionCollapsed,
  onBeforeSessionToggle,
  onSessionCollapsedChange,
  onSessionExpanded,
  sessionRevealDurationMs,
  sessionRevealStaggerMs,
}) {
  const daySection = document.createElement("section");
  daySection.className = "collection-day";
  daySection.dataset.dayId = dayGroup.id;

  const dayHeader = document.createElement("header");
  dayHeader.className = "collection-day-header";

  const dayTitle = document.createElement("p");
  dayTitle.className = "collection-day-title";
  dayTitle.textContent = dayGroup.dateLabel
    ? `${dayGroup.title} — ${dayGroup.dateLabel}`
    : dayGroup.title;

  const dayCount = document.createElement("span");
  dayCount.className = "collection-day-count";
  dayCount.textContent = String(dayGroup.paletteCount);

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "collection-day-sessions";

  dayGroup.sessions.forEach((session) => {
    sessionsContainer.appendChild(
      createSessionGroup({
        session,
        createPaletteCard,
        isSessionCollapsed,
        onBeforeSessionToggle,
        onSessionCollapsedChange,
        onSessionExpanded,
        sessionRevealDurationMs,
        sessionRevealStaggerMs,
      }),
    );
  });

  dayHeader.append(dayTitle, dayCount);
  daySection.append(dayHeader, sessionsContainer);
  return daySection;
}
