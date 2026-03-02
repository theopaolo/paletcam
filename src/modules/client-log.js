const LOCAL_API_BASE_URL = "/api/v1";
const LIVE_API_BASE_URL = "https://ccs.preview.name/api/v1";

function isLocalDevHost() {
  const hostname = String(globalThis.location?.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function getLogEndpoint() {
  const baseUrl = isLocalDevHost() ? LOCAL_API_BASE_URL : LIVE_API_BASE_URL;

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
