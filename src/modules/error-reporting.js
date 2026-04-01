import { clientLog } from "./client-log.js";
import { formatErrorDetails } from "./error-format.js";

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

  const status = Number(error.status);
  if (Number.isFinite(status) && status > 0) {
    nextContext.status = status;
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
    context = {},
  } = {},
) {
  const nextContext = buildErrorReportContext(error, context);

  if (includeConsole && consoleMessage) {
    const consoleMethod = consoleLevel === "warn" ? console.warn : console.error;
    consoleMethod(consoleMessage, error);
  }

  if (includeClientLog && logMessage) {
    clientLog(logMessage, nextContext);
  }

  return nextContext;
}
