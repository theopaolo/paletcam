const DEFAULT_TOAST_DURATION = 1200;
const DEFAULT_UNDO_DURATION = 5000;
const TOAST_CLOSE_FALLBACK_MS = 460;
const standardToastQueue = [];
const activeUndoToasts = [];
let hostElement;
let politeLiveRegion;
let assertiveLiveRegion;
let activeStandardToast;

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

function updateUndoStackLayout() {
  activeUndoToasts.forEach((entry, index) => {
    entry.element.style.setProperty('--stack-index', String(index));
    entry.element.style.zIndex = String(200 - index);
    entry.element.classList.toggle('is-top', index === 0);
  });
}

function removeUndoEntry(entry) {
  const index = activeUndoToasts.indexOf(entry);
  if (index === -1) {
    return;
  }

  activeUndoToasts.splice(index, 1);
  updateUndoStackLayout();
}

function showNextStandardToast() {
  if (activeStandardToast || activeUndoToasts.length > 0 || standardToastQueue.length === 0) {
    return;
  }

  const toast = standardToastQueue.shift();
  createToastEntry(toast);
}

function createToastEntry(toast) {
  const host = ensureHost();
  const element = document.createElement('div');
  element.className = `toast toast--${toast.variant}`;
  element.dataset.toastType = toast.type;

  const message = document.createElement('p');
  message.className = 'toast-message';
  message.textContent = toast.message;
  element.appendChild(message);

  if (toast.actionLabel) {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'toast-action';
    actionButton.textContent = toast.actionLabel;
    element.appendChild(actionButton);
  }

  const progressTrack = document.createElement('div');
  progressTrack.className = 'toast-progress';

  const progressBar = document.createElement('span');
  progressBar.className = 'toast-progress-bar';
  progressBar.style.setProperty('--toast-duration', `${toast.duration}ms`);
  progressTrack.appendChild(progressBar);
  element.appendChild(progressTrack);

  host.appendChild(element);

  const entry = {
    toast,
    element,
    timerId: undefined,
    isClosing: false,
  };

  if (toast.type === 'undo') {
    activeUndoToasts.push(entry);
    updateUndoStackLayout();
  } else {
    activeStandardToast = entry;
    element.classList.add('is-top');
  }

  const actionButton = element.querySelector('.toast-action');
  actionButton?.addEventListener('click', () => {
    dismissToast(entry, 'action');
  });

  window.requestAnimationFrame(() => {
    element.classList.add('is-visible');
  });

  entry.timerId = window.setTimeout(() => {
    dismissToast(entry, 'timeout');
  }, toast.duration);

  announceToast(toast.message, toast.type === 'undo');
}

function dismissToast(entry, reason = 'timeout') {
  if (!entry || entry.isClosing) {
    return;
  }

  entry.isClosing = true;
  if (entry.timerId) {
    window.clearTimeout(entry.timerId);
  }

  let closed = false;
  const finishClose = () => {
    if (closed) {
      return;
    }

    closed = true;
    entry.element.remove();

    if (entry.toast.type === 'undo') {
      removeUndoEntry(entry);
      if (reason === 'action') {
        entry.toast.onAction?.();
      } else if (reason === 'timeout') {
        entry.toast.onExpire?.();
      }

      showNextStandardToast();
      return;
    }

    if (activeStandardToast === entry) {
      activeStandardToast = undefined;
    }

    if (reason === 'action') {
      entry.toast.onAction?.();
    } else if (reason === 'timeout') {
      entry.toast.onExpire?.();
    }

    showNextStandardToast();
  };

  entry.element.classList.add('is-leaving');
  entry.element.addEventListener('transitionend', finishClose, { once: true });
  window.setTimeout(finishClose, TOAST_CLOSE_FALLBACK_MS);
}

function interruptStandardToastIfNeeded() {
  if (!activeStandardToast || activeStandardToast.isClosing) {
    return;
  }

  standardToastQueue.unshift(activeStandardToast.toast);
  dismissToast(activeStandardToast, 'interrupted');
}

export function showToast(message, options = {}) {
  if (!message) {
    return;
  }

  const toast = {
    type: 'standard',
    message,
    duration: options.duration ?? DEFAULT_TOAST_DURATION,
    variant: options.variant === 'error' ? 'error' : 'default',
  };

  if (activeUndoToasts.length > 0 || activeStandardToast) {
    standardToastQueue.push(toast);
    return;
  }

  createToastEntry(toast);
}

export function showUndoToast(message, options = {}) {
  if (!message) {
    return;
  }

  const toast = {
    type: 'undo',
    message,
    actionLabel: 'Undo',
    onAction: options.onUndo,
    onExpire: options.onExpire,
    duration: options.duration ?? DEFAULT_UNDO_DURATION,
    variant: 'undo',
  };

  interruptStandardToastIfNeeded();
  createToastEntry(toast);
}
