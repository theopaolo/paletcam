import { getIntlLocale, t } from "../../i18n.js";

const DAY_DURATION_MS = 24 * 60 * 60 * 1000;

function getPaletteTimestampDate(timestamp) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayLabel(date) {
  if (!date) {
    return t("collection.day.unknown");
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / DAY_DURATION_MS);

  if (dayDiff === 0) {
    return t("collection.day.today");
  }

  if (dayDiff === 1) {
    return t("collection.day.yesterday");
  }

  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
  }).format(date);
}

function getDayDateLabel(date) {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(getIntlLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getDayKey(date) {
  if (!date) {
    return "unknown";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * @param {Palette[]} palettes
 * @returns {DayGroup[]}
 */
export function groupPalettesByDay(palettes) {
  const dayGroups = [];
  let currentDay;

  palettes.forEach((palette) => {
    const paletteDate = getPaletteTimestampDate(palette.timestamp);
    const paletteDayKey = getDayKey(paletteDate);
    const shouldStartNewDay = !currentDay || currentDay.key !== paletteDayKey;

    if (shouldStartNewDay) {
      currentDay = {
        key: paletteDayKey,
        id: `day-${paletteDayKey}`,
        title: getDayLabel(paletteDate),
        dateLabel: getDayDateLabel(paletteDate),
        paletteCount: 0,
        palettes: [],
      };
      dayGroups.push(currentDay);
    }

    currentDay.palettes.push(palette);
    currentDay.paletteCount += 1;
  });

  return dayGroups;
}
