const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_COUNT = 10_000;

const COMMON_FIELDS = Object.freeze({
  appVersion: "version",
  clientFamily: "client-family",
  commitHash: "commit",
  correlationId: "correlation-id",
  environment: "environment",
  timestamp: "timestamp",
});

const METRIC_EVENTS = Object.freeze({
  "metric:backup-transfer": {
    category: "backup-category",
    direction: "backup-direction",
    durationMs: "duration",
    outcome: "outcome",
  },
  "metric:camera-start": {
    durationMs: "duration",
    errorName: "error-name",
    operation: "camera-operation",
    outcome: "outcome",
  },
  "metric:capture-save": {
    durationMs: "duration",
    errorName: "error-name",
    hasPalette: "boolean",
    outcome: "outcome",
  },
  "metric:indexeddb-failure": {
    errorName: "error-name",
    operation: "storage-operation",
  },
  "metric:service-worker-activation": { outcome: "outcome" },
  "metric:service-worker-registration": {
    durationMs: "duration",
    errorName: "error-name",
    outcome: "outcome",
  },
  "metric:service-worker-update": {
    durationMs: "duration",
    errorName: "error-name",
    outcome: "outcome",
  },
  "metric:session-started": {},
  "metric:worker-fallback": { errorName: "error-name", worker: "worker" },
});

const EVENT_FIELDS = Object.freeze({
  ...METRIC_EVENTS,
  "backup:flush-failed": { errorCode: "error-code" },
  "backup:restore-failed": { errorCode: "error-code", errorName: "error-name" },
  "Account deleted; local publication metadata cleanup failed.": {
    errorCode: "error-code",
    errorName: "error-name",
    operation: "account-operation",
    status: "http-status",
  },
  "Camera unavailable.": {
    errorCode: "error-code",
    errorName: "error-name",
    sourceKind: "source-kind",
    status: "http-status",
  },
  "Community API request failed.": {
    errorName: "error-name",
    failureKind: "failure-kind",
    method: "http-method",
    status: "http-status",
  },
  "Community API returned an invalid response.": { errorName: "error-name" },
  "Discarded invalid community deletion outbox records.": {
    discardedCount: "count",
    discardedCountCapped: "boolean",
  },
  "Failed to clean up palette publication during delete.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "cleanup-status",
  },
  "Failed to compensate a publication after local persistence failed.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to compensate a publication after its session changed.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to confirm account deletion.": {
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to delete palette.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to export palette verso.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to generate community magic link.": { errorName: "error-name" },
  "Failed to initialize remote deletion cleanup.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to load collection viewer.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to load collection.": { errorCode: "error-code", errorName: "error-name" },
  "Failed to load palette collection.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to load palette viewer preview.": {
    errorCode: "error-code",
    errorName: "error-name",
    sourceAttempts: "source-attempts",
    sourceKind: "source-kind",
  },
  "Failed to load palette viewer.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to persist palette private remote state.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to persist saved palette preview.": {
    errorCode: "error-code",
    errorName: "error-name",
    sourceAttempts: "source-attempts",
    sourceKind: "source-kind",
    variant: "preview-variant",
  },
  "Failed to process the remote deletion outbox.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to reconcile an uncertain community publication.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to queue remote cleanup after local palette deletion.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to release a collection resource.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to render palette gallery preview.": {
    errorCode: "error-code",
    errorName: "error-name",
    sourceAttempts: "source-attempts",
    sourceKind: "source-kind",
    variant: "preview-variant",
  },
  "Failed to save palette.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to send account deletion code.": {
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to send login code.": {
    errorName: "error-name",
    failureCode: "error-code",
    status: "http-status",
  },
  "Failed to sync moderation statuses.": {
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to update palette favorites.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Failed to update palette publication in bulk.": {
    action: "publication-action",
    errorCode: "error-code",
    errorName: "error-name",
    failureCount: "count",
    status: "http-status",
  },
  "Failed to update palette publication.": {
    action: "publication-action",
    errorCode: "error-code",
    errorName: "error-name",
    status: "http-status",
  },
  "Failed to verify login code.": {
    errorName: "error-name",
    failureCode: "error-code",
    status: "http-status",
  },
  "Failed to warm saved palette preview.": {
    errorCode: "error-code",
    errorName: "error-name",
    sourceAttempts: "source-attempts",
    sourceKind: "source-kind",
    variant: "preview-variant",
  },
  "Ignored invalid stored palette metadata records.": {
    invalidCount: "count",
    invalidCountCapped: "boolean",
  },
  "Palette extraction worker unavailable.": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "Restarting camera after app resume.": { isIOS: "boolean", reason: "resume-reason" },
  "getSavedPalettes:error": { errorName: "error-name", totalMs: "duration" },
  "getSavedPalettes:success": {
    dexieReadMs: "duration",
    rawCount: "count",
    returnedCount: "count",
    totalMs: "duration",
  },
  "loadCollectionUi:error": { errorName: "error-name", totalMs: "duration" },
  "loadCollectionUi:success": {
    displayedCount: "count",
    fetchedCount: "count",
    fetchMs: "duration",
    filterMs: "duration",
    renderMs: "duration",
    totalMs: "duration",
  },
  "paletteStorageMaintenance:error": {
    errorCode: "error-code",
    errorName: "error-name",
  },
  "paletteStorageMaintenance:success": {
    durationMs: "duration",
    markerSatisfied: "boolean",
    updatedCount: "count",
  },
  "storage:health": {
    persisted: "nullable-boolean",
    persistenceRequested: "boolean",
    quotaBytes: "byte-count",
    supported: "boolean",
    usageBytes: "byte-count",
    usageRatio: "ratio",
  },
  "uncaught:error": { colno: "source-position", lineno: "source-position", name: "error-name" },
  "uncaught:rejection": { name: "error-name", reasonType: "reason-type" },
});

