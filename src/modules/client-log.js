import { getLogApiBaseUrl } from "../config.js";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
const COMMIT_HASH = typeof __COMMIT_HASH__ === "string" ? __COMMIT_HASH__ : "";

function getLogEndpoint() {
  const baseUrl = getLogApiBaseUrl();

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
        appVersion: APP_VERSION,
        commitHash: COMMIT_HASH,
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
