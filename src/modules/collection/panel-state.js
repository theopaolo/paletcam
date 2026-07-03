import { t } from "../../i18n.js";

export function buildCollectionPanelTitle(paletteCount) {
  const safeCount = Number.isFinite(paletteCount) ? Math.max(0, Math.round(paletteCount)) : 0;
  return t("collection.panelTitleWithCount", { count: safeCount });
}

export function getCollectionDayIds(dayGroups) {
  return dayGroups.map((dayGroup) => dayGroup.id);
}

export function areAllCollectionDaysCollapsed(dayGroups, collapsedDayIds) {
  const dayIds = getCollectionDayIds(dayGroups);
  return dayIds.length > 0 && dayIds.every((dayId) => collapsedDayIds.has(dayId));
}

export function collapseAllCollectionDays(dayGroups, collapsedDayIds) {
  let hasChanged = false;

  getCollectionDayIds(dayGroups).forEach((dayId) => {
    if (collapsedDayIds.has(dayId)) {
      return;
    }

    collapsedDayIds.add(dayId);
    hasChanged = true;
  });

  return hasChanged;
}

export function expandAllCollectionDays(dayGroups, collapsedDayIds) {
  let hasChanged = false;

  getCollectionDayIds(dayGroups).forEach((dayId) => {
    if (!collapsedDayIds.has(dayId)) {
      return;
    }

    collapsedDayIds.delete(dayId);
    hasChanged = true;
  });

  return hasChanged;
}

export function toggleAllCollectionDays(dayGroups, collapsedDayIds) {
  if (areAllCollectionDaysCollapsed(dayGroups, collapsedDayIds)) {
    return expandAllCollectionDays(dayGroups, collapsedDayIds);
  }

  return collapseAllCollectionDays(dayGroups, collapsedDayIds);
}