const VALUES = Object.freeze({
  "account-operation": new Set(["account-deletion-local-cleanup"]),
  "backup-category": new Set([
    "cancelled",
    "conflict",
    "database",
    "file-handoff",
    "integrity",
    "interrupted",
    "invalid-file",
    "quota",
    "serialization",
    "size-limit",
    "unknown",
  ]),
  "backup-direction": new Set(["export", "import"]),
  "camera-operation": new Set(["rotate", "start"]),
  "cleanup-status": new Set(["authentication_required", "failed", "not_found"]),
  "client-family": new Set(["chrome", "edge", "firefox", "other", "safari", "samsung", "webview"]),
  environment: new Set(["development", "preprod", "production"]),
  "failure-kind": new Set([
    "aborted",
    "http",
    "invalid_response",
    "network",
    "response_too_large",
    "timeout",
    "unknown",
  ]),
  "http-method": new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]),
  outcome: new Set(["cancelled", "failure", "success", "unavailable"]),
  "preview-variant": new Set(["gallery", "viewer"]),
  "publication-action": new Set(["publish", "unpublish"]),
  "reason-type": new Set([
    "AbortError",
    "DOMException",
    "Error",
    "TypeError",
    "boolean",
    "number",
    "object",
    "string",
    "symbol",
    "undefined",
  ]),
  "resume-reason": new Set([
    "focus",
    "pageshow",
    "track-ended",
    "track-mute",
    "track-unmute",
    "visibilitychange",
  ]),
  "source-kind": new Set(["canvas-data-url", "original", "reader-data-url"]),
  "storage-operation": new Set([
    "asset-read",
    "asset-write",
    "clear",
    "delete",
    "maintenance",
    "read",
    "save",
    "update",
  ]),
  worker: new Set(["palette-extraction", "palette-json"]),
});

const ERROR_NAMES = new Set([
  "AbortError",
  "CommunityApiError",
  "ConstraintError",
  "DataError",
  "DOMException",
  "Error",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "TypeError",
  "UnknownError",
]);

const ERROR_CODES = new Set([
  // Backup client codes (lowercase by protocol, see src/backup-api.js).
  "network",
  "quota_exceeded",
  "rate_limited",
  "server",
  "unauthorized",
  "unknown",
  "unpaired",
  "ALREADY_PUBLISHED",
  "API_ERROR",
  "AUTH_EXPIRED",
  "INVALID_PHOTO",
  "LOCAL_PERSISTENCE_FAILED",
  "MISSING_CODE",
  "MISSING_COLORS",
  "MISSING_EMAIL",
  "MISSING_PALETTE",
  "MISSING_PHOTO",
  "MISSING_REMOTE_ID",
  "MISSING_TOKEN",
  "NOT_AUTHENTICATED",
  "NOT_PUBLIC",
  "NOT_PUBLISHED",
  "PALETTE_BACKUP_SIZE_LIMIT",
  "PALETTE_IMPORT_CONFLICT",
  "PUBLICATION_STATE_UNCERTAIN",
  "REQUEST_CANCELLED",
]);

