import { css, html, LitElement } from 'lit';

const PANEL_HIDE_DELAY_MS = 380;

class SharedPanelElement extends LitElement {
  static properties = {
    closeLabel: { attribute: 'close-label' },
    open: { type: Boolean, reflect: true },
    panelTitle: { attribute: 'panel-title' },
  };

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      display: block;
      z-index: var(--shared-panel-z-index, 1000);
      pointer-events: none;
    }

    :host([hidden]) {
      display: none;
    }

    .panel-shell {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 0.5rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      box-sizing: border-box;
      padding: var(--shared-panel-padding, 0.5rem);
      background-color: #1b1b1b;
      background-image:
        linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, 0.25) 100%),
        url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="1" seed="12"/><feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1.35 -0.45"/></filter><rect width="120" height="120" filter="url(%23n)" opacity="0.28"/></svg>');
      background-size: 100% 100%, 140px 140px;
      background-repeat: repeat;
      background-blend-mode: soft-light;
      color: var(--secondary-color, #f0f0f0);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.65, 0.05, 0.36, 1);
      pointer-events: auto;
    }

    :host([open]) .panel-shell {
      transform: translateX(0);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0 1rem;
      color: inherit;
    }

    .panel-title {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 400;
      text-transform: uppercase;
    }

    .close-button {
      appearance: none;
      border: none;
      background: none;
      color: inherit;
      width: 40px;
      height: 40px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font: inherit;
      font-size: 32px;
      line-height: 1;
      cursor: pointer;
    }

    .close-button:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    .panel-body {
      min-height: 0;
    }
  `;

  constructor() {
    super();
    this.closeLabel = 'Fermer le panneau';
    this.open = false;
    this.panelTitle = '';
    this.hasPendingCloseEvent = false;
    this.hideTimeoutId = 0;
    this.openFrameRequestId = 0;
    this.returnFocusTarget = null;
  }

  connectedCallback() {
    super.connectedCallback();

    if (this.classList.contains('visible')) {
      this.open = true;
      this.hidden = false;
      this.inert = false;
      this.setAttribute('aria-hidden', 'false');
      return;
    }

    this.open = false;
    this.hidden = true;
    this.inert = true;
    this.setAttribute('aria-hidden', 'true');
  }

  disconnectedCallback() {
    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    super.disconnectedCallback();
  }

  clearHideTimeout() {
    if (!this.hideTimeoutId) {
      return;
    }

    window.clearTimeout(this.hideTimeoutId);
    this.hideTimeoutId = 0;
  }

  clearOpenFrameRequest() {
    if (!this.openFrameRequestId) {
      return;
    }

    window.cancelAnimationFrame(this.openFrameRequestId);
    this.openFrameRequestId = 0;
  }

  getPanelName() {
    return this.dataset.panelName || '';
  }

  getPanelShell() {
    return this.renderRoot?.querySelector('.panel-shell') || null;
  }

  getCloseButton() {
    return this.renderRoot?.querySelector('.close-button') || null;
  }

  getDeepActiveElement() {
    let activeElement = document.activeElement;

    while (activeElement?.shadowRoot?.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement instanceof HTMLElement ? activeElement : null;
  }

  isFocusableTarget(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return false;
    }

    if (
      element.hidden ||
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    ) {
      return false;
    }

    return true;
  }

  getInitialFocusTarget() {
    const selector = [
      '[data-panel-initial-focus]',
      '[autofocus]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'button',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const lightDomTarget = Array.from(this.querySelectorAll(selector))
      .find((element) => this.isFocusableTarget(element));

    if (lightDomTarget instanceof HTMLElement) {
      return lightDomTarget;
    }

    return this.getCloseButton();
  }

  focusElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }

    return this.getDeepActiveElement() === element;
  }

  focusFallbackTarget() {
    const { body } = document;
    const hadTabIndex = body.hasAttribute('tabindex');

    if (!hadTabIndex) {
      body.setAttribute('tabindex', '-1');
    }

    this.focusElement(body);

    if (!hadTabIndex) {
      body.removeAttribute('tabindex');
    }
  }

  restoreFocus() {
    const activeElement = this.getDeepActiveElement();
    const activeElementIsInsidePanel = Boolean(
      activeElement && (activeElement === this || this.contains(activeElement) || this.renderRoot?.contains(activeElement))
    );

    if (!activeElementIsInsidePanel) {
      return;
    }

    if (this.isFocusableTarget(this.returnFocusTarget) && this.returnFocusTarget !== this) {
      if (this.focusElement(this.returnFocusTarget)) {
        return;
      }
    }

    activeElement?.blur?.();
    this.focusFallbackTarget();
  }

  openPanel(returnFocusTarget = null) {
    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    this.hasPendingCloseEvent = false;
    this.returnFocusTarget = returnFocusTarget instanceof HTMLElement
      ? returnFocusTarget
      : this.getDeepActiveElement();
    this.hidden = false;
    this.inert = false;
    this.open = false;
    this.classList.add('visible');
    this.setAttribute('aria-hidden', 'false');

    this.openFrameRequestId = window.requestAnimationFrame(() => {
      this.openFrameRequestId = 0;

      const panelShell = this.getPanelShell();
      panelShell?.getBoundingClientRect();

      this.open = true;
      this.updateComplete.then(() => {
        const initialFocusTarget = this.getInitialFocusTarget();
        if (!initialFocusTarget) {
          return;
        }

        this.focusElement(initialFocusTarget);
      });
    });
  }

  closePanel({ restoreFocus = true } = {}) {
    if (!this.classList.contains('visible') && !this.open) {
      return;
    }

    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    this.hasPendingCloseEvent = this.classList.contains('visible');
    this.dispatchEvent(new CustomEvent('shared-panel-closing', {
      bubbles: true,
      composed: true,
      detail: { panelName: this.getPanelName() },
    }));
    if (restoreFocus) {
      this.restoreFocus();
    }
    this.open = false;
    this.classList.remove('visible');
    const panelShell = this.getPanelShell();
    if (panelShell) {
      panelShell.scrollTop = 0;
    }
    this.inert = true;
    this.setAttribute('aria-hidden', 'true');
    this.hideTimeoutId = window.setTimeout(() => {
      this.hideTimeoutId = 0;
      this.finalizeHidden();
    }, PANEL_HIDE_DELAY_MS);
  }

  finalizeHidden() {
    if (this.open) {
      return;
    }

    this.hidden = true;

    if (!this.hasPendingCloseEvent) {
      return;
    }

    this.hasPendingCloseEvent = false;
    this.dispatchEvent(new CustomEvent('shared-panel-closed', {
      bubbles: true,
      composed: true,
      detail: { panelName: this.getPanelName() },
    }));
  }

  handleCloseButtonClick() {
    this.closePanel();
  }

  handleShellTransitionEnd(event) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return;
    }

    this.finalizeHidden();
  }

  render() {
    return html`
      <section
        class="panel-shell"
        role="dialog"
        aria-modal="true"
        aria-label=${this.panelTitle}
        @transitionend=${this.handleShellTransitionEnd}
      >
        <header class="panel-header">
          <h2 class="panel-title">${this.panelTitle}</h2>
          <button
            class="close-button"
            type="button"
            aria-label=${this.closeLabel}
            @click=${this.handleCloseButtonClick}
          >
            ×
          </button>
        </header>
        <div class="panel-body">
          <slot></slot>
        </div>
      </section>
    `;
  }
}

if (!customElements.get('shared-panel')) {
  customElements.define('shared-panel', SharedPanelElement);
}
