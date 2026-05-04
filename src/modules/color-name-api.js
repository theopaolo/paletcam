const COLOR_NAME_API_ENDPOINT = "https://api.color.pizza/v1/";
const COLOR_NAME_API_TIMEOUT_MS = 3000;

const colorNameCache = new Map();

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

function buildColorNameLookupUrl(hexValues) {
  const requestUrl = new URL(COLOR_NAME_API_ENDPOINT);
  requestUrl.searchParams.set("values", hexValues.map((hex) => hex.replace(/^#/, "")).join(","));
  requestUrl.searchParams.set("goodnamesonly", "true");
  requestUrl.searchParams.set("noduplicates", "true");
  return requestUrl.toString();
}

function getCachedColorName(hex) {
  const normalizedHex = normalizeHex(hex);
  if (!normalizedHex) {
    return "";
  }

  return colorNameCache.get(normalizedHex) ?? "";
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
  const missingHexValues = [...new Set(hexValues.filter((hex) => !getCachedColorName(hex)))];

  if (missingHexValues.length > 0 && typeof fetch === "function") {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => {
          controller.abort();
        }, COLOR_NAME_API_TIMEOUT_MS)
      : 0;

    try {
      const response = await fetch(buildColorNameLookupUrl(missingHexValues), {
        headers: {
          Accept: "application/json",
        },
        signal: controller?.signal,
      });

      if (response.ok) {
        const payload = await response.json();
        const responseColors = Array.isArray(payload?.colors) ? payload.colors : [];

        responseColors.forEach((entry, index) => {
          const colorName = typeof entry?.name === "string" ? entry.name.trim() : "";
          const requestedHex =
            normalizeHex(entry?.requestedHex) ||
            normalizeHex(entry?.hex) ||
            missingHexValues[index] ||
            "";

          if (!requestedHex || !colorName) {
            return;
          }

          colorNameCache.set(requestedHex, colorName);
        });
      }
    } catch {
      // Fall back to hex labels when the request fails or is blocked/offline.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return hexValues.map((hex) => getCachedColorName(hex) || hex);
}

export function resetColorNameCacheForTests() {
  colorNameCache.clear();
}
