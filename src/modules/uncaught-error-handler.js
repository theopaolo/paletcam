import { clientLog } from "./client-log.js";

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

function describeRejectionReason(reason) {
  if (reason && typeof reason === "object") {
    return {
      name: typeof reason.name === "string" ? reason.name : "",
      message:
        typeof reason.message === "string" && reason.message
          ? reason.message
          : String(reason),
      stack: truncateStack(reason.stack),
    };
  }

  return {
    name: "",
    message: String(reason ?? ""),
    stack: "",
  };
}

export function bindUncaughtErrorHandlers() {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("error", (event) => {
    const error = event.error;
    clientLog("uncaught:error", {
      name: typeof error?.name === "string" ? error.name : "",
      message: event.message || error?.message || "",
      filename: event.filename || "",
      lineno: Number.isFinite(event.lineno) ? event.lineno : 0,
      colno: Number.isFinite(event.colno) ? event.colno : 0,
      stack: truncateStack(error?.stack),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    clientLog("uncaught:rejection", describeRejectionReason(event.reason));
  });
}
