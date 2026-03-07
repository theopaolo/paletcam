import './toast/toast-host.js';

const TOAST_HOST_TAG_NAME = 'toast-host';

let hostElement;

function ensureHost() {
  if (hostElement?.isConnected) {
    return hostElement;
  }

  hostElement = document.querySelector(TOAST_HOST_TAG_NAME);
  if (hostElement?.isConnected) {
    return hostElement;
  }

  hostElement = document.createElement(TOAST_HOST_TAG_NAME);
  document.body.append(hostElement);
  return hostElement;
}

function invokeHostMethod(methodName, message, options) {
  const nextHostElement = ensureHost();
  const method = nextHostElement?.[methodName];

  if (typeof method === 'function') {
    method.call(nextHostElement, message, options);
    return;
  }

  customElements.whenDefined(TOAST_HOST_TAG_NAME).then(() => {
    const upgradedHostElement = nextHostElement.isConnected
      ? nextHostElement
      : ensureHost();
    const upgradedMethod = upgradedHostElement?.[methodName];

    if (typeof upgradedMethod !== 'function') {
      console.error(`Toast host method "${methodName}" is unavailable.`);
      return;
    }

    upgradedMethod.call(upgradedHostElement, message, options);
  });
}

/**
 * @param {string} message
 * @param {StandardToastOptions} [options]
 */
export function showToast(message, options = {}) {
  if (!message) {
    return;
  }

  invokeHostMethod('showToast', message, options);
}

/**
 * @param {string} message
 * @param {UndoToastOptions} [options]
 */
export function showUndoToast(message, options = {}) {
  if (!message) {
    return;
  }

  invokeHostMethod('showUndoToast', message, options);
}
