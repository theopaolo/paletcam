/**
 * Keeps debug HUD loading out of the production graph while presenting the
 * stable instrumentation adapter expected by the preview controller.
 *
 * @param {{
 *   initialEnabled?: boolean,
 *   loadController?: null | (() => Promise<{createPerformanceHudController: Function}>),
 * }} [options]
 */
export function createPerformanceHudBridge({ initialEnabled = false, loadController = null } = {}) {
  let delegate = null;
  let destroyed = false;
  let enabled = Boolean(initialEnabled);

  if (typeof loadController === "function") {
    void loadController()
      .then((module) => {
        if (destroyed || typeof module?.createPerformanceHudController !== "function") return;
        delegate = module.createPerformanceHudController({ initialEnabled: enabled });
      })
      .catch((error) => {
        console.warn("Performance HUD failed to load.", error);
      });
  }

  return {
    destroy() {
      destroyed = true;
      delegate?.destroy?.();
      delegate = null;
    },
    recordFrame(metrics) {
      delegate?.recordFrame?.(metrics);
    },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      delegate?.setEnabled?.(enabled);
    },
  };
}
