import { getApiBaseUrl } from "../config.js";

function getLogEndpoint() {
  const baseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL("clientlog", `${baseUrl}/`).toString();
  }

  return `${baseUrl}/clientlog`;
}

export function clientLog(message, context = {}) {
  try {
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
  } catch (_error) {
    // fire and forget
  }
}
