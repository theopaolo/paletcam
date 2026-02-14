const DEFAULT_TOAST_DURATION = 1200;
const DEFAULT_UNDO_DURATION = 5000;
const TOAST_CLOSE_FALLBACK_MS = 240;
const toastQueue = [];
let hostElement;
let politeLiveRegion;
let assertiveLiveRegion;
let activeToast;

function ensureHost() {
  if (hostElement) {
    return hostElement;
  }

  hostElement = document.createElement('div');
  hostElement.className = 'toast-host';

  politeLiveRegion = document.createElement('div');
  politeLiveRegion.className = 'toast-live-region';
  politeLiveRegion.setAttribute('aria-live', 'polite');
  politeLiveRegion.setAttribute('aria-atomic', 'true');

  assertiveLiveRegion = document.createElement('div');
  assertiveLiveRegion.className = 'toast-live-region';
  assertiveLiveRegion.setAttribute('aria-live', 'assertive');
  assertiveLiveRegion.setAttribute('aria-atomic', 'true');

  document.body.append(hostElement, politeLiveRegion, assertiveLiveRegion);
  return hostElement;
}

function announceToast(message, isAssertive) {
  ensureHost();
  const liveRegion = isAssertive ? assertiveLiveRegion : politeLiveRegion;
  liveRegion.textContent = '';

  window.requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}

function dismissActiveToast(reason = 'timeout') {
  if (!activeToast || activeToast.isClosing) {
    return;
  }

  const { element, timerId, toast } = activeToast;
  let closed = false;
  activeToast.isClosing = true;
  window.clearTimeout(timerId);

  const finishClose = () => {
    if (closed) {
      return;
    }

    closed = true;
    element.remove();
    activeToast = undefined;

    if (reason === 'action') {
      toast.onAction?.();
    } else {
      toast.onExpire?.();
    }

    showNextToast();
  };

  element.classList.remove('is-visible');
  element.addEventListener('transitionend', finishClose, { once: true });
  window.setTimeout(finishClose, TOAST_CLOSE_FALLBACK_MS);
}

function insertHighPriorityToast(toast) {
  const firstNormalIndex = toastQueue.findIndex((queuedToast) => queuedToast.priority !== 'high');

  if (firstNormalIndex === -1) {
    toastQueue.push(toast);
    return;
  }

  toastQueue.splice(firstNormalIndex, 0, toast);
}

function showNextToast() {
  if (activeToast || toastQueue.length === 0) {
    return;
  }

  const host = ensureHost();
  const toast = toastQueue.shift();
  const element = document.createElement('div');

  element.className = `toast toast--${toast.variant}`;

  const message = document.createElement('p');
  message.className = 'toast-message';
  message.textContent = toast.message;
  element.appendChild(message);

  if (toast.actionLabel) {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'toast-action';
    actionButton.textContent = toast.actionLabel;
    actionButton.addEventListener('click', () => {
      dismissActiveToast('action');
    });
    element.appendChild(actionButton);
  }

  host.appendChild(element);
  window.requestAnimationFrame(() => {
    element.classList.add('is-visible');
  });

  const timerId = window.setTimeout(() => {
    dismissActiveToast('timeout');
  }, toast.duration);

  activeToast = {
    toast,
    element,
    timerId,
    isClosing: false,
  };

  announceToast(toast.message, toast.type === 'undo');
}

function enqueueToast(toast) {
  ensureHost();

  if (toast.priority === 'high' && activeToast && activeToast.toast.type !== 'undo') {
    insertHighPriorityToast(toast);
    dismissActiveToast('interrupted');
    return;
  }

  if (toast.priority === 'high') {
    insertHighPriorityToast(toast);
  } else {
    toastQueue.push(toast);
  }

  showNextToast();
}

export function showToast(message, options = {}) {
  if (!message) {
    return;
  }

  enqueueToast({
    type: 'standard',
    message,
    duration: options.duration ?? DEFAULT_TOAST_DURATION,
    variant: options.variant === 'error' ? 'error' : 'default',
    priority: 'normal',
  });
}

export function showUndoToast(message, options = {}) {
  if (!message) {
    return;
  }

  enqueueToast({
    type: 'undo',
    message,
    actionLabel: 'Undo',
    onAction: options.onUndo,
    onExpire: options.onExpire,
    duration: options.duration ?? DEFAULT_UNDO_DURATION,
    variant: 'undo',
    priority: 'high',
  });
}
