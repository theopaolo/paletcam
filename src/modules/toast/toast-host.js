import { html, LitElement } from "lit";
import { repeat } from "lit/directives/repeat.js";

const DEFAULT_TOAST_DURATION = 1200;
const DEFAULT_UNDO_DURATION = 5000;
const TOAST_DISMISS_DELAY_MS = 460;

function normalizeDuration(value, fallback) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) {
    return fallback;
  }

  return duration;
}

class ToastHostElement extends LitElement {
  constructor() {
    super();
    this._activeStandardEntry = null;
    this._assertiveAnnouncement = "";
    this._assertiveAnnouncementFrame = 0;
    this._dismissTimers = new Map();
    this._expirationTimers = new Map();
    this._nextToastId = 1;
    this._politeAnnouncement = "";
    this._politeAnnouncementFrame = 0;
    this._standardQueue = [];
    this._undoEntries = [];
    this._visibilityFrames = new Map();
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("toast-host");
    this.addEventListener("touchstart", (e) => this._handleSwipeStart(e), false);
    this.addEventListener("touchmove", (e) => this._handleSwipeMove(e), false);
    this.addEventListener("touchend", (e) => this._handleSwipeEnd(e), false);
  }

  disconnectedCallback() {
    this._clearAnnouncementFrame("assertive");
    this._clearAnnouncementFrame("polite");
    this._dismissTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    this._dismissTimers.clear();
    this._expirationTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    this._expirationTimers.clear();
    this._visibilityFrames.forEach((frameId) => {
      window.cancelAnimationFrame(frameId);
    });
    this._visibilityFrames.clear();
    super.disconnectedCallback();
  }

  showToast(message, options = {}) {
    if (!message) {
      return;
    }

    const toast = {
      type: "standard",
      message: String(message),
      details: typeof options.details === "string" ? options.details : "",
      duration: normalizeDuration(options.duration, DEFAULT_TOAST_DURATION),
      variant: options.variant === "error" ? "error" : "default",
      actionLabel: typeof options.actionLabel === "string" ? options.actionLabel : "",
      onAction: typeof options.onAction === "function" ? options.onAction : undefined,
      onExpire: undefined,
    };

    if (this._undoEntries.length > 0 || this._activeStandardEntry) {
      this._standardQueue.push(toast);
      return;
    }

    this._mountStandardToast(toast);
  }

  showUndoToast(message, options = {}) {
    if (!message) {
      return;
    }

    const toast = {
      type: "undo",
      message: String(message),
      details: "",
      duration: normalizeDuration(options.duration, DEFAULT_UNDO_DURATION),
      variant: "undo",
      actionLabel: "Annuler",
      onAction: typeof options.onUndo === "function" ? options.onUndo : undefined,
      onExpire: typeof options.onExpire === "function" ? options.onExpire : undefined,
    };

    this._interruptStandardToastIfNeeded();
    this._mountUndoToast(toast);
  }

  _createEntry(toast) {
    return {
      ...toast,
      closeReason: "",
      id: `toast-${this._nextToastId++}`,
      phase: "open",
      visible: false,
    };
  }

  _toToastPayload(entry) {
    return {
      actionLabel: entry.actionLabel,
      details: entry.details,
      duration: entry.duration,
      message: entry.message,
      onAction: entry.onAction,
      onExpire: entry.onExpire,
      type: entry.type,
      variant: entry.variant,
    };
  }

  _mountStandardToast(toast) {
    this._activeStandardEntry = this._createEntry(toast);
    this._mountEntry(this._activeStandardEntry);
  }

  _mountUndoToast(toast) {
    const entry = this._createEntry(toast);
    this._undoEntries.push(entry);
    this._mountEntry(entry);
  }

  _mountEntry(entry) {
    this.requestUpdate();
    this._announce(entry);
    this._scheduleVisibility(entry);
    this._scheduleExpiration(entry);
  }

  _interruptStandardToastIfNeeded() {
    if (!this._activeStandardEntry || this._activeStandardEntry.phase === "closing") {
      return;
    }

    this._standardQueue.unshift(this._toToastPayload(this._activeStandardEntry));
    this._beginDismiss(this._activeStandardEntry, "interrupted");
  }

  _showNextStandardToast() {
    if (
      this._activeStandardEntry ||
      this._undoEntries.length > 0 ||
      this._standardQueue.length === 0
    ) {
      this.requestUpdate();
      return;
    }

    const nextToast = this._standardQueue.shift();
    if (!nextToast) {
      this.requestUpdate();
      return;
    }

    this._mountStandardToast(nextToast);
  }

