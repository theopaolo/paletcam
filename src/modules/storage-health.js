import { clientLog } from "./client-log.js";

function toSafeByteCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Requests durable browser storage when supported and records coarse capacity diagnostics.
 * Failure is intentionally non-fatal: private browsing and some WebViews reject these APIs.
 */
export async function inspectStorageHealth(storage = globalThis.navigator?.storage) {
  const result = {
    supported: Boolean(storage),
    persisted: null,
    persistenceRequested: false,
    usageBytes: null,
    quotaBytes: null,
    usageRatio: null,
  };

  if (!storage) {
    return result;
  }

  if (typeof storage.persisted === "function") {
    try {
      result.persisted = Boolean(await storage.persisted());
    } catch (_error) {
      // Capability checks can reject in restricted browser contexts.
    }
  }

  if (result.persisted === false && typeof storage.persist === "function") {
    result.persistenceRequested = true;
    try {
      result.persisted = Boolean(await storage.persist());
    } catch (_error) {
      // The application remains usable with best-effort storage.
    }
  }

  if (typeof storage.estimate === "function") {
    try {
      const estimate = await storage.estimate();
      result.usageBytes = toSafeByteCount(estimate?.usage);
      result.quotaBytes = toSafeByteCount(estimate?.quota);
      if (result.usageBytes !== null && result.quotaBytes > 0) {
        result.usageRatio = Number((result.usageBytes / result.quotaBytes).toFixed(4));
      }
    } catch (_error) {
      // Estimation is diagnostic only.
    }
  }

  return result;
}

export async function initializeStorageHealth() {
  const diagnostics = await inspectStorageHealth();
  clientLog("storage:health", diagnostics);
  return diagnostics;
}
