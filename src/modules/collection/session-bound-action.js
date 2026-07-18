/**
 * Applies async action effects only while the originating UI session remains
 * current. This prevents a close/reopen race from mutating a newer overlay.
 *
 * @param {{
 *   isCurrent: () => boolean,
 *   onCurrentFinally?: () => void,
 *   onCurrentSuccess?: () => void,
 *   run: () => Promise<unknown>,
 * }} options
 */
export async function runSessionBoundAction({
  isCurrent,
  onCurrentFinally = () => {},
  onCurrentSuccess = () => {},
  run,
}) {
  try {
    await run();
    if (!isCurrent()) return false;
    onCurrentSuccess();
    return true;
  } finally {
    if (isCurrent()) onCurrentFinally();
  }
}
