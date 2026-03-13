export const DEFAULT_CAMERA_RESUME_DELAY_MS = 240;
export const IOS_CAMERA_LIFECYCLE_RESUME_DELAY_MS = 900;

const IOS_LIFECYCLE_RESUME_REASONS = new Set(["focus", "pageshow", "visibilitychange"]);

/**
 * Avoid touching getUserMedia again while iOS is still finishing an app switch.
 *
 * @param {{
 *   isIOS: boolean;
 *   reason: string;
 *   requestedDelayMs?: number;
 * }} options
 * @returns {number}
 */
export function getCameraResumeDelay({
  isIOS,
  reason,
  requestedDelayMs = DEFAULT_CAMERA_RESUME_DELAY_MS,
}) {
  if (!isIOS) {
    return requestedDelayMs;
  }

  if (!isIOSLifecycleResumeReason(reason)) {
    return requestedDelayMs;
  }

  return Math.max(requestedDelayMs, IOS_CAMERA_LIFECYCLE_RESUME_DELAY_MS);
}

function isIOSLifecycleResumeReason(reason) {
  if (IOS_LIFECYCLE_RESUME_REASONS.has(reason)) {
    return true;
  }

  return typeof reason === "string" && reason.startsWith("track-");
}
