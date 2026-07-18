import { db } from "./db.js";
import {
  PALETTE_IMPORT_CONFLICT_ERROR_CODE,
  PALETTE_IMPORT_INTERRUPTED_ERROR_CODE,
} from "./backup-error-codes.js";
import { createPaletteAssetRecord, createPaletteMetadataRecord } from "./records.js";

export {
  PALETTE_IMPORT_CONFLICT_ERROR_CODE,
  PALETTE_IMPORT_INTERRUPTED_ERROR_CODE,
} from "./backup-error-codes.js";

export const PALETTE_IMPORT_STAGING_BATCH_SIZE = 25;
// Every staged batch refreshes the lease. Five minutes is long enough for a
// throttled mobile worker while keeping crash recovery from blocking retries
// for an unreasonable amount of time.
export const PALETTE_IMPORT_LEASE_TIMEOUT_MS = 5 * 60 * 1_000;

const ACTIVE_IMPORT_MARKER_KEY = "palette-import-active:v1";

export class PaletteImportConflictError extends Error {
  constructor(message = "Another palette import is already in progress.") {
    super(message);
    this.name = "PaletteImportConflictError";
    this.code = PALETTE_IMPORT_CONFLICT_ERROR_CODE;
  }
}

export class PaletteImportInterruptedError extends Error {
  constructor(message = "The palette import was interrupted and can no longer continue.") {
    super(message);
    this.name = "PaletteImportInterruptedError";
    this.code = PALETTE_IMPORT_INTERRUPTED_ERROR_CODE;
  }
}

function createSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `palette-import-${Date.now().toString(36)}-${randomPart}`;
}

function isActiveImportMarker(marker) {
  return (
    marker?.key === ACTIVE_IMPORT_MARKER_KEY &&
    typeof marker.sessionId === "string" &&
    marker.sessionId.length > 0 &&
    marker.state === "staging" &&
    Number.isSafeInteger(marker.stagedCount) &&
    marker.stagedCount >= 0 &&
    Number.isFinite(marker.updatedAtMs)
  );
}

function isMarkerStale(marker, nowMs, maxAgeMs) {
  return !isActiveImportMarker(marker) || nowMs - marker.updatedAtMs >= maxAgeMs;
}

function getStagingCollection(sessionId) {
  return db.paletteImportStaging.where("sessionId").equals(sessionId);
}

function assertOwnedSession(marker, sessionId) {
  if (!isActiveImportMarker(marker) || marker.sessionId !== sessionId) {
    throw new PaletteImportInterruptedError();
  }
  return marker;
}

function assertNormalizedPalette(palette, index) {
  if (!palette || typeof palette !== "object" || !(palette.photoBlob instanceof Blob)) {
    throw new Error(`Cannot import palette ${index + 1} without photo data.`);
  }
}

function createImportedMetadata(palette, fallbackRenderSettings) {
  const { photoBlob: _photoBlob, ...paletteMetadata } = palette;

  return createPaletteMetadataRecord({
    timestamp: paletteMetadata.timestamp || new Date().toISOString(),
    colors: paletteMetadata.colors || [],
    captureAspectRatio: paletteMetadata.captureAspectRatio || "4:3",
    captureCropRect: paletteMetadata.captureCropRect || null,
    captureMode: paletteMetadata.captureMode,
    ralMatch: paletteMetadata.ralMatch ?? null,
    remoteCatchId: paletteMetadata.remoteCatchId ?? null,
    remoteOwnerAccountKey: paletteMetadata.remoteOwnerAccountKey ?? null,
    moderationStatus: paletteMetadata.moderationStatus ?? null,
    postedAt: paletteMetadata.postedAt ?? null,
    moderationUpdatedAt: paletteMetadata.moderationUpdatedAt ?? null,
    lastModerationCheckAt: paletteMetadata.lastModerationCheckAt ?? null,
    polaroidRenderSettings: paletteMetadata.polaroidRenderSettings ?? fallbackRenderSettings,
    hasPhotoAsset: true,
  });
}

/**
 * Acquires the durable, cross-tab import lease. A stale lease and all of its
 * unreachable staging rows are removed atomically before ownership changes.
 *
 * @param {{nowMs?: number, staleAfterMs?: number}} [options]
 * @returns {Promise<string>}
 */
