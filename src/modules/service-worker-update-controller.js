/**
 * Coordinates user-approved service-worker activation with reload-sensitive
 * app work. A waiting worker is retained until every critical operation ends.
 *
 * @param {object} options
 * @param {() => boolean} options.isBusy
 * @param {(listener: (snapshot: {activeCount: number}) => void) => () => void} options.subscribeBusy
 * @param {(worker: ServiceWorker) => void} options.activateWorker
 * @param {() => void} [options.onDeferred]
 * @param {() => void} [options.onReadyToReload]
 */
export function createServiceWorkerUpdateController({
  isBusy,
  subscribeBusy,
  activateWorker,
  onDeferred = () => {},
  onReadyToReload = () => {},
}) {
  /** @type {ServiceWorker | null} */
  let pendingWorker = null;
  let activationRequested = false;
  let controllerChangePending = false;
  let destroyed = false;

  function flushPendingActivation() {
    if (destroyed || !pendingWorker || isBusy()) {
      return false;
    }

    const worker = pendingWorker;
    pendingWorker = null;
    activateWorker(worker);
    return true;
  }

  function flushPendingReload() {
    if (destroyed || !activationRequested || !controllerChangePending || isBusy()) {
      return false;
    }

    activationRequested = false;
    controllerChangePending = false;
    onReadyToReload();
    return true;
  }

  const unsubscribeBusy = subscribeBusy(({ activeCount }) => {
    if (activeCount === 0) {
      flushPendingActivation();
      flushPendingReload();
    }
  });

  /** @param {ServiceWorker | null | undefined} worker */
  function requestActivation(worker) {
    if (destroyed || !worker) {
      return "unavailable";
    }

    activationRequested = true;
    pendingWorker = worker;
    if (isBusy()) {
      onDeferred();
      return "deferred";
    }

    flushPendingActivation();
    return "activating";
  }

  function handleControllerChange() {
    if (!activationRequested || destroyed) {
      return false;
    }

    pendingWorker = null;
    controllerChangePending = true;
    return flushPendingReload();
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    pendingWorker = null;
    controllerChangePending = false;
    unsubscribeBusy();
  }

  return {
    destroy,
    handleControllerChange,
    requestActivation,
  };
}