  _beginDismiss(entry, reason) {
    if (!entry || entry.phase === "closing") {
      return;
    }

    this._clearExpirationTimer(entry.id);
    entry.closeReason = reason;
    entry.phase = "closing";
    this.requestUpdate();
    this._scheduleDismiss(entry);
  }

  _handleActionClick(entry) {
    if (entry.phase === "closing") {
      return;
    }

    this._dispatchToastEvent("toast-action", entry, "action");
    this._beginDismiss(entry, "action");
  }

  _handleDismissClick(entry) {
    if (entry.phase === "closing") {
      return;
    }

    this._beginDismiss(entry, "user-dismiss");
  }

  _handleSwipeStart(event) {
    const touch = event.touches[0];
    this._swipeStartX = touch.clientX;
    this._swipeStartY = touch.clientY;
    this._swipeToastElement = event.target.closest(".toast");
  }

  _handleSwipeMove(event) {
    if (!this._swipeStartX || !this._swipeToastElement) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - this._swipeStartX;
    const deltaY = Math.abs(touch.clientY - this._swipeStartY);

    // Only allow horizontal swiping (not vertical scrolling)
    if (deltaY > 10) {
      this._swipeStartX = null;
      return;
    }

    this._swipeToastElement.classList.add("is-swiping");
    this._swipeToastElement.style.transform = `translateX(${deltaX}px)`;
    this._swipeToastElement.style.opacity = Math.max(0, 1 - Math.abs(deltaX) / 200);
  }

  _handleSwipeEnd(event) {
    if (!this._swipeStartX || !this._swipeToastElement) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this._swipeStartX;
    const swipeThreshold = 80;

    this._swipeToastElement.classList.remove("is-swiping");

    // Dismiss if swiped more than threshold
    if (Math.abs(deltaX) > swipeThreshold) {
      const entry =
        this._undoEntries.find((e) => e.id === this._swipeToastElement.dataset.toastId) ||
        (this._activeStandardEntry?.id === this._swipeToastElement.dataset.toastId
          ? this._activeStandardEntry
          : null);

      if (entry) {
        this._beginDismiss(entry, "swipe");
      }
    } else {
      // Snap back
      this._swipeToastElement.style.transform = "";
      this._swipeToastElement.style.opacity = "";
    }

    this._swipeStartX = null;
    this._swipeToastElement = null;
  }

  _clearAnnouncementFrame(type) {
    const frameKey =
      type === "assertive" ? "_assertiveAnnouncementFrame" : "_politeAnnouncementFrame";

    if (!this[frameKey]) {
      return;
    }

    window.cancelAnimationFrame(this[frameKey]);
    this[frameKey] = 0;
  }

  _announce(entry) {
    const announcementKey =
      entry.type === "undo" ? "_assertiveAnnouncement" : "_politeAnnouncement";
    const frameKey =
      entry.type === "undo" ? "_assertiveAnnouncementFrame" : "_politeAnnouncementFrame";

    this._clearAnnouncementFrame(entry.type === "undo" ? "assertive" : "polite");
    this[announcementKey] = "";
    this.requestUpdate();

    this[frameKey] = window.requestAnimationFrame(() => {
      this[frameKey] = 0;
      this[announcementKey] = entry.message;
      this.requestUpdate();
    });
  }

  _scheduleVisibility(entry) {
    if (this._visibilityFrames.has(entry.id)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      this._visibilityFrames.delete(entry.id);
      if (entry.phase !== "open") {
        return;
      }

      entry.visible = true;
      this.requestUpdate();
    });

