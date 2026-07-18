/**
 * Coordinates camera suspension while full-screen app surfaces are active.
 * Surface names are intentionally generic so the camera layer does not need
 * to know about collection or viewer UI details.
 */
export function createCameraSurfaceLifecycleController({
  isCameraActive,
  suspendCamera,
  releaseCamera,
  onError = /** @type {(error: unknown, operation: "suspend" | "resume") => void} */ (() => {}),
}) {
  const activeSurfaces = new Set();
  let shouldResumeWhenClear = false;
  let resumeAttemptId = 0;
  let activeResumePromise = null;
  let activeResumeShouldStart = false;
  let isDestroyed = false;

  function open(surfaceName) {
    if (isDestroyed || !surfaceName || activeSurfaces.has(surfaceName)) {
      return false;
    }

    const isFirstSurface = activeSurfaces.size === 0;
    activeSurfaces.add(surfaceName);
    if (!isFirstSurface) {
      return true;
    }

    resumeAttemptId += 1;
    shouldResumeWhenClear =
      shouldResumeWhenClear || activeResumeShouldStart || Boolean(isCameraActive?.());

    try {
      suspendCamera?.({ shouldResume: shouldResumeWhenClear });
    } catch (error) {
      onError(error, "suspend");
    }

    return true;
  }

  function close(surfaceName) {
    if (isDestroyed || !activeSurfaces.delete(surfaceName)) {
      return false;
    }

    if (activeSurfaces.size > 0) {
      return true;
    }

    const shouldResume = shouldResumeWhenClear;
    shouldResumeWhenClear = false;
    const currentResumeAttemptId = ++resumeAttemptId;
    const resumePromise = Promise.resolve().then(async () => {
      if (isDestroyed || activeSurfaces.size > 0 || currentResumeAttemptId !== resumeAttemptId) {
        return false;
      }

      try {
        return await releaseCamera?.({ shouldResume });
      } catch (error) {
        onError(error, "resume");
        return false;
      }
    });

    activeResumePromise = resumePromise;
    activeResumeShouldStart = shouldResume;
    void resumePromise.finally(() => {
      if (activeResumePromise === resumePromise) {
        activeResumePromise = null;
        activeResumeShouldStart = false;
      }
    });
    return true;
  }

  function destroy() {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    resumeAttemptId += 1;
    activeSurfaces.clear();
    shouldResumeWhenClear = false;
    activeResumePromise = null;
    activeResumeShouldStart = false;
  }

  return {
    close,
    destroy,
    open,
  };
}
