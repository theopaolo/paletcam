/**
 * @typedef {"user-dismiss" | "swipe" | "interrupted" | "programmatic"} ToastDismissReason
 */

/**
 * Routes one terminal toast reason to exactly one callback. Action and timeout
 * retain their dedicated semantics; every other supported close path is an
 * explicit dismissal so callers can distinguish user acceptance from teardown.
 *
 * @param {{
 *   onAction?: () => void,
 *   onExpire?: () => void,
 *   onDismiss?: (reason: ToastDismissReason) => void,
 * }} entry
 * @param {"action" | "timeout" | ToastDismissReason} reason
 * @returns {"action" | "expire" | "dismiss" | "none"}
 */
export function settleToastEntry(entry, reason) {
  if (reason === "action") {
    entry.onAction?.();
    return entry.onAction ? "action" : "none";
  }

  if (reason === "timeout") {
    entry.onExpire?.();
    return entry.onExpire ? "expire" : "none";
  }

  if (new Set(["user-dismiss", "swipe", "interrupted", "programmatic"]).has(reason)) {
    entry.onDismiss?.(reason);
    return entry.onDismiss ? "dismiss" : "none";
  }

  return "none";
}
