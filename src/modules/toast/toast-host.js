import { html, LitElement } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../i18n.js";
import { settleToastEntry } from "./toast-settlement.js";

const DEFAULT_TOAST_DURATION = 1200;
const DEFAULT_UNDO_DURATION = 5000;
const TOAST_DISMISS_DELAY_MS = 460;
const SWIPE_ACTIVATION_PX = 10;
const SWIPE_VERTICAL_ABORT_PX = 14;
const SWIPE_DISMISS_THRESHOLD_PX = 80;
const SWIPE_FADE_DISTANCE_PX = 200;

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
    this._nextToastId = 1;
    this._politeAnnouncement = "";
    this._politeAnnouncementFrame = 0;
    this._standardQueue = [];
    this._swipe = null;
    this._undoEntries = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("toast-host");
    this.addEventListener("pointerdown", (e) => this._handleSwipeStart(e));
    this.addEventListener("pointermove", (e) => this._handleSwipeMove(e));
    this.addEventListener("pointerup", (e) => this._handleSwipeEnd(e));
    this.addEventListener("pointercancel", (e) => this._handleSwipeCancel(e));
  }

  disconnectedCallback() {
    this._clearAnnouncementFrame("assertive");
    this._clearAnnouncementFrame("polite");
    for (const entry of this._allEntries()) {
      this._clearEntryTimers(entry);
    }
    super.disconnectedCallback();
  }

  _allEntries() {
    return [
      ...this._undoEntries,
      ...(this._activeStandardEntry ? [this._activeStandardEntry] : []),
      ...this._standardQueue,
    ];
  }

  _clearEntryTimers(entry) {
    if (entry.expireTimerId) {
      window.clearTimeout(entry.expireTimerId);
      entry.expireTimerId = 0;
    }

    if (entry.dismissTimerId) {
      window.clearTimeout(entry.dismissTimerId);
      entry.dismissTimerId = 0;
    }

    if (entry.visibilityFrameId) {
      window.cancelAnimationFrame(entry.visibilityFrameId);
      entry.visibilityFrameId = 0;
    }
  }

  showToast(message, options = {}) {
    if (!message) {
      return "";
    }

    const toast = {
      type: "standard",
      message: String(message),
      details: typeof options.details === "string" ? options.details : "",
      duration: normalizeDuration(options.duration, DEFAULT_TOAST_DURATION),
      variant: options.variant === "error" ? "error" : "default",
      actionLabel: typeof options.actionLabel === "string" ? options.actionLabel : "",
      onAction: typeof options.onAction === "function" ? options.onAction : undefined,
      onExpire: typeof options.onExpire === "function" ? options.onExpire : undefined,
    };

    const entry = this._createEntry(toast);

    if (this._undoEntries.length > 0 || this._activeStandardEntry) {
      this._standardQueue.push(entry);
      return entry.id;
    }

    this._mountStandardToast(entry);
    return entry.id;
  }

  showUndoToast(message, options = {}) {
    if (!message) {
      return "";
    }

    const toast = {
      type: "undo",
      message: String(message),
      details: "",
      duration: normalizeDuration(options.duration, DEFAULT_UNDO_DURATION),
      variant: "undo",
      actionLabel: typeof options.actionLabel === "string" ? options.actionLabel : t("toast.undo"),
      onAction: typeof options.onUndo === "function" ? options.onUndo : undefined,
      onExpire: typeof options.onExpire === "function" ? options.onExpire : undefined,
      onDismiss: typeof options.onDismiss === "function" ? options.onDismiss : undefined,
    };

    this._interruptStandardToastIfNeeded();
    const entry = this._createEntry(toast);
    this._mountUndoToast(entry);
    return entry.id;
  }

  dismissToast(toastId) {
    const normalizedToastId = String(toastId || "").trim();
    if (!normalizedToastId) {
      return false;
    }

    const queuedIndex = this._standardQueue.findIndex((entry) => entry.id === normalizedToastId);
    if (queuedIndex >= 0) {
      this._standardQueue.splice(queuedIndex, 1);
      this.requestUpdate();
      return true;
    }

    const entry =
      this._undoEntries.find((candidate) => candidate.id === normalizedToastId) ||
      (this._activeStandardEntry?.id === normalizedToastId ? this._activeStandardEntry : null);
    if (!entry) {
      return false;
    }

    this._beginDismiss(entry, "programmatic");
    return true;
  }

  _createEntry(toast, id = `toast-${this._nextToastId++}`) {
    return {
      ...toast,
      closeReason: "",
      dismissTimerId: 0,
      expireTimerId: 0,
      id,
      phase: "open",
      visibilityFrameId: 0,
      visible: false,
    };
  }

  _cloneEntryForQueue(entry) {
    const {
      actionLabel,
      details,
      duration,
      message,
      onAction,
      onDismiss,
      onExpire,
      type,
      variant,
    } = entry;
    return this._createEntry(
      { actionLabel, details, duration, message, onAction, onDismiss, onExpire, type, variant },
      entry.id,
    );
  }

  _mountStandardToast(entry) {
    this._activeStandardEntry = entry;
    this._mountEntry(this._activeStandardEntry);
  }

  _mountUndoToast(entry) {
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

    this._standardQueue.unshift(this._cloneEntryForQueue(this._activeStandardEntry));
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

    const nextEntry = this._standardQueue.shift();
    if (!nextEntry) {
      this.requestUpdate();
      return;
    }

    this._mountStandardToast(nextEntry);
  }

  _beginDismiss(entry, reason) {
    if (!entry || entry.phase === "closing") {
      return;
    }

    if (entry.expireTimerId) {
      window.clearTimeout(entry.expireTimerId);
      entry.expireTimerId = 0;
    }
    entry.closeReason = reason;
    entry.phase = "closing";
    settleToastEntry(entry, reason);
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

  _findEntryByToastId(toastId) {
    return (
      this._undoEntries.find((entry) => entry.id === toastId) ||
      (this._activeStandardEntry?.id === toastId ? this._activeStandardEntry : null)
    );
  }

  _handleSwipeStart(event) {
    if (!event.isPrimary || this._swipe) {
      return;
    }

    const toastElement = event.target.closest(".toast");
    // A press on a button is a tap, never the start of a swipe.
    if (!toastElement || event.target.closest("button")) {
      return;
    }

    const entry = this._findEntryByToastId(toastElement.dataset.toastId);
    if (!entry || entry.phase === "closing") {
      return;
    }

    this._swipe = {
      entry,
      isActive: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      toastElement,
    };
  }

  _handleSwipeMove(event) {
    const swipe = this._swipe;
    if (!swipe || event.pointerId !== swipe.pointerId) {
      return;
    }

    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;

    if (!swipe.isActive) {
      if (Math.abs(deltaY) > SWIPE_VERTICAL_ABORT_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
        this._swipe = null;
        return;
      }

      if (Math.abs(deltaX) < SWIPE_ACTIVATION_PX) {
        return;
      }

      swipe.isActive = true;
      swipe.toastElement.classList.add("is-swiping");
      try {
        swipe.toastElement.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already gone (or synthetic) — tracking continues via the host.
      }
    }

    swipe.toastElement.style.setProperty("--swipe-x", `${deltaX}px`);
    swipe.toastElement.style.opacity = String(
      Math.max(0, 1 - Math.abs(deltaX) / SWIPE_FADE_DISTANCE_PX),
    );
  }

  _resetSwipeElement(toastElement) {
    toastElement.classList.remove("is-swiping");
    toastElement.style.removeProperty("--swipe-x");
    toastElement.style.opacity = "";
  }

  _handleSwipeEnd(event) {
    const swipe = this._swipe;
    if (!swipe || event.pointerId !== swipe.pointerId) {
      return;
    }

    this._swipe = null;

    if (!swipe.isActive) {
      return;
    }

    const deltaX = event.clientX - swipe.startX;
    const { entry, toastElement } = swipe;
    toastElement.classList.remove("is-swiping");

    if (Math.abs(deltaX) > SWIPE_DISMISS_THRESHOLD_PX && entry.phase !== "closing") {
      const direction = deltaX < 0 ? -1 : 1;
      const exitDistance = toastElement.offsetWidth + SWIPE_DISMISS_THRESHOLD_PX;
      toastElement.style.setProperty("--swipe-x", `${direction * exitDistance}px`);
      toastElement.style.opacity = "";
      this._beginDismiss(entry, "swipe");
      return;
    }

    this._resetSwipeElement(toastElement);
  }

  _handleSwipeCancel(event) {
    const swipe = this._swipe;
    if (!swipe || event.pointerId !== swipe.pointerId) {
      return;
    }

    this._swipe = null;

    if (swipe.isActive) {
      this._resetSwipeElement(swipe.toastElement);
    }
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
    if (entry.visibilityFrameId) {
      return;
    }

    entry.visibilityFrameId = window.requestAnimationFrame(() => {
      entry.visibilityFrameId = 0;
      if (entry.phase !== "open") {
        return;
      }

      entry.visible = true;
      this.requestUpdate();
    });
  }

  _scheduleExpiration(entry) {
    if (entry.duration <= 0 || entry.expireTimerId) {
      return;
    }

    entry.expireTimerId = window.setTimeout(() => {
      entry.expireTimerId = 0;
      if (entry.phase !== "open") {
        return;
      }

      this._dispatchToastEvent("toast-expire", entry, "timeout");
      this._beginDismiss(entry, "timeout");
    }, entry.duration);
  }

  _scheduleDismiss(entry) {
    if (entry.dismissTimerId) {
      return;
    }

    entry.dismissTimerId = window.setTimeout(() => {
      entry.dismissTimerId = 0;
      if (entry.phase !== "closing") {
        return;
      }

      this._finalizeDismiss(entry);
    }, TOAST_DISMISS_DELAY_MS);
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

    this._clearEntryTimers(entry);
    this._dispatchToastEvent("toast-dismiss", entry, entry.closeReason);

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
