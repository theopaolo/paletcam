import { normalizeTelemetryPayload } from "./telemetry-contract.js";

/**
 * Enforces the shared, closed telemetry schema at the final server trust boundary.
 * Unknown events return null and must not be persisted.
 */
export function sanitizeLogPayload(body) {
  return normalizeTelemetryPayload(body);
}
