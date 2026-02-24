const DAY_DURATION_MS = 24 * 60 * 60 * 1000;
const SESSION_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
});
const DAY_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function getPaletteTimestampDate(timestamp) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayPeriodInfo(date) {
  if (!date) {
    return { key: "night", label: "Nuit" };
  }

  const hour = date.getHours();

  if (hour < 5) {
    return { key: "night", label: "Nuit" };
  }

  if (hour < 8) {
    return { key: "early-morning", label: "Petit matin" };
  }

  if (hour < 12) {
    return { key: "morning", label: "Matin" };
  }

  if (hour < 17) {
    return { key: "afternoon", label: "Après-midi" };
  }

  if (hour < 22) {
    return { key: "evening", label: "Soirée" };
  }

  return { key: "night", label: "Nuit" };
}

function getDayLabel(date) {
  if (!date) {
    return "Jour inconnu";
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDiff = Math.round(
    (todayStart.getTime() - dateStart.getTime()) / DAY_DURATION_MS,
  );

  if (dayDiff === 0) {
    return "Aujourd'hui";
  }

  if (dayDiff === 1) {
    return "Hier";
  }

  return SESSION_WEEKDAY_FORMATTER.format(date);
}

function getDayDateLabel(date) {
  if (!date) {
    return "";
  }

  return DAY_DATE_FORMATTER.format(date);
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

export function groupPalettesByDay(palettes) {
  const dayGroups = [];
  let currentDay;
  let sessionsByPeriodKey;

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
        sessions: [],
      };
      dayGroups.push(currentDay);
      sessionsByPeriodKey = new Map();
    }

    const period = getDayPeriodInfo(paletteDate);
    let currentSession = sessionsByPeriodKey.get(period.key);

    if (!currentSession) {
      currentSession = {
        id: `session-${currentDay.key}-${period.key}`,
        title: period.label,
        palettes: [],
      };
      currentDay.sessions.push(currentSession);
      sessionsByPeriodKey.set(period.key, currentSession);
    }

    currentSession.palettes.push(palette);
    currentDay.paletteCount += 1;
  });

  return dayGroups;
}
