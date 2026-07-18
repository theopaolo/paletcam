import { beginCriticalOperation } from "../critical-operation.js";

/**
 * Coordinates the irreversible deletion use case while keeping adapters injected.
 * Undo timers, DOM restoration, toasts, and collection reloads remain presentation concerns.
 * @param {object} adapters
 * @param {(paletteId: number) => Promise<{remoteCatchId: string, remoteCleanupQueued: boolean}>} adapters.commitLocalPaletteDeletion
 * @param {(palette: Palette) => void} adapters.disposePreviewAsset
 * @param {(options: {force: boolean}) => Promise<Record<string, unknown>>} adapters.flushRemoteCleanup
 * @param {(paletteId: number) => void} adapters.notifyDeleted
 */
export function createPaletteDeletionUseCase({
  commitLocalPaletteDeletion,
  disposePreviewAsset,
  flushRemoteCleanup,
  notifyDeleted,
}) {
  /** @param {Palette} palette */
  return async function deletePaletteWithCleanup(palette) {
    const releaseCriticalOperation = beginCriticalOperation("palette-deletion");
    try {
      let deletionCommit;
      try {
        deletionCommit = await commitLocalPaletteDeletion(palette.id);
      } catch (error) {
        return { success: false, error };
      }

      disposePreviewAsset(palette);
      notifyDeleted(palette.id);

      let remoteFlushError = null;
      let remoteFlushResult = null;
      if (deletionCommit.remoteCleanupQueued) {
        try {
          remoteFlushResult = await flushRemoteCleanup({ force: true });
        } catch (error) {
          // The cleanup intent is already durable. A flush failure must not
          // misreport the committed local deletion as failed.
          remoteFlushError = error;
        }
      }

      return {
        success: true,
        remoteCatchId: deletionCommit.remoteCatchId,
        remoteCleanupQueued: deletionCommit.remoteCleanupQueued,
        remoteFlushError,
        remoteFlushResult,
      };
    } finally {
      releaseCriticalOperation();
    }
  };
}
