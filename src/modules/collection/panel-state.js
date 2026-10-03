import { t } from "../../i18n.js";

export function buildCollectionPanelTitle(paletteCount) {
  const safeCount = Number.isFinite(paletteCount) ? Math.max(0, Math.round(paletteCount)) : 0;
  return t("collection.panelTitleWithCount", { count: safeCount });
}
