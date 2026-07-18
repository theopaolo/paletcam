import { clientLog } from "./client-log.js";
import { normalizeTelemetryPayload } from "../../services/log-server/src/telemetry-contract.js";

const SESSION_STARTED_KEY = "paletcam:metric:session-started:v1";
/**
 * Returns a bounded, schema-allowlisted operational metric, or null for an unknown event.
 * The schema intentionally excludes identifiers, URLs, free-form messages, and photo data.
 * @param {string} eventName
 * @param {Record<string, unknown>} [fields]
 */
export function normalizeOperationalMetric(eventName, fields = {}) {
  return normalizeTelemetryPayload({ message: `metric:${eventName}`, context: fields });
}

/**
 * Emits a privacy-safe operational metric with deterministic sampling support.
 * @param {string} eventName
 * @param {Record<string, unknown>} [fields]
 * @param {{log?: typeof clientLog, random?: () => number, sampleRate?: number}} [options]
 */
export function recordOperationalMetric(
  eventName,
  fields = {},
  { log = clientLog, random = Math.random, sampleRate = 1 } = {},
) {
  const metric = normalizeOperationalMetric(eventName, fields);
  const normalizedSampleRate = Math.max(0, Math.min(1, Number(sampleRate) || 0));
  if (!metric || normalizedSampleRate === 0 || random() >= normalizedSampleRate) {
    return false;
  }

  return log(metric.message, metric.context) !== false;
}

/** Records one session denominator per browser tab lifecycle, including reloads. */
export function recordSessionStarted({ storage = globalThis.sessionStorage, ...options } = {}) {
  try {
    if (storage?.getItem(SESSION_STARTED_KEY)) {
      return false;
    }
    storage?.setItem(SESSION_STARTED_KEY, "1");
  } catch {
    // Restricted storage must not prevent startup or the best-effort metric.
  }

  return recordOperationalMetric("session-started", {}, options);
}

/**
 * @param {string} operation
 * @param {unknown} error
 * @param {{log?: typeof clientLog, random?: () => number, sampleRate?: number}} [options]
 */
export function recordIndexedDbFailure(operation, error, options) {
  return recordOperationalMetric(
    "indexeddb-failure",
    { operation, errorName: error instanceof Error ? error.name : "Error" },
    options,
  );
}
