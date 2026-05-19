import { getLogApiBaseUrl } from "../config.js";

const throttledLogKeys = new Map();

function getLogEndpoint() {
  const baseUrl = getLogApiBaseUrl();

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL("clientlog", `${baseUrl}/`).toString();
  }

  return `${baseUrl}/clientlog`;
}

export function clientLog(message, context = {}) {
  return clientLogWithOptions(message, context);
}

export function clientLogWithOptions(
  message,
  context = {},
  { key = message, throttleMs = 0 } = {},
) {
  try {
    const normalizedKey = typeof key === "string" && key ? key : message;
    if (throttleMs > 0 && normalizedKey) {
      const now = Date.now();
      const lastSentAt = throttledLogKeys.get(normalizedKey) ?? 0;
      if (now - lastSentAt < throttleMs) {
        return false;
      }

      throttledLogKeys.set(normalizedKey, now);
    }

    const body = JSON.stringify({
      message,
      context: {
        ...context,
        userAgent: navigator.userAgent,
        url: globalThis.location?.href,
        timestamp: new Date().toISOString(),
      },
    });

    fetch(getLogEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
    return true;
  } catch (_error) {
    return false;
  }
}

export function resetClientLogThrottleForTests() {
  throttledLogKeys.clear();
}
