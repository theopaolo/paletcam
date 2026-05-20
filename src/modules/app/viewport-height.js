export function createViewportHeightController({ onSync = () => {} } = {}) {
  const cssVariable = "--app-height";
  const resyncDelaysMs = [120, 360];
  let frameId = 0;
  let lastViewportHeight = 0;
  const timeoutIds = [];

  function clear() {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    while (timeoutIds.length > 0) {
      window.clearTimeout(timeoutIds.pop());
    }
  }

  function getLiveViewportHeight() {
    const viewportHeightCandidates = [
      window.visualViewport?.height ?? 0,
      window.innerHeight,
      document.documentElement?.clientHeight ?? 0,
    ].filter((value) => Number.isFinite(value) && value > 0);

    if (viewportHeightCandidates.length === 0) {
      return 0;
    }

    return Math.round(Math.min(...viewportHeightCandidates));
  }

  function applyViewportHeight() {
    const nextViewportHeight = getLiveViewportHeight();
    if (nextViewportHeight <= 0 || nextViewportHeight === lastViewportHeight) {
      return;
    }

    document.documentElement.style.setProperty(cssVariable, `${nextViewportHeight}px`);
    lastViewportHeight = nextViewportHeight;
  }

  function sync() {
    applyViewportHeight();
    onSync();
  }

  function schedule() {
    clear();

    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      sync();
    });

    for (const delayMs of resyncDelaysMs) {
      const timeoutId = window.setTimeout(() => {
        const timeoutIndex = timeoutIds.indexOf(timeoutId);
        if (timeoutIndex >= 0) {
          timeoutIds.splice(timeoutIndex, 1);
        }

        sync();
      }, delayMs);

      timeoutIds.push(timeoutId);
    }
  }

  return {
    clear,
    schedule,
    sync,
  };
}