const SOURCE_ATTEMPTS = VALUES["source-kind"];

/** @param {unknown} value @param {number} maximum */
function normalizeInteger(value, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(maximum, Math.round(number));
}

/** @param {string} rule @param {unknown} value */
function normalizeField(rule, value) {
  if (rule === "boolean") return typeof value === "boolean" ? value : undefined;
  if (rule === "nullable-boolean") {
    return value === null || typeof value === "boolean" ? value : undefined;
  }
  if (rule === "duration") return normalizeInteger(value, MAX_DURATION_MS);
  if (rule === "count") return normalizeInteger(value, MAX_COUNT);
  if (rule === "byte-count") return normalizeInteger(value, Number.MAX_SAFE_INTEGER);
  if (rule === "source-position") return normalizeInteger(value, 10_000_000);
  if (rule === "http-status") {
    const status = normalizeInteger(value, 599);
    return status === undefined || (status !== 0 && status < 100) ? undefined : status;
  }
  if (rule === "ratio") {
    const ratio = Number(value);
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1
      ? Math.round(ratio * 10_000) / 10_000
      : undefined;
  }
  if (rule === "error-name") {
    if (typeof value !== "string" || value.length === 0) return undefined;
    return ERROR_NAMES.has(value) ? value : "OtherError";
  }
  if (rule === "error-code") {
    return typeof value === "string" && ERROR_CODES.has(value) ? value : undefined;
  }
  if (rule === "source-attempts") {
    if (!Array.isArray(value)) return undefined;
    return value.filter((item) => SOURCE_ATTEMPTS.has(item)).slice(0, 3);
  }
  if (rule === "version") {
    return typeof value === "string" && /^(?:|[0-9][0-9A-Za-z.+-]{0,39})$/.test(value)
      ? value
      : undefined;
  }
  if (rule === "commit") {
    return typeof value === "string" && /^(?:|unknown|[a-f0-9]{7,64})$/.test(value)
      ? value
      : undefined;
  }
  if (rule === "correlation-id") {
    return typeof value === "string" && isValidTelemetryCorrelationId(value)
      ? value.toLowerCase()
      : undefined;
  }
  if (rule === "timestamp") {
    return typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value))
      ? value
      : undefined;
  }
  /** @type {Set<unknown> | undefined} */
  const values = Reflect.get(VALUES, rule);
  return values?.has(value) ? value : undefined;
}

/** Returns a schema-normalized payload or null for an unknown event. @param {unknown} body */
export function normalizeTelemetryPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = /** @type {Record<string, unknown>} */ (body);
  const message = payload.message;
  if (typeof message !== "string") return null;
  /** @type {Record<string, string> | undefined} */
  const eventFields = Reflect.get(EVENT_FIELDS, message);
  if (!eventFields) return null;

  const candidateContext = payload.context;
  const sourceContext =
    candidateContext && typeof candidateContext === "object" && !Array.isArray(candidateContext)
      ? /** @type {Record<string, unknown>} */ (candidateContext)
      : {};
  const schema = { ...COMMON_FIELDS, ...eventFields };
  /** @type {Record<string, unknown>} */
  const context = {};
  for (const [field, rule] of Object.entries(schema)) {
    const normalized = normalizeField(rule, sourceContext[field]);
    if (normalized !== undefined) context[field] = normalized;
  }
  return { message, context };
}

/** @param {unknown} message */
export function isKnownTelemetryEvent(message) {
  return typeof message === "string" && Object.hasOwn(EVENT_FIELDS, message);
}

/** @param {unknown} value */
export function isValidTelemetryCorrelationId(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function getTelemetryEventNames() {
  return Object.freeze(Object.keys(EVENT_FIELDS).sort());
}

/** @param {unknown} userAgent */
export function classifyClientFamily(userAgent) {
  const value = String(userAgent ?? "");
  if (/SamsungBrowser/i.test(value)) return "samsung";
  if (/(?:; wv\)|\bwv\b|WebView)/i.test(value)) return "webview";
  if (/(?:Edg|Edge)\//i.test(value)) return "edge";
  if (/(?:Firefox|FxiOS)\//i.test(value)) return "firefox";
  if (/(?:Chrome|CriOS)\//i.test(value)) return "chrome";
  if (/Safari\//i.test(value)) return "safari";
  return "other";
}
