import { clientLog } from "./client-log.js";

const handlerCleanupByWindow = new WeakMap();

function describeRejectionReason(reason) {
  if (reason && typeof reason === "object") {
    return {
      name: typeof reason.name === "string" ? reason.name : "",
      reasonType: reason.constructor?.name || "object",
    };
  }

  return {
    name: "",
    reasonType: typeof reason,
  };
}

export function bindUncaughtErrorHandlers() {
  if (typeof window === "undefined") {
    return () => {};
  }

  const targetWindow = window;
  const existingCleanup = handlerCleanupByWindow.get(targetWindow);
  if (existingCleanup) return existingCleanup;

  const handleError = (event) => {
    const error = event.error;
    clientLog("uncaught:error", {
      name: typeof error?.name === "string" ? error.name : "",
      lineno: Number.isFinite(event.lineno) ? event.lineno : 0,
      colno: Number.isFinite(event.colno) ? event.colno : 0,
    });
  };

  const handleRejection = (event) => {
    clientLog("uncaught:rejection", describeRejectionReason(event.reason));
  };

  targetWindow.addEventListener("error", handleError);
  targetWindow.addEventListener("unhandledrejection", handleRejection);

  const cleanup = () => {
    targetWindow.removeEventListener("error", handleError);
    targetWindow.removeEventListener("unhandledrejection", handleRejection);
    if (handlerCleanupByWindow.get(targetWindow) === cleanup) {
      handlerCleanupByWindow.delete(targetWindow);
    }
  };
  handlerCleanupByWindow.set(targetWindow, cleanup);
  return cleanup;
}
