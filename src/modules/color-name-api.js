import { colornames as offlineColorNames } from "color-name-list/bestof";

import { deltaE2000, rgbToLab } from "./color-distance.js";

const colorNameCache = new Map();
const exactHexNameLookup = new Map();

const offlineColorNameEntries = offlineColorNames
  .map((entry) => {
    const normalizedHex = normalizeHex(entry?.hex);
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const rgb = hexToRgb(normalizedHex);
    const lab = rgb ? rgbToLab(rgb.r, rgb.g, rgb.b) : null;

    if (normalizedHex && name) {
      exactHexNameLookup.set(normalizedHex, name);
    }

    return {
      name,
      hex: normalizedHex,
      lab,
    };
  })
  .filter((entry) => entry.name && entry.hex && entry.lab);

function clampChannel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(numeric)));
}

function toHexPair(value) {
  return clampChannel(value).toString(16).padStart(2, "0");
}

function normalizeHex(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .slice(0, 6);
  return /^[\da-f]{6}$/i.test(normalized) ? `#${normalized.toUpperCase()}` : "";
}

function getCachedColorName(hex) {
  const normalizedHex = normalizeHex(hex);
  if (!normalizedHex) {
    return "";
  }

  return colorNameCache.get(normalizedHex) ?? "";
}

function hexToRgb(hex) {
  const normalizedHex = normalizeHex(hex);
  if (!normalizedHex) {
    return null;
  }

  return {
    r: Number.parseInt(normalizedHex.slice(1, 3), 16),
    g: Number.parseInt(normalizedHex.slice(3, 5), 16),
    b: Number.parseInt(normalizedHex.slice(5, 7), 16),
  };
}

function findOfflineColorName(hex) {
  const normalizedHex = normalizeHex(hex);
  if (!normalizedHex) {
    return "";
  }

  const exactName = exactHexNameLookup.get(normalizedHex);
  if (exactName) {
    return exactName;
  }

  const rgb = hexToRgb(normalizedHex);
  if (!rgb) {
    return "";
  }

  const inputLab = rgbToLab(rgb.r, rgb.g, rgb.b);
  let closestName = "";
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const entry of offlineColorNameEntries) {
    const distance = deltaE2000(inputLab, entry.lab);
    if (distance >= closestDistance) {
      continue;
    }

    closestDistance = distance;
    closestName = entry.name;
  }

  return closestName;
}

/**
 * @param {{ r: number, g: number, b: number }} color
 * @returns {string}
 */
export function toColorNameHex(color) {
  return `#${toHexPair(color?.r)}${toHexPair(color?.g)}${toHexPair(color?.b)}`.toUpperCase();
}

/**
 * @param {Array<{ r: number, g: number, b: number }>} colors
 * @returns {Promise<string[]>}
 */
export async function getColorNames(colors) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return [];
  }

  const hexValues = colors.map((color) => toColorNameHex(color));

  for (const hex of new Set(hexValues)) {
    if (getCachedColorName(hex)) {
      continue;
    }

    const resolvedName = findOfflineColorName(hex);
    if (resolvedName) {
      colorNameCache.set(hex, resolvedName);
    }
  }

  return hexValues.map((hex) => getCachedColorName(hex) || hex);
}

export function resetColorNameCacheForTests() {
  colorNameCache.clear();
}
