import { describe, expect, test } from "bun:test";
import { PaletteBackupIntegrityError, PaletteBackupSizeLimitError } from "./json-transfer.js";
import { PaletteImportConflictError, PaletteImportInterruptedError } from "./import-staging.js";
import {
  BACKUP_TRANSFER_CATEGORIES,
  classifyBackupTransferError,
  createPaletteBackupAbortError,
} from "./backup-transfer-errors.js";

describe("backup transfer error taxonomy", () => {
  test.each([
    [createPaletteBackupAbortError(), "import", "transfer", "cancelled"],
    [new PaletteBackupSizeLimitError(), "import", "transfer", "size-limit"],
    [new PaletteBackupIntegrityError(), "export", "transfer", "integrity"],
    [new PaletteImportConflictError(), "import", "transfer", "conflict"],
    [new PaletteImportInterruptedError(), "import", "transfer", "interrupted"],
    [new DOMException("full", "QuotaExceededError"), "import", "transfer", "quota"],
    [new DOMException("closed", "InvalidStateError"), "export", "transfer", "database"],
    [new SyntaxError("private parser detail"), "import", "transfer", "invalid-file"],
    [new Error("private serializer detail"), "export", "transfer", "serialization"],
    [new Error("browser blocked save"), "export", "file-handoff", "file-handoff"],
  ])("classifies %s during %s/%s as %s", (error, operation, phase, expected) => {
    expect(classifyBackupTransferError(error, { operation, phase })).toBe(expected);
  });

  test("exports a closed category vocabulary for UI and telemetry", () => {
    expect(new Set(Object.values(BACKUP_TRANSFER_CATEGORIES))).toEqual(
      new Set([
        "cancelled",
        "conflict",
        "database",
        "file-handoff",
        "integrity",
        "interrupted",
        "invalid-file",
        "quota",
        "serialization",
        "size-limit",
        "unknown",
      ]),
    );
  });
});
