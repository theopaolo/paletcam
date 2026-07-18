import {
  PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
  PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
  PALETTE_IMPORT_CONFLICT_ERROR_CODE,
  PALETTE_IMPORT_INTERRUPTED_ERROR_CODE,
} from "./backup-error-codes.js";

export const PALETTE_BACKUP_CANCELLED_ERROR_CODE = "PALETTE_BACKUP_CANCELLED";

export const BACKUP_TRANSFER_CATEGORIES = Object.freeze({
  cancelled: "cancelled",
  conflict: "conflict",
  database: "database",
  fileHandoff: "file-handoff",
  integrity: "integrity",
  interrupted: "interrupted",
  invalidFile: "invalid-file",
  quota: "quota",
  serialization: "serialization",
  sizeLimit: "size-limit",
  unknown: "unknown",
});

const DATABASE_ERROR_NAMES = new Set([
  "AbortError",
  "BlockedError",
  "ConstraintError",
  "DatabaseClosedError",
  "InvalidStateError",
  "PrematureCommitError",
  "ReadOnlyError",
  "TransactionInactiveError",
  "UnknownError",
  "VersionError",
]);

export function createPaletteBackupAbortError() {
  const error = /** @type {Error & {code: string}} */ (
    new Error("Palette backup operation was cancelled because the app closed.")
  );
  error.name = "AbortError";
  error.code = PALETTE_BACKUP_CANCELLED_ERROR_CODE;
  return error;
}

/**
 * Maps raw worker, parser, IndexedDB, and browser handoff failures to a stable,
 * identifier-free recovery category.
 *
 * @param {unknown} error
 * @param {{ operation: "export" | "import", phase?: "transfer" | "file-handoff" }} context
 */
export function classifyBackupTransferError(error, { operation, phase = "transfer" }) {
  const errorRecord =
    error && typeof error === "object" ? /** @type {Record<string, unknown>} */ (error) : {};
  const code = typeof errorRecord.code === "string" ? errorRecord.code : "";
  const name = typeof errorRecord.name === "string" ? errorRecord.name : "";

  if (code === PALETTE_BACKUP_CANCELLED_ERROR_CODE) {
    return BACKUP_TRANSFER_CATEGORIES.cancelled;
  }
  if (code === PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE) {
    return BACKUP_TRANSFER_CATEGORIES.sizeLimit;
  }
  if (code === PALETTE_BACKUP_INTEGRITY_ERROR_CODE) {
    return BACKUP_TRANSFER_CATEGORIES.integrity;
  }
  if (code === PALETTE_IMPORT_CONFLICT_ERROR_CODE) {
    return BACKUP_TRANSFER_CATEGORIES.conflict;
  }
  if (code === PALETTE_IMPORT_INTERRUPTED_ERROR_CODE) {
    return BACKUP_TRANSFER_CATEGORIES.interrupted;
  }
  if (operation === "export" && phase === "file-handoff") {
    return BACKUP_TRANSFER_CATEGORIES.fileHandoff;
  }
  if (name === "QuotaExceededError") {
    return BACKUP_TRANSFER_CATEGORIES.quota;
  }
  if (DATABASE_ERROR_NAMES.has(name)) {
    return BACKUP_TRANSFER_CATEGORIES.database;
  }
  if (operation === "import") {
    return BACKUP_TRANSFER_CATEGORIES.invalidFile;
  }
  if (operation === "export") {
    return BACKUP_TRANSFER_CATEGORIES.serialization;
  }
  return BACKUP_TRANSFER_CATEGORIES.unknown;
}