export async function beginImportSession({
  nowMs = Date.now(),
  staleAfterMs = PALETTE_IMPORT_LEASE_TIMEOUT_MS,
} = {}) {
  const sessionId = createSessionId();
  const normalizedStaleAfterMs = Math.max(1, Number(staleAfterMs) || 1);

  await db.transaction("rw", db.paletteStorageMetadata, db.paletteImportStaging, async () => {
    const marker = await db.paletteStorageMetadata.get(ACTIVE_IMPORT_MARKER_KEY);
    if (isActiveImportMarker(marker) && !isMarkerStale(marker, nowMs, normalizedStaleAfterMs)) {
      throw new PaletteImportConflictError();
    }

    // There can be only one owner. Clearing the isolated store also recovers
    // rows whose marker was lost independently by a browser/storage failure.
    await db.paletteImportStaging.clear();
    await db.paletteStorageMetadata.put({
      key: ACTIVE_IMPORT_MARKER_KEY,
      sessionId,
      state: "staging",
      stagedCount: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  });

  return sessionId;
}

/**
 * Persists a bounded batch outside the live palette stores. Batch ordinal
 * allocation and lease refresh happen in the same transaction, making retries
 * fail closed rather than silently duplicating a partially accepted batch.
 *
 * @param {string} sessionId
 * @param {Array<object>} palettes
 * @param {{nowMs?: number}} [options]
 * @returns {Promise<number>} total staged palette count
 */
export async function stageImportBatch(sessionId, palettes, { nowMs = Date.now() } = {}) {
  if (!Array.isArray(palettes) || palettes.length === 0) {
    throw new Error("A palette import batch must not be empty.");
  }
  if (palettes.length > PALETTE_IMPORT_STAGING_BATCH_SIZE) {
    throw new Error(
      `A palette import batch cannot exceed ${PALETTE_IMPORT_STAGING_BATCH_SIZE} palettes.`,
    );
  }
  palettes.forEach(assertNormalizedPalette);

  return db.transaction("rw", db.paletteStorageMetadata, db.paletteImportStaging, async () => {
    const marker = assertOwnedSession(
      await db.paletteStorageMetadata.get(ACTIVE_IMPORT_MARKER_KEY),
      sessionId,
    );
    const firstOrdinal = marker.stagedCount;
    const stagingRecords = palettes.map((palette, index) => ({
      sessionId,
      ordinal: firstOrdinal + index,
      palette,
    }));

    await db.paletteImportStaging.bulkAdd(stagingRecords);
    const stagedCount = firstOrdinal + stagingRecords.length;
    await db.paletteStorageMetadata.put({
      ...marker,
      stagedCount,
      updatedAtMs: nowMs,
    });
    return stagedCount;
  });
}

/**
 * Copies an entire completed staging session into the live stores atomically.
 * Only primary keys are collected up front; each Blob-bearing staging record is
 * then read and written individually, avoiding a whole-backup `toArray()`.
 *
 * @param {string} sessionId
 * @param {PolaroidRenderSettings} fallbackRenderSettings
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<number>}
 */
export async function commitImportSession(sessionId, fallbackRenderSettings, { signal } = {}) {
  const throwIfAborted = () => {
    if (!signal?.aborted) {
      return;
    }
    if (signal.reason instanceof Error) {
      throw signal.reason;
    }
    const error = new Error("Palette import was cancelled.");
    error.name = "AbortError";
    throw error;
  };

  throwIfAborted();
  return db.transaction(
    "rw",
    db.paletteStorageMetadata,
    db.paletteImportStaging,
    db.palettes,
    db.paletteAssets,
    async () => {
      throwIfAborted();
      const marker = assertOwnedSession(
        await db.paletteStorageMetadata.get(ACTIVE_IMPORT_MARKER_KEY),
        sessionId,
      );
      const stagingCollection = getStagingCollection(sessionId);
      const stagingKeys = (await stagingCollection.primaryKeys()).sort(
        (left, right) => Number(left?.[1]) - Number(right?.[1]),
      );

      const hasCompleteOrdinalSequence = stagingKeys.every(
        (key, index) => Array.isArray(key) && key[0] === sessionId && key[1] === index,
      );
      if (stagingKeys.length !== marker.stagedCount || !hasCompleteOrdinalSequence) {
        throw new PaletteImportInterruptedError(
          "The staged palette count is incomplete; no palettes were imported.",
        );
      }

      let importedCount = 0;
      for (const stagingKey of stagingKeys) {
        throwIfAborted();
        const stagedRecord = await db.paletteImportStaging.get(stagingKey);
        if (
          !stagedRecord ||
          stagedRecord.sessionId !== sessionId ||
          !(stagedRecord.palette?.photoBlob instanceof Blob)
        ) {
          throw new PaletteImportInterruptedError(
            "A staged palette is missing or damaged; no palettes were imported.",
          );
        }

        const paletteId = await db.palettes.add(
          createImportedMetadata(stagedRecord.palette, fallbackRenderSettings),
        );
        await db.paletteAssets.put(
          createPaletteAssetRecord(paletteId, stagedRecord.palette.photoBlob),
        );
        throwIfAborted();
        importedCount += 1;
      }

      throwIfAborted();
      await stagingCollection.delete();
      await db.paletteStorageMetadata.delete(ACTIVE_IMPORT_MARKER_KEY);
      return importedCount;
    },
  );
}

/**
 * Discards only the caller's session. It never deletes a newer cross-tab
 * owner's staging rows if the old caller resumes after lease recovery.
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function abortImportSession(sessionId) {
  return db.transaction("rw", db.paletteStorageMetadata, db.paletteImportStaging, async () => {
    const marker = await db.paletteStorageMetadata.get(ACTIVE_IMPORT_MARKER_KEY);
    if (!isActiveImportMarker(marker) || marker.sessionId !== sessionId) {
      return false;
    }

    await getStagingCollection(sessionId).delete();
    await db.paletteStorageMetadata.delete(ACTIVE_IMPORT_MARKER_KEY);
    return true;
  });
}

/**
 * Removes staging data only when its durable lease is absent, corrupt, or old.
 * This is safe to run at startup in every tab because the marker check and
 * deletion share one read-write transaction.
 *
 * @param {{nowMs?: number, staleAfterMs?: number}} [options]
 * @returns {Promise<{cleaned: boolean}>}
 */
export async function cleanupStaleImportSessions({
  nowMs = Date.now(),
  staleAfterMs = PALETTE_IMPORT_LEASE_TIMEOUT_MS,
} = {}) {
  if (!db.paletteImportStaging) {
    return { cleaned: false };
  }

  const normalizedStaleAfterMs = Math.max(1, Number(staleAfterMs) || 1);
  return db.transaction("rw", db.paletteStorageMetadata, db.paletteImportStaging, async () => {
    const marker = await db.paletteStorageMetadata.get(ACTIVE_IMPORT_MARKER_KEY);
    if (marker && !isMarkerStale(marker, nowMs, normalizedStaleAfterMs)) {
      return { cleaned: false };
    }

    await db.paletteImportStaging.clear();
    if (marker) {
      await db.paletteStorageMetadata.delete(ACTIVE_IMPORT_MARKER_KEY);
    }
    return { cleaned: true };
  });
}
