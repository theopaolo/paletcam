import { reportAppError } from "../modules/error-reporting.js";
import { db } from "./db.js";
import { normalizeBackupUid, normalizeRemoteOwnerAccountKey } from "./records.js";

function createPaletteDeletionError(message, code, cause) {
  const error = /** @type {Error & {code: string}} */ (
    new Error(message, cause === undefined ? undefined : { cause })
  );
  error.name = "PaletteDeletionError";
  error.code = code;
  return error;
}

function getPaletteIdOrThrow(id) {
  const paletteId = Number(id);
  if (!Number.isSafeInteger(paletteId) || paletteId <= 0) {
    throw createPaletteDeletionError("Invalid palette id.", "INVALID_PALETTE_ID");
  }
  return paletteId;
}

function getStoredRemoteCatchId(palette) {
  if (palette?.remoteCatchId === null || palette?.remoteCatchId === undefined) {
    return "";
  }
  return String(palette.remoteCatchId).trim();
}

/**
 * Atomically reserves remote cleanup, when needed, before removing all local
 * records for a palette. Callers must capture the account key before invoking
 * this async command so session replacement cannot detach the cleanup intent.
 *
 * @param {number | string} id
 * @param {object} [options]
 * @param {string} [options.accountKey]
 * @param {() => Promise<void>} [options.prepareRemoteCleanup]
 * @param {(intent: {accountKey: string, remoteCatchId: string}) => Promise<{reserved: boolean}>} [options.reserveRemoteCleanup]
 * @returns {Promise<{remoteCatchId: string, remoteCleanupQueued: boolean}>}
 */
export async function deletePalette(
  id,
  { accountKey = "", prepareRemoteCleanup = async () => {}, reserveRemoteCleanup } = {},
) {
  const paletteId = getPaletteIdOrThrow(id);
  const capturedAccountKey = String(accountKey || "").trim();

  try {
    await prepareRemoteCleanup();
    return await db.transaction(
      "rw",
      db.palettes,
      db.paletteAssets,
      db.palettePreviews,
      db.communityDeleteOutbox,
      db.backupTombstones,
      async () => {
        const storedPalette = await db.palettes.get(paletteId);
        if (!storedPalette) {
          throw createPaletteDeletionError("Palette was not found.", "PALETTE_NOT_FOUND");
        }

        const remoteCatchId = getStoredRemoteCatchId(storedPalette);
        if (remoteCatchId) {
          if (!capturedAccountKey) {
            throw createPaletteDeletionError(
              "Authentication is required to delete a published palette safely.",
              "REMOTE_CLEANUP_AUTH_REQUIRED",
            );
          }
          if (typeof reserveRemoteCleanup !== "function") {
            throw createPaletteDeletionError(
              "Remote cleanup storage is unavailable.",
              "REMOTE_CLEANUP_QUEUE_UNAVAILABLE",
            );
          }

          // Palettes published before ownership tracking store no owner; the
          // authenticated deleting account claims their remote cleanup, like
          // the unpublish path's legacy-ownership recovery.
          const remoteOwnerAccountKey = normalizeRemoteOwnerAccountKey(
            storedPalette.remoteOwnerAccountKey,
          );
          if (remoteOwnerAccountKey && remoteOwnerAccountKey !== capturedAccountKey) {
            throw createPaletteDeletionError(
              "The palette belongs to a different community account.",
              "REMOTE_CLEANUP_ACCOUNT_MISMATCH",
            );
          }

          const reservation = await reserveRemoteCleanup({
            accountKey: capturedAccountKey,
            remoteCatchId,
          });
          if (!reservation.reserved) {
            throw createPaletteDeletionError(
              "Remote cleanup could not be reserved.",
              "REMOTE_CLEANUP_QUEUE_UNAVAILABLE",
            );
          }
        }

        await db.palettePreviews.bulkDelete([
          [paletteId, "gallery"],
          [paletteId, "viewer"],
        ]);
        await db.paletteAssets.delete(paletteId);
        await db.palettes.delete(paletteId);

        // The backup flush loop turns this into a server-side tombstone; the
        // server no-ops on uids it never received, so recording one is always
        // safe even when the palette was deleted before its first upload.
        const backupUid = normalizeBackupUid(storedPalette.backupUid);
        if (backupUid) {
          await db.backupTombstones.put({ backupUid, deletedAt: new Date().toISOString() });
        }

        return {
          remoteCatchId,
          remoteCleanupQueued: Boolean(remoteCatchId),
        };
      },
    );
  } catch (error) {
    if (error?.name === "PaletteDeletionError") {
      throw error;
    }

    reportAppError(error, {
      consoleMessage: `Failed to delete palette ${paletteId}:`,
      includeClientLog: false,
    });
    throw createPaletteDeletionError("Unable to delete palette.", "PALETTE_DELETE_FAILED", error);
  }
}
