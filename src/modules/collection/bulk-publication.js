/**
 * Aggregates sequential bulk-publication outcomes independently of UI effects.
 * Sequential execution keeps community mutations ordered and cancellation
 * observable between items.
 * @param {object} options
 * @param {Palette[]} options.palettes
 * @param {(palette: Palette) => Promise<{status: string, error?: unknown, actionConfig?: {shouldReloadOnAlreadyDone?: boolean}}>} options.runAction
 * @param {() => boolean} [options.isCancelled]
 * @param {() => boolean} [options.isSessionCurrent]
 */
export async function runBulkPublication({
  palettes,
  runAction,
  isCancelled = () => false,
  isSessionCurrent = () => true,
}) {
  let successCount = 0;
  let alreadyDoneCount = 0;
  let failureCount = 0;
  let authRequired = false;
  let firstFailure = null;
  let sessionChanged = false;
  let shouldReload = false;

  for (const palette of palettes) {
    if (isCancelled()) {
      break;
    }
    if (!isSessionCurrent()) {
      sessionChanged = true;
      break;
    }

    let result;
    try {
      result = await runAction(palette);
    } catch (error) {
      result = { status: "error", error };
    }

    if (result.status === "success") {
      successCount += 1;
      shouldReload = true;
      continue;
    }

    if (result.status === "already_done") {
      alreadyDoneCount += 1;
      shouldReload = shouldReload || Boolean(result.actionConfig?.shouldReloadOnAlreadyDone);
      continue;
    }

    if (result.status === "auth_required") {
      authRequired = true;
      firstFailure = result.error ?? null;
      break;
    }

    if (result.status === "session_changed") {
      sessionChanged = true;
      firstFailure = result.error ?? null;
      break;
    }

    firstFailure ??= result.error ?? null;
    failureCount += 1;
  }

  return {
    alreadyDoneCount,
    authRequired,
    cancelled: isCancelled(),
    failureCount,
    firstFailure,
    sessionChanged,
    shouldReload,
    successCount,
  };
}
