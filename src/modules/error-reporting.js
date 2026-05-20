import { clientLogWithOptions } from "./client-log.js";
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

  if (typeof error.name === "string" && error.name) {
    nextContext.error = error.name;
  }

  if (typeof error.message === "string" && error.message) {
    nextContext.message = error.message;
  }

  if (typeof error.code === "string" && error.code) {
    nextContext.code = error.code;
  }

  if (typeof error.sourceKind === "string" && error.sourceKind) {
    nextContext.sourceKind = error.sourceKind;
  }

  if (Array.isArray(error.sourceAttempts) && error.sourceAttempts.length > 0) {
    nextContext.sourceAttempts = error.sourceAttempts;
  }

  const status = Number(error.status);
  if (Number.isFinite(status) && status > 0) {
    nextContext.status = status;
  }

  const stack = truncateStack(error.stack);
  if (stack) {
    nextContext.stack = stack;
  }

  const details = formatErrorDetails(error);
  if (details) {
    nextContext.details = details;
  }

  return nextContext;
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
    clientLogWithOptions(logMessage, nextContext, {
      key: clientLogKey || logMessage,
      throttleMs: clientLogThrottleMs,
    });
  }

  return nextContext;
}