    this._visibilityFrames.set(entry.id, frameId);
  }

  _clearVisibilityFrame(entryId) {
    const frameId = this._visibilityFrames.get(entryId);
    if (!frameId) {
      return;
    }

    window.cancelAnimationFrame(frameId);
    this._visibilityFrames.delete(entryId);
  }

  _scheduleExpiration(entry) {
    if (entry.duration <= 0 || this._expirationTimers.has(entry.id)) {
      return;
    }

    const timerId = window.setTimeout(() => {
      this._expirationTimers.delete(entry.id);
      if (entry.phase !== "open") {
        return;
      }

      this._dispatchToastEvent("toast-expire", entry, "timeout");
      this._beginDismiss(entry, "timeout");
    }, entry.duration);

    this._expirationTimers.set(entry.id, timerId);
  }

  _clearExpirationTimer(entryId) {
    const timerId = this._expirationTimers.get(entryId);
    if (!timerId) {
      return;
    }

    window.clearTimeout(timerId);
    this._expirationTimers.delete(entryId);
  }

  _scheduleDismiss(entry) {
    if (this._dismissTimers.has(entry.id)) {
      return;
    }

    const timerId = window.setTimeout(() => {
      this._dismissTimers.delete(entry.id);
      if (entry.phase !== "closing") {
        return;
      }

      this._finalizeDismiss(entry);
    }, TOAST_DISMISS_DELAY_MS);

    this._dismissTimers.set(entry.id, timerId);
  }

  _clearDismissTimer(entryId) {
    const timerId = this._dismissTimers.get(entryId);
    if (!timerId) {
      return;
    }

    window.clearTimeout(timerId);
    this._dismissTimers.delete(entryId);
  }

  _removeEntry(entry) {
    if (entry.type === "undo") {
      const index = this._undoEntries.indexOf(entry);
      if (index === -1) {
        return false;
      }

      this._undoEntries.splice(index, 1);
      return true;
    }

    if (this._activeStandardEntry !== entry) {
      return false;
    }

    this._activeStandardEntry = null;
    return true;
  }

  _finalizeDismiss(entry) {
    if (!this._removeEntry(entry)) {
      return;
    }

    this._clearDismissTimer(entry.id);
    this._clearExpirationTimer(entry.id);
    this._clearVisibilityFrame(entry.id);
    this._dispatchToastEvent("toast-dismiss", entry, entry.closeReason);

    if (entry.closeReason === "action") {
      entry.onAction?.();
    } else if (entry.closeReason === "timeout") {
      entry.onExpire?.();
    }

    this.requestUpdate();
    this._showNextStandardToast();
  }

  _dispatchToastEvent(eventName, entry, reason) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        composed: true,
        detail: {
          id: entry.id,
          message: entry.message,
          reason,
          type: entry.type,
          variant: entry.variant,
        },
      }),
    );
  }

  _getRenderItems() {
    const undoItems = this._undoEntries.map((entry, index) => ({
      entry,
      isTop: index === 0,
      stackIndex: index,
      zIndex: 200 - index,
    }));

    if (!this._activeStandardEntry) {
      return undoItems;
    }

    return [
      ...undoItems,
      {
        entry: this._activeStandardEntry,
        isTop: undoItems.length === 0,
        stackIndex: undoItems.length,
        zIndex: undoItems.length === 0 ? 200 : 0,
      },
    ];
  }

  _getToastClassName(item) {
    const classNames = ["toast", `toast--${item.entry.variant}`];

    if (item.entry.visible) {
      classNames.push("is-visible");
    }

    if (item.entry.phase === "closing") {
      classNames.push("is-leaving");
    }

    if (item.isTop) {
      classNames.push("is-top");
    }

    return classNames.join(" ");
  }

  _getToastStyle(item) {
    const styleFragments = [`--stack-index: ${item.stackIndex}`];

    if (item.zIndex > 0) {
      styleFragments.push(`z-index: ${item.zIndex}`);
    }

    return styleFragments.join("; ");
  }

  render() {
    const items = this._getRenderItems();

    return html`
      <div class="toast-live-region" aria-live="polite" aria-atomic="true">
        ${this._politeAnnouncement}
      </div>
      <div class="toast-live-region" aria-live="assertive" aria-atomic="true">
        ${this._assertiveAnnouncement}
      </div>
      ${repeat(
        items,
        (item) => item.entry.id,
        (item) => html`
          <div
            class=${this._getToastClassName(item)}
            data-toast-id=${item.entry.id}
            data-toast-type=${item.entry.type}
            style=${this._getToastStyle(item)}
          >
            ${
              item.entry.details
                ? html`
                  <div class="toast-body">
                    <p class="toast-message">${item.entry.message}</p>
                    <p class="toast-details">${item.entry.details}</p>
                  </div>
                `
                : html`<p class="toast-message">${item.entry.message}</p>`
            }
            ${
              item.entry.actionLabel
                ? html`
                  <button
                    type="button"
                    class="toast-action"
                    ?disabled=${item.entry.phase === "closing"}
                    @click=${() => this._handleActionClick(item.entry)}
                  >
                    ${item.entry.actionLabel}
                  </button>
                `
                : null
            }
            <button
              type="button"
              class="toast-dismiss"
              aria-label="Dismiss"
              ?disabled=${item.entry.phase === "closing"}
              @click=${() => this._handleDismissClick(item.entry)}
            >
              ✕
            </button>
            <div class="toast-progress">
              <span
                class="toast-progress-bar"
                style=${`--toast-duration: ${item.entry.duration}ms;`}
              ></span>
            </div>
          </div>
        `,
      )}
    `;
  }
}

if (!customElements.get("toast-host")) {
  customElements.define("toast-host", ToastHostElement);
}
