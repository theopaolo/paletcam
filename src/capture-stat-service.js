import { getApiBaseUrl } from "./config.js";

const PENDING_COUNT_KEY = "paletcam:stats:pending:local_capture";
const API_EVENT = "local_capture";

/**
 * Returns the Capacitor global if running inside a native app, otherwise null.
 *
 * @returns {typeof globalThis.Capacitor | null}
 */
function getCapacitor() {
  const cap = /** @type {any} */ (globalThis).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/**
 * @returns {'ios' | 'android' | null}
 */
function detectPlatform() {
  const cap = getCapacitor();
  if (!cap) {
    return null;
  }
  const p = String(cap.getPlatform?.() || "").toLowerCase();
  if (p === "android") {
    return "android";
  }
  return "ios";
}

function isOnline() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function getPendingCount() {
  const raw = localStorage.getItem(PENDING_COUNT_KEY);
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function setPendingCount(n) {
  if (n <= 0) {
    localStorage.removeItem(PENDING_COUNT_KEY);
  } else {
    localStorage.setItem(PENDING_COUNT_KEY, String(n));
  }
}

async function flushCaptureStats() {
  const count = getPendingCount();
  if (count <= 0 || !isOnline()) {
    return;
  }

  const platform = detectPlatform();
  const body = /** @type {Record<string, unknown>} */ ({ event: API_EVENT, count });
  if (platform !== null) {
    body.platform = platform;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      setPendingCount(0);
    }
  } catch {
    // Silent — will retry on next online event or capture.
  }
}

/**
 * Call this every time a local capture is saved.
 * Increments the pending counter and attempts an immediate flush (fire-and-forget).
 */
export function trackCaptureStatAsync() {
  setPendingCount(getPendingCount() + 1);
  flushCaptureStats();
}

function setupNetworkListener() {
  const cap = getCapacitor();

  if (cap?.Plugins?.Network) {
    cap.Plugins.Network.addListener("networkStatusChange", (/** @type {{ connected: boolean }} */ status) => {
      if (status.connected) {
        flushCaptureStats();
      }
    });
    return;
  }

  globalThis.addEventListener?.("online", flushCaptureStats);
}

// Drain any stats left over from a previous session.
setupNetworkListener();
flushCaptureStats();
