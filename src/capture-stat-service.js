import { getApiBaseUrl } from "./config.js";
import { requestJson } from "./modules/http-request.js";

const PENDING_COUNT_KEY = "paletcam:stats:pending:local_capture";
const API_EVENT = "local_capture";
const STATS_TIMEOUT_MS = 10_000;
let activeFlushPromise = null;
let requestStatsImplementation = requestJson;

/**
 * Returns the Capacitor global if running inside a native app, otherwise null.
 *
 * @returns {typeof globalThis.Capacitor | null}
 */
function getCapacitor() {
  const cap = globalThis.Capacitor;
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
  try {
    const raw = localStorage.getItem(PENDING_COUNT_KEY);
    const n = parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function setPendingCount(n) {
  try {
    if (n <= 0) {
      localStorage.removeItem(PENDING_COUNT_KEY);
    } else {
      localStorage.setItem(PENDING_COUNT_KEY, String(n));
    }
  } catch {
    // Metrics are best-effort and must never break capture persistence.
  }
}

export function flushCaptureStats() {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    while (isOnline()) {
      const count = getPendingCount();
      if (count <= 0) break;

      const platform = detectPlatform();
      const body = /** @type {Record<string, unknown>} */ ({ event: API_EVENT, count });
      if (platform !== null) {
        body.platform = platform;
      }

      try {
        await requestStatsImplementation(`${getApiBaseUrl()}/stats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          timeoutMs: STATS_TIMEOUT_MS,
        });
      } catch {
        break;
      }

      // Captures can arrive while the request is pending. Remove only the
      // acknowledged batch and leave newer events queued for the next pass.
      setPendingCount(Math.max(0, getPendingCount() - count));
    }
  })().finally(() => {
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}

/**
 * Call this every time a local capture is saved.
 * Increments the pending counter and attempts an immediate flush (fire-and-forget).
 */
export function trackCaptureStatAsync() {
  setPendingCount(getPendingCount() + 1);
  void flushCaptureStats();
}

function setupNetworkListener() {
  const cap = getCapacitor();

  if (cap?.Plugins?.Network) {
    cap.Plugins.Network.addListener(
      "networkStatusChange",
      (/** @type {{ connected: boolean }} */ status) => {
        if (status.connected) {
          void flushCaptureStats();
        }
      },
    );
    return;
  }

  globalThis.addEventListener?.("online", () => void flushCaptureStats());
}

// Drain any stats left over from a previous session.
setupNetworkListener();
void flushCaptureStats();

export function resetCaptureStatFlushForTests(requestImplementation = requestJson) {
  activeFlushPromise = null;
  requestStatsImplementation = requestImplementation;
}
