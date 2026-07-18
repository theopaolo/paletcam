import { clientLogWithOptions, sanitizeTelemetryContext } from "./client-log.js";
import { formatErrorDetails } from "./error-format.js";

const STACK_MAX_LENGTH = 2048;

function truncateStack(stack) {
  if (typeof stack !== "string" || stack.length === 0) {
    return "";
  }

  if (stack.length <= STACK_MAX_LENGTH) {
    return stack;
  }

  return `${stack.slice(0, STACK_MAX_LENGTH)}\n[truncated]`;
}

/**
 * @typedef {"error" | "warn"} ErrorConsoleLevel
 */

/**
 * @param {unknown} error
 * @param {Record<string, unknown>} [context]
 * @returns {Record<string, unknown>}
 */
export function buildErrorReportContext(error, context = {}) {
  const nextContext = { ...context };

  if (!error || typeof error !== "object") {
    return nextContext;
  }

  const errorRecord = /** @type {Record<string, unknown>} */ (error);

  if (typeof errorRecord.name === "string" && errorRecord.name) {
    nextContext.error = errorRecord.name;
  }

  if (typeof errorRecord.message === "string" && errorRecord.message) {
    nextContext.message = errorRecord.message;
  }

  if (typeof errorRecord.code === "string" && errorRecord.code) {
    nextContext.code = errorRecord.code;
  }

  if (typeof errorRecord.sourceKind === "string" && errorRecord.sourceKind) {
    nextContext.sourceKind = errorRecord.sourceKind;
  }

  if (Array.isArray(errorRecord.sourceAttempts) && errorRecord.sourceAttempts.length > 0) {
    nextContext.sourceAttempts = errorRecord.sourceAttempts;
  }

  const status = Number(errorRecord.status);
  if (Number.isFinite(status) && status > 0) {
    nextContext.status = status;
  }

  const stack = truncateStack(errorRecord.stack);
  if (stack) {
    nextContext.stack = stack;
  }

  const details = formatErrorDetails(error);
  if (details) {
    nextContext.details = details;
  }

  return sanitizeTelemetryContext(nextContext);
}

/**
 * Builds the deliberately smaller context allowed to leave the device. Console
 * diagnostics keep the rich message/details/stack through buildErrorReportContext.
 * @param {unknown} error
 * @param {Record<string, unknown>} [context]
 */
export function buildTelemetryErrorContext(error, context = {}) {
  const nextContext = { ...context };
  for (const key of Object.keys(nextContext)) {
    if (
      /(?:palette[-_]?id|remote[-_]?catch[-_]?id|catch[-_]?id|user[-_]?id|request[-_]?id)/i.test(
        key,
      )
    ) {
      delete nextContext[key];
    }
  }
  if (!error || typeof error !== "object") {
    return sanitizeTelemetryContext(nextContext);
  }

  const errorRecord = /** @type {Record<string, unknown>} */ (error);
  if (typeof errorRecord.name === "string" && errorRecord.name) {
    nextContext.errorName = errorRecord.name;
  }
  if (typeof errorRecord.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(errorRecord.code)) {
    nextContext.errorCode = errorRecord.code;
  }
  if (
    typeof errorRecord.sourceKind === "string" &&
    /^[a-z0-9-]{1,40}$/i.test(errorRecord.sourceKind)
  ) {
    nextContext.sourceKind = errorRecord.sourceKind;
  }
  if (Array.isArray(errorRecord.sourceAttempts)) {
    nextContext.sourceAttempts = errorRecord.sourceAttempts
      .filter((value) => typeof value === "string" && /^[a-z0-9-]{1,40}$/i.test(value))
      .slice(0, 8);
  }
  const status = Number(errorRecord.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    nextContext.status = status;
  }
  return sanitizeTelemetryContext(nextContext);
}

/**
 * @param {unknown} error
 * @param {StandardToastOptions} [options]
 * @returns {StandardToastOptions}
 */
export function createErrorToastOptions(error, options = {}) {
  const nextOptions = { ...options };

  if (!nextOptions.details) {
    const details = formatErrorDetails(error);
    if (details) {
      nextOptions.details = details;
    }
  }

  return nextOptions;
}

/**
 * @param {unknown} error
 * @param {object} [options]
 * @param {string} [options.logMessage]
 * @param {string} [options.consoleMessage]
 * @param {ErrorConsoleLevel} [options.consoleLevel]
 * @param {boolean} [options.includeConsole]
 * @param {boolean} [options.includeClientLog]
 * @param {string} [options.clientLogKey]
 * @param {number} [options.clientLogThrottleMs]
 * @param {Record<string, unknown>} [options.context]
 * @returns {Record<string, unknown>}
 */
export function reportAppError(
  error,
  {
    logMessage = "",
    consoleMessage = logMessage,
    consoleLevel = "error",
    includeConsole = true,
    includeClientLog = true,
    clientLogKey = "",
    clientLogThrottleMs = 0,
    context = {},
  } = {},
) {
  const nextContext = buildErrorReportContext(error, context);
  const telemetryContext = buildTelemetryErrorContext(error, context);

  if (includeConsole && consoleMessage) {
    const consoleMethod = consoleLevel === "warn" ? console.warn : console.error;
    if (Object.keys(nextContext).length > 0) {
      if (error && typeof error === "object") {
        consoleMethod(consoleMessage, nextContext, error);
      } else {
        consoleMethod(consoleMessage, nextContext);
      }
    } else {
      consoleMethod(consoleMessage, error);
    }
  }

  if (includeClientLog && logMessage) {
    clientLogWithOptions(logMessage, telemetryContext, {
      key: clientLogKey || logMessage,
      throttleMs: clientLogThrottleMs,
    });
  }

  return nextContext;
}
