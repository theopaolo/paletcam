import { getLogApiBaseUrl } from "../config.js";
import {
  classifyClientFamily,
  isValidTelemetryCorrelationId,
  normalizeTelemetryPayload,
} from "../../services/log-server/src/telemetry-contract.js";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
const COMMIT_HASH = typeof __COMMIT_HASH__ === "string" ? __COMMIT_HASH__ : "";
const DEPLOY_BRANCH =
  typeof __PALETCAM_DEPLOY_BRANCH__ === "string" ? __PALETCAM_DEPLOY_BRANCH__ : "";
const RELEASE_ENVIRONMENT = DEPLOY_BRANCH.toLowerCase().endsWith("/prod")
  ? "production"
  : DEPLOY_BRANCH.toLowerCase().endsWith("/preprod")
    ? "preprod"
    : "development";
const CORRELATION_STORAGE_KEY = "paletcam:telemetry-correlation:v1";
export const MAX_CLIENT_LOG_DELIVERIES = 20;
export const CLIENT_LOG_DELIVERY_TIMEOUT_MS = 10_000;
const MAX_THROTTLE_KEYS = 100;

function createCorrelationId() {
  try {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (isValidTelemetryCorrelationId(randomUuid)) return randomUuid.toLowerCase();

    if (typeof globalThis.crypto?.getRandomValues !== "function") return "";
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    const candidate = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return isValidTelemetryCorrelationId(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

/** @param {Storage | null | undefined} [storage] */
export function getSessionCorrelationId(storage) {
  try {
    const activeStorage = storage === undefined ? globalThis.sessionStorage : storage;
    const existing = activeStorage?.getItem(CORRELATION_STORAGE_KEY);
    if (typeof existing === "string" && isValidTelemetryCorrelationId(existing)) {
      return existing.toLowerCase();
    }

    const next = createCorrelationId();
    if (next) activeStorage?.setItem(CORRELATION_STORAGE_KEY, next);
    return next;
  } catch {
    return createCorrelationId();
  }
}

const CORRELATION_ID = getSessionCorrelationId();
/** @type {Map<string, number>} */
const throttledLogKeys = new Map();
/** @type {Array<{endpoint: string, body: string}>} */
const pendingLogDeliveries = [];
let isLogDeliveryInFlight = false;
let attemptedLogDeliveryCount = 0;
let droppedLogDeliveryCount = 0;
let failedLogDeliveryCount = 0;
const MAX_CONTEXT_DEPTH = 4;
const MAX_CONTEXT_ENTRIES = 40;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 1024;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|session|credential|email|photo|blob|code)/i;
const IDENTIFIER_KEY_PATTERN =
  /(?:palette[-_]?id|remote[-_]?catch[-_]?id|catch[-_]?id|user[-_]?id|request[-_]?id)/i;

/** @param {unknown} value */
function redactTextSecrets(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
}

/** @param {unknown} value @param {number} [maxLength] */
function truncateText(value, maxLength = MAX_STRING_LENGTH) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}[truncated]`;
}

/** @param {unknown} value @returns {unknown} */
function sanitizeUrl(value) {
  if (typeof value !== "string") return value;

  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    const trailingPunctuation = match.match(/[),.;]+$/)?.[0] ?? "";
    const candidate = trailingPunctuation ? match.slice(0, -trailingPunctuation.length) : match;
    try {
      const url = new URL(candidate);
      url.search = "";
      url.hash = "";
      return `${url.toString()}${trailingPunctuation}`;
    } catch (_error) {
      return match;
    }
  });
}

/**
 * Produces a bounded, JSON-safe telemetry context without credentials or URL query data.
 * @param {unknown} value
 * @param {number} [depth]
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function sanitizeTelemetryValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return truncateText(redactTextSecrets(sanitizeUrl(value)));
  if (typeof value === "bigint") return truncateText(value);
  if (typeof value !== "object") return undefined;
  if (depth >= MAX_CONTEXT_DEPTH) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeTelemetryValue(item, depth + 1, seen));
  }

  /** @type {Record<string, unknown>} */
  const sanitized = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_CONTEXT_ENTRIES)) {
    if (IDENTIFIER_KEY_PATTERN.test(key)) {
      continue;
    }
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[redacted]"
      : sanitizeTelemetryValue(item, depth + 1, seen);
  }
  return sanitized;
}

/**
 * @param {unknown} context
 * @returns {Record<string, unknown>}
 */
export function sanitizeTelemetryContext(context) {
  const sanitized = sanitizeTelemetryValue(context);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? /** @type {Record<string, unknown>} */ (sanitized)
    : {};
}

function getLogEndpoint() {
  const baseUrl = getLogApiBaseUrl();
  if (!baseUrl) return "";

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL("clientlog", `${baseUrl}/`).toString();
  }

  return `${baseUrl}/clientlog`;
}

/** @param {number} value */
function incrementBoundedCounter(value) {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function runNextLogDelivery() {
  if (isLogDeliveryInFlight) return;
  const delivery = pendingLogDeliveries.shift();
  if (!delivery) return;

  isLogDeliveryInFlight = true;
  attemptedLogDeliveryCount = incrementBoundedCounter(attemptedLogDeliveryCount);

  let request;
  try {
    request = fetch(delivery.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: delivery.body,
      signal: AbortSignal.timeout(CLIENT_LOG_DELIVERY_TIMEOUT_MS),
    });
  } catch (_error) {
    request = Promise.reject(_error);
  }

  void Promise.resolve(request)
    .then((response) => {
      if (response?.ok === false) {
        failedLogDeliveryCount = incrementBoundedCounter(failedLogDeliveryCount);
      }
    })
    .catch(() => {
      failedLogDeliveryCount = incrementBoundedCounter(failedLogDeliveryCount);
    })
    .finally(() => {
      isLogDeliveryInFlight = false;
      runNextLogDelivery();
    });
}

/** @param {string} endpoint @param {string} body */
function enqueueLogDelivery(endpoint, body) {
  const deliveryCount = pendingLogDeliveries.length + (isLogDeliveryInFlight ? 1 : 0);
  if (deliveryCount >= MAX_CLIENT_LOG_DELIVERIES) {
    droppedLogDeliveryCount = incrementBoundedCounter(droppedLogDeliveryCount);
    return false;
  }

  pendingLogDeliveries.push({ endpoint, body });
  runNextLogDelivery();
  return true;
}

export function getClientLogDeliveryStats() {
  return {
    attemptedCount: attemptedLogDeliveryCount,
    droppedCount: droppedLogDeliveryCount,
    failedCount: failedLogDeliveryCount,
    inFlight: isLogDeliveryInFlight,
    pendingCount: pendingLogDeliveries.length,
  };
}

/** @param {unknown} message @param {Record<string, unknown>} [context] */
export function clientLog(message, context = {}) {
  return clientLogWithOptions(message, context);
}

/**
 * @param {unknown} message
 * @param {Record<string, unknown>} [context]
 * @param {{key?: unknown, throttleMs?: number}} [options]
 */
export function clientLogWithOptions(
  message,
  context = {},
  { key = message, throttleMs = 0 } = {},
) {
  try {
    if (typeof message !== "string") return false;
    const logEndpoint = getLogEndpoint();
    if (!logEndpoint) return false;
    const payload = normalizeTelemetryPayload({
      message,
      context: {
        ...context,
        appVersion: APP_VERSION,
        clientFamily: classifyClientFamily(globalThis.navigator?.userAgent),
        commitHash: COMMIT_HASH,
        correlationId: CORRELATION_ID,
        environment: RELEASE_ENVIRONMENT,
        timestamp: new Date().toISOString(),
      },
    });
    if (!payload) return false;

    const normalizedKey = typeof key === "string" && key ? key : message;
    let throttleRecordedAt = 0;
    if (throttleMs > 0 && normalizedKey) {
      const now = Date.now();
      const lastSentAt = throttledLogKeys.get(normalizedKey) ?? 0;
      if (now - lastSentAt < throttleMs) {
        return false;
      }
      throttleRecordedAt = now;
    }

    const body = JSON.stringify(payload);
    if (!enqueueLogDelivery(logEndpoint, body)) return false;

    // A capacity-dropped event was never accepted for delivery, so it must not
    // suppress a later retry through the throttle window.
    if (throttleRecordedAt > 0) {
      if (!throttledLogKeys.has(normalizedKey) && throttledLogKeys.size >= MAX_THROTTLE_KEYS) {
        const oldestKey = throttledLogKeys.keys().next().value;
        if (oldestKey !== undefined) throttledLogKeys.delete(oldestKey);
      }
      throttledLogKeys.delete(normalizedKey);
      throttledLogKeys.set(normalizedKey, throttleRecordedAt);
    }
    return true;
  } catch (_error) {
    return false;
  }
}

export function resetClientLogThrottleForTests() {
  throttledLogKeys.clear();
}

export function resetClientLogDeliveryStateForTests() {
  if (isLogDeliveryInFlight || pendingLogDeliveries.length > 0) {
    throw new Error("Cannot reset client-log delivery state while delivery is active.");
  }
  attemptedLogDeliveryCount = 0;
  droppedLogDeliveryCount = 0;
  failedLogDeliveryCount = 0;
}
