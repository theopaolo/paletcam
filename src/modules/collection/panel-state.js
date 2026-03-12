export function buildCollectionPanelTitle(paletteCount) {
  const safeCount = Number.isFinite(paletteCount) ? Math.max(0, Math.round(paletteCount)) : 0;
  return `Captures (${safeCount})`;
}

export function getCollectionSessionIds(dayGroups) {
  return dayGroups.flatMap((dayGroup) => dayGroup.sessions.map((session) => session.id));
}

export function areAllCollectionSessionsCollapsed(dayGroups, collapsedSessionIds) {
  const sessionIds = getCollectionSessionIds(dayGroups);
  return sessionIds.length > 0 && sessionIds.every((sessionId) => collapsedSessionIds.has(sessionId));
}

export function collapseAllCollectionSessions(dayGroups, collapsedSessionIds) {
  let hasChanged = false;

  getCollectionSessionIds(dayGroups).forEach((sessionId) => {
    if (collapsedSessionIds.has(sessionId)) {
      return;
    }

    collapsedSessionIds.add(sessionId);
    hasChanged = true;
  });

  return hasChanged;
}

export function expandAllCollectionSessions(dayGroups, collapsedSessionIds) {
  let hasChanged = false;

  getCollectionSessionIds(dayGroups).forEach((sessionId) => {
    if (!collapsedSessionIds.has(sessionId)) {
      return;
    }

    collapsedSessionIds.delete(sessionId);
    hasChanged = true;
  });

  return hasChanged;
}

export function toggleAllCollectionSessions(dayGroups, collapsedSessionIds) {
  if (areAllCollectionSessionsCollapsed(dayGroups, collapsedSessionIds)) {
    return expandAllCollectionSessions(dayGroups, collapsedSessionIds);
  }

  return collapseAllCollectionSessions(dayGroups, collapsedSessionIds);
}
