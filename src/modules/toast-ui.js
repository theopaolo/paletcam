import './toast/toast-host.js';

let hostElement;

function ensureHost() {
  if (hostElement?.isConnected) {
    return hostElement;
  }

  hostElement = document.querySelector('toast-host');
  if (hostElement?.isConnected) {
    return hostElement;
  }

  hostElement = document.createElement('toast-host');
  document.body.append(hostElement);
  return hostElement;
}

/**
 * @param {string} message
 * @param {StandardToastOptions} [options]
 */
export function showToast(message, options = {}) {
  if (!message) {
    return;
  }

  ensureHost().showToast(message, options);
}

/**
 * @param {string} message
 * @param {UndoToastOptions} [options]
 */
export function showUndoToast(message, options = {}) {
  if (!message) {
    return;
  }

  ensureHost().showUndoToast(message, options);
}
